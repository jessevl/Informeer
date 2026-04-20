import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { queryEntries, getSystemCategoryId } from './categories.ts';
import { discoverFeeds } from '../services/feed-discovery.ts';
import { getScheduler } from '../services/scheduler.ts';
import { discoverAndStoreIcon } from '../services/icon-fetcher.ts';
import { extractFromXml } from '@extractus/feed-extractor';
import { validateFeedUrl, badRequest, notFound, conflict } from '../lib/errors.ts';
import { getSetting } from '../services/settings.ts';
import { log } from '../lib/logger.ts';
import { throttledFetch, feedFetchHeaders } from '../lib/http.ts';
import { cleanOrphanedCacheFiles } from '../services/cache-manager.ts';

const feeds = new Hono<{ Variables: { user: AuthUser } }>();

// Helper to format a feed row for the API response
function formatFeed(row: any, category?: any, icon?: any) {
  return {
    id: row.id,
    user_id: row.user_id,
    feed_url: row.feed_url,
    site_url: row.site_url,
    title: row.title,
    description: row.description || '',
    checked_at: row.checked_at || '',
    next_check_at: row.next_check_at || '',
    etag_header: row.etag_header || '',
    last_modified_header: row.last_modified_header || '',
    parsing_error_message: row.parsing_error_message || '',
    parsing_error_count: row.parsing_error_count || 0,
    scraper_rules: row.scraper_rules || '',
    crawler: !!row.crawler,
    content_fetch_policy: row.content_fetch_policy || 'rss_only',
    user_agent: row.user_agent || '',
    cookie: row.cookie || '',
    username: row.username || '',
    password: row.password || '',
    disabled: !!row.disabled,
    no_media_player: !!row.no_media_player,
    ignore_http_cache: !!row.ignore_http_cache,
    hide_globally: !!row.hide_globally,
    // Extended fields
    source_type: row.source_type || 'rss',
    source_config: row.source_config ? (typeof row.source_config === 'string' ? JSON.parse(row.source_config) : row.source_config) : {},
    category: category || {
      id: row.category_id,
      title: row.category_title || '',
      user_id: row.user_id,
      hide_globally: !!row.category_hide_globally,
    },
    icon: icon || (row.icon_id ? { feed_id: row.id, icon_id: row.icon_id } : undefined),
  };
}

// GET /v1/feeds
feeds.get('/v1/feeds', (c) => {
  const user = c.get('user');
  const db = getDb();
  const rows = db.query(`
    SELECT f.*, c.title as category_title, c.hide_globally as category_hide_globally,
           fi.icon_id
    FROM feeds f
    JOIN categories c ON f.category_id = c.id
    LEFT JOIN feed_icons fi ON f.id = fi.feed_id
    WHERE f.user_id = ?
    ORDER BY f.title ASC
  `).all(user.id) as any[];

  return c.json(rows.map(r => formatFeed(r)));
});

// GET /v1/feeds/counters — MUST be before :id routes
feeds.get('/v1/feeds/counters', (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = db.query(`
    SELECT feed_id, status, COUNT(*) as count
    FROM entries
    WHERE user_id = ?
    GROUP BY feed_id, status
  `).all(user.id) as Array<{ feed_id: number; status: string; count: number }>;

  const reads: Record<number, number> = {};
  const unreads: Record<number, number> = {};

  for (const row of rows) {
    if (row.status === 'read') {
      reads[row.feed_id] = (reads[row.feed_id] || 0) + row.count;
    } else if (row.status === 'unread') {
      unreads[row.feed_id] = (unreads[row.feed_id] || 0) + row.count;
    }
  }

  return c.json({ reads, unreads });
});

// PUT /v1/feeds/refresh — refresh all feeds — MUST be before :id routes
feeds.put('/v1/feeds/refresh', async (c) => {
  const user = c.get('user');
  const db = getDb();

  // Set all feeds to be picked up on next scheduler tick
  db.run(
    "UPDATE feeds SET next_check_at = datetime('now') WHERE user_id = ? AND disabled = 0",
    [user.id]
  );

  // Trigger an immediate scheduler tick
  getScheduler().tick().catch(() => {});

  return c.body(null, 204);
});

// POST /v1/discover — MUST be before :id routes
feeds.post('/v1/discover', async (c) => {
  const body = await c.req.json<{ url: string }>();
  if (!body?.url) {
    throw badRequest('url is required');
  }

  validateFeedUrl(body.url);

  try {
    const discovered = await discoverFeeds(body.url);
    return c.json(discovered);
  } catch (err: any) {
    if (err instanceof HTTPException) throw err;
    throw badRequest(err.message || 'Failed to discover feeds');
  }
});

// GET /v1/feeds/:id
feeds.get('/v1/feeds/:id', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  const db = getDb();

  const row = db.query(`
    SELECT f.*, c.title as category_title, c.hide_globally as category_hide_globally,
           fi.icon_id
    FROM feeds f
    JOIN categories c ON f.category_id = c.id
    LEFT JOIN feed_icons fi ON f.id = fi.feed_id
    WHERE f.id = ? AND f.user_id = ?
  `).get(id, user.id) as any;

  if (!row) {
    throw notFound('Feed not found');
  }

  return c.json(formatFeed(row));
});

// POST /v1/feeds
feeds.post('/v1/feeds', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    feed_url: string;
    category_id?: number;
    system_category?: string;
    crawler?: boolean;
    user_agent?: string;
    username?: string;
    password?: string;
    scraper_rules?: string;
    content_fetch_policy?: string;
    // Extended
    source_type?: string;
    source_config?: Record<string, unknown>;
    title?: string;
  }>();

  if (!body?.feed_url && body?.source_type === 'rss') {
    throw badRequest('feed_url is required');
  }

  // SSRF protection
  if (body.feed_url) {
    validateFeedUrl(body.feed_url);
  }

  const db = getDb();

  // Get or default category_id
  let categoryId = body.category_id;

  // Auto-assign system categories when requested via system_category hint
  if (!categoryId && body.system_category) {
    categoryId = getSystemCategoryId(user.id, body.system_category);
  }

  // Auto-detect YouTube feeds
  if (!categoryId && body.feed_url && /youtube\.com\/feeds/i.test(body.feed_url)) {
    categoryId = getSystemCategoryId(user.id, 'Video');
  }

  if (!categoryId) {
    const firstCat = db.query(
      'SELECT id FROM categories WHERE user_id = ? ORDER BY position ASC LIMIT 1'
    ).get(user.id) as { id: number } | null;
    if (!firstCat) {
      throw badRequest('No categories exist. Create one first.');
    }
    categoryId = firstCat.id;
  }

  // Verify category exists and belongs to user
  const cat = db.query(
    'SELECT id, is_system FROM categories WHERE id = ? AND user_id = ?'
  ).get(categoryId, user.id) as { id: number; is_system: number } | null;
  if (!cat) {
    throw notFound('Category not found');
  }

  const sourceType = body.source_type || 'rss';

  // Don't allow adding plain RSS feeds to system categories (Video, Audio, Magazines)
  if (cat.is_system && sourceType === 'rss' && !body.system_category) {
    throw badRequest('Cannot add RSS feeds to system categories. Use the appropriate feed type instead.');
  }
  const sourceConfig = body.source_config ? JSON.stringify(body.source_config) : '{}';

  // Fetch feed metadata (title, site URL) from the actual feed
  let feedTitle = '';
  let siteUrl = '';

  // Only use user-supplied title if it doesn't look like a URL
  if (body.title && !/^https?:\/\//i.test(body.title)) {
    feedTitle = body.title;
  }

  if (body.feed_url && sourceType === 'rss') {
    try {
      const res = await throttledFetch(body.feed_url, {
        headers: feedFetchHeaders({ user_agent: body.user_agent }),
        redirect: 'follow',
      });

      if (res.ok) {
        const xml = await res.text();
        try {
          const parsed = extractFromXml(xml);
          if (!feedTitle && parsed?.title) {
            feedTitle = parsed.title;
          }
          if (parsed?.link) {
            siteUrl = parsed.link;
          }
        } catch {
          // XML parse failed — try extracting title from raw XML as fallback
          const titleMatch = xml.match(/<title[^>]*>(?:<!\[CDATA\[)?\s*(.*?)\s*(?:\]\]>)?<\/title>/i);
          if (!feedTitle && titleMatch?.[1]) {
            feedTitle = titleMatch[1].trim();
          }
        }
      }
    } catch {
      // Failed to fetch metadata — not fatal, continue with defaults
    }
  }

  if (!feedTitle) {
    feedTitle = body.feed_url || sourceType;
  }

  try {
    db.run(`
      INSERT INTO feeds (
        user_id, category_id, source_type, source_config, feed_url, site_url, title,
        crawler, content_fetch_policy, user_agent, username, password,
        scraper_rules
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      user.id, categoryId, sourceType, sourceConfig,
      body.feed_url || '', siteUrl, feedTitle,
      body.crawler ? 1 : 0,
      body.content_fetch_policy || (body.crawler ? 'always' : (getSetting<string>('feeds.default_content_fetch_policy') || 'always')),
      body.user_agent || '',
      body.username || '',
      body.password || '',
      body.scraper_rules || '',
    ]);
  } catch (e: any) {
    if (e.message?.includes('UNIQUE') || e.message?.includes('constraint')) {
      throw conflict('Feed already exists');
    }
    throw e;
  }

  // Get the created feed ID
  const created = db.query(
    'SELECT last_insert_rowid() as id'
  ).get() as { id: number };

  // Async: discover and store icon for the new feed (prefer site URL)
  const iconSiteUrl = siteUrl || body.feed_url || '';
  if (iconSiteUrl) {
    discoverAndStoreIcon(created.id, iconSiteUrl).catch(() => {});
  }

  // Async: trigger initial fetch
  const newFeed = db.query('SELECT * FROM feeds WHERE id = ?').get(created.id) as any;
  if (newFeed) {
    getScheduler().refresh(newFeed).catch(() => {});
  }

  // Return the full feed object so the client has the correct title/site_url
  const row = db.query(`
    SELECT f.*, c.title as category_title, c.hide_globally as category_hide_globally,
           fi.icon_id
    FROM feeds f
    JOIN categories c ON f.category_id = c.id
    LEFT JOIN feed_icons fi ON f.id = fi.feed_id
    WHERE f.id = ?
  `).get(created.id) as any;

  return c.json({ feed_id: created.id, ...formatFeed(row) }, 201);
});

// PUT /v1/feeds/:id
feeds.put('/v1/feeds/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<Record<string, any>>();

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM feeds WHERE id = ? AND user_id = ?'
  ).get(id, user.id) as any;

  if (!existing) {
    throw notFound('Feed not found');
  }

  // Fields that affect content fetching/extraction — changes trigger a refresh
  const contentAffectingFields = new Set([
    'crawler', 'content_fetch_policy', 'scraper_rules', 'user_agent', 'cookie',
    'feed_url',
  ]);

  const allowedFields = [
    'feed_url', 'site_url', 'title', 'description',
    'crawler', 'content_fetch_policy', 'scraper_rules',
    'user_agent', 'cookie', 'username', 'password',
    'disabled', 'no_media_player', 'ignore_http_cache', 'hide_globally',
    'category_id', 'source_config',
  ];

  const updates: string[] = [];
  const params: any[] = [];
  let needsRefresh = false;

  for (const [key, value] of Object.entries(body)) {
    if (!allowedFields.includes(key)) continue;

    if (key === 'category_id') {
      // Verify new category
      const cat = db.query(
        'SELECT id FROM categories WHERE id = ? AND user_id = ?'
      ).get(value, user.id);
      if (!cat) {
        throw notFound('Category not found');
      }
    }

    // Check if this field changed and affects content
    if (contentAffectingFields.has(key)) {
      const oldValue = typeof value === 'boolean' ? !!existing[key] : existing[key] ?? '';
      const newValue = typeof value === 'boolean' ? value : value ?? '';
      if (String(oldValue) !== String(newValue)) {
        needsRefresh = true;
      }
    }

    if (key === 'source_config') {
      updates.push(`${key} = ?`);
      params.push(typeof value === 'string' ? value : JSON.stringify(value));
    } else if (typeof value === 'boolean') {
      updates.push(`${key} = ?`);
      params.push(value ? 1 : 0);
    } else {
      updates.push(`${key} = ?`);
      params.push(value);
    }
  }

  if (updates.length > 0) {
    params.push(id, user.id);
    db.run(
      `UPDATE feeds SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
  }

  // If content-affecting settings changed, reset content_fetched on existing
  // entries and trigger a re-fetch so users see the effect immediately
  if (needsRefresh) {
    db.run(
      'UPDATE entries SET content_fetched = 0 WHERE feed_id = ? AND user_id = ?',
      [id, user.id]
    );
    const updatedFeed = db.query('SELECT * FROM feeds WHERE id = ?').get(id) as any;
    if (updatedFeed) {
      getScheduler().refresh(updatedFeed).catch(() => {});
    }
    log.info('Feed settings changed, triggered refresh', { feed_id: id });
  }

  // Return updated feed
  const row = db.query(`
    SELECT f.*, c.title as category_title, c.hide_globally as category_hide_globally,
           fi.icon_id
    FROM feeds f
    JOIN categories c ON f.category_id = c.id
    LEFT JOIN feed_icons fi ON f.id = fi.feed_id
    WHERE f.id = ? AND f.user_id = ?
  `).get(id, user.id) as any;

  return c.json(formatFeed(row));
});

// DELETE /v1/feeds/:id
feeds.delete('/v1/feeds/:id', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM feeds WHERE id = ? AND user_id = ?'
  ).get(id, user.id);

  if (!existing) {
    throw notFound('Feed not found');
  }

  // Collect NRC/MagazineLib entry hashes before deletion (for cache file cleanup)
  const moduleEntries = db.query(
    `SELECT hash FROM entries WHERE feed_id = ? AND (hash LIKE 'nrc-%' OR hash LIKE 'mag-%')`
  ).all(id) as Array<{ hash: string }>;

  // CASCADE deletes entries, enclosures, feed_icons
  db.run('DELETE FROM feeds WHERE id = ? AND user_id = ?', [id, user.id]);

  // Clean up orphaned cache files for deleted NRC/MagazineLib entries
  if (moduleEntries.length > 0) {
    cleanOrphanedCacheFiles();
  }

  return c.body(null, 204);
});

// PUT /v1/feeds/:id/refresh
feeds.put('/v1/feeds/:id/refresh', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM feeds WHERE id = ? AND user_id = ?'
  ).get(id, user.id) as any;

  if (!existing) {
    throw notFound('Feed not found');
  }

  // Trigger immediate refresh via the scheduler
  try {
    const scheduler = getScheduler();
    await scheduler.refresh(existing);
  } catch (err: any) {
    // Still mark as checked even on error
    log.error('Feed refresh error', { feed_id: id, error: err.message });
  }

  return c.body(null, 204);
});

// PUT /v1/feeds/:id/mark-all-as-read
feeds.put('/v1/feeds/:id/mark-all-as-read', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM feeds WHERE id = ? AND user_id = ?'
  ).get(id, user.id);

  if (!existing) {
    throw notFound('Feed not found');
  }

  db.run(`
    UPDATE entries SET status = 'read', changed_at = datetime('now')
    WHERE feed_id = ? AND user_id = ? AND status = 'unread'
  `, [id, user.id]);

  return c.body(null, 204);
});

// GET /v1/feeds/:id/icon
feeds.get('/v1/feeds/:id/icon', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const row = db.query(`
    SELECT i.* FROM icons i
    JOIN feed_icons fi ON i.id = fi.icon_id
    WHERE fi.feed_id = ? AND EXISTS (
      SELECT 1 FROM feeds WHERE id = ? AND user_id = ?
    )
  `).get(id, id, user.id) as any;

  if (!row) {
    throw notFound('Icon not found');
  }

  return c.json({
    id: row.id,
    data: row.data,
    mime_type: row.mime_type,
  });
});

// GET /v1/feeds/:id/entries
feeds.get('/v1/feeds/:id/entries', (c) => {
  const user = c.get('user');
  const feedId = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM feeds WHERE id = ? AND user_id = ?'
  ).get(feedId, user.id);

  if (!existing) {
    throw notFound('Feed not found');
  }

  const query = c.req.query();
  return c.json(queryEntries(db, user.id, { ...query, feed_id: String(feedId) }));
});

export default feeds;

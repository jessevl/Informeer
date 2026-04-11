import { Hono } from 'hono';
import { getDb } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { queryEntries, formatEntry } from './categories.ts';
import { extractContent } from '../services/content-extractor.ts';
import { estimateReadingTime } from '../services/reading-time.ts';
import { log } from '../lib/logger.ts';
import { badRequest, notFound } from '../lib/errors.ts';

const entries = new Hono<{ Variables: { user: AuthUser } }>();

// GET /v1/entries
entries.get('/v1/entries', (c) => {
  const user = c.get('user');
  const db = getDb();
  const query = c.req.query();
  return c.json(queryEntries(db, user.id, query));
});

// GET /v1/entries/:id
entries.get('/v1/entries/:id', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const row = db.query(`
    SELECT
      e.*,
      f.title as feed_title, f.feed_url, f.site_url, f.hide_globally as feed_hide_globally,
      f.source_type, f.no_media_player, f.content_fetch_policy,
      cat.id as category_id, cat.title as category_title, cat.hide_globally as category_hide_globally,
      fi.icon_id
    FROM entries e
    JOIN feeds f ON e.feed_id = f.id
    JOIN categories cat ON f.category_id = cat.id
    LEFT JOIN feed_icons fi ON f.id = fi.feed_id
    WHERE e.id = ? AND e.user_id = ?
  `).get(id, user.id) as any;

  if (!row) {
    throw notFound('Entry not found');
  }

  // Get enclosures
  const enclosures = db.query(
    'SELECT * FROM enclosures WHERE entry_id = ?'
  ).all(id) as any[];

  const enclosureMap = new Map<number, any[]>();
  if (enclosures.length > 0) {
    enclosureMap.set(id, enclosures.map(e => ({
      id: e.id,
      user_id: e.user_id,
      entry_id: e.entry_id,
      url: e.url,
      mime_type: e.mime_type,
      size: e.size,
      media_progression: e.media_progression,
    })));
  }

  return c.json(formatEntry(row, enclosureMap));
});

// PUT /v1/entries — bulk status update
entries.put('/v1/entries', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ entry_ids: number[]; status: string }>();

  if (!body?.entry_ids?.length || !body.status) {
    throw badRequest('entry_ids and status are required');
  }

  if (!['read', 'unread', 'removed'].includes(body.status)) {
    throw badRequest('Invalid status. Must be read, unread, or removed.');
  }

  const db = getDb();
  const placeholders = body.entry_ids.map(() => '?').join(',');

  db.run(`
    UPDATE entries SET status = ?, changed_at = datetime('now')
    WHERE id IN (${placeholders}) AND user_id = ?
  `, [body.status, ...body.entry_ids, user.id]);

  return c.body(null, 204);
});

// PUT /v1/entries/:id/bookmark — toggle starred
entries.put('/v1/entries/:id/bookmark', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT id, starred FROM entries WHERE id = ? AND user_id = ?'
  ).get(id, user.id) as { id: number; starred: number } | null;

  if (!existing) {
    throw notFound('Entry not found');
  }

  db.run(
    "UPDATE entries SET starred = ?, changed_at = datetime('now') WHERE id = ?",
    [existing.starred ? 0 : 1, id]
  );

  return c.body(null, 204);
});

// GET /v1/entries/:id/fetch-content — readability extraction
entries.get('/v1/entries/:id/fetch-content', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const row = db.query(`
    SELECT
      e.*,
      f.title as feed_title, f.feed_url, f.site_url, f.hide_globally as feed_hide_globally,
      f.source_type, f.no_media_player,
      f.scraper_rules, f.user_agent as feed_user_agent, f.cookie as feed_cookie,
      cat.id as category_id, cat.title as category_title, cat.hide_globally as category_hide_globally,
      fi.icon_id
    FROM entries e
    JOIN feeds f ON e.feed_id = f.id
    JOIN categories cat ON f.category_id = cat.id
    LEFT JOIN feed_icons fi ON f.id = fi.feed_id
    WHERE e.id = ? AND e.user_id = ?
  `).get(id, user.id) as any;

  if (!row) {
    throw notFound('Entry not found');
  }

  // Only crawl standard RSS entries — never NRC, MagazineLib, YouTube, or podcasts.
  // These sources build their own content; running readability on them would corrupt it.
  if (row.source_type !== 'rss') {
    return c.json({ content: row.content });
  }

  // If content was already extracted and stored during sync, return it immediately.
  // This avoids re-fetching on every article open when crawler mode is enabled.
  if (row.content_fetched) {
    return c.json({ content: row.content });
  }

  // Extract article content using Readability, with per-feed options
  if (row.url) {
    try {
      const feedOpts: Record<string, string> = {};
      if (row.scraper_rules) feedOpts.scraperRules = row.scraper_rules;
      if (row.feed_user_agent) feedOpts.userAgent = row.feed_user_agent;
      if (row.feed_cookie) feedOpts.cookie = row.feed_cookie;

      const extracted = await extractContent(row.url, feedOpts);
      if (extracted?.content) {
        // Update the entry with extracted content and mark as fetched
        const readingTime = estimateReadingTime(extracted.content);
        db.run(
          "UPDATE entries SET content = ?, reading_time = ?, content_fetched = 1, image_url = CASE WHEN image_url = '' THEN ? ELSE image_url END, changed_at = datetime('now') WHERE id = ?",
          [extracted.content, readingTime, extracted.imageUrl || '', id]
        );
        row.content = extracted.content;
        row.reading_time = readingTime;
        log.debug('Content extracted', { entry_id: id, content_length: extracted.content.length });
      } else {
        log.warn('Content extraction returned no content (Readability could not parse page)', { entry_id: id, url: row.url });
      }
    } catch (err) {
      log.warn('Content extraction failed', { entry_id: id, url: row.url, error: (err as Error).message });
      // Return existing content on failure
    }
  } else {
    log.warn('Entry has no URL, cannot fetch content', { entry_id: id });
  }

  // Return extracted content
  return c.json({ content: row.content });
});

export default entries;

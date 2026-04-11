import { Hono } from 'hono';
import { getDb } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { generateOPML, parseOPML } from '../lib/opml.ts';
import { badRequest } from '../lib/errors.ts';
import { discoverAndStoreIcon } from '../services/icon-fetcher.ts';
import { getScheduler } from '../services/scheduler.ts';
import { log } from '../lib/logger.ts';

const opml = new Hono<{ Variables: { user: AuthUser } }>();

// GET /v1/export — export all feeds as OPML
opml.get('/v1/export', (c) => {
  const user = c.get('user');
  const db = getDb();

  const rows = db.query(`
    SELECT f.title, f.feed_url, f.site_url, c.title as category_title
    FROM feeds f
    JOIN categories c ON f.category_id = c.id
    WHERE f.user_id = ? AND f.source_type = 'rss'
    ORDER BY c.title, f.title
  `).all(user.id) as Array<{
    title: string;
    feed_url: string;
    site_url: string;
    category_title: string;
  }>;

  const opmlFeeds = rows.map(r => ({
    title: r.title,
    feedUrl: r.feed_url,
    siteUrl: r.site_url,
    category: r.category_title,
  }));

  const xml = generateOPML(opmlFeeds);

  return c.body(xml, 200, {
    'Content-Type': 'text/xml; charset=UTF-8',
    'Content-Disposition': 'attachment; filename="informeer-feeds.opml"',
  });
});

// POST /v1/import — import feeds from OPML
opml.post('/v1/import', async (c) => {
  const user = c.get('user');
  const contentType = c.req.header('Content-Type') || '';

  let xml: string;
  if (contentType.includes('text/xml') || contentType.includes('application/xml')) {
    xml = await c.req.text();
  } else {
    // Try to parse as JSON with an opml field, or raw text
    try {
      const body = await c.req.json<{ opml?: string }>();
      if (body?.opml) {
        xml = body.opml;
      } else {
        throw new Error('No OPML content');
      }
    } catch {
      xml = await c.req.text();
    }
  }

  if (!xml || !xml.includes('<opml')) {
    throw badRequest('Invalid OPML content');
  }

  const feeds = parseOPML(xml);
  if (feeds.length === 0) {
    throw badRequest('No feeds found in OPML');
  }

  const db = getDb();
  let imported = 0;
  const importedFeedIds: number[] = [];

  db.transaction(() => {
    for (const feed of feeds) {
      // Get or create category
      let categoryId: number;
      const categoryTitle = feed.category || 'Imported';

      const existingCat = db.query(
        'SELECT id FROM categories WHERE user_id = ? AND title = ?'
      ).get(user.id, categoryTitle) as { id: number } | null;

      if (existingCat) {
        categoryId = existingCat.id;
      } else {
        const maxPos = db.query(
          'SELECT COALESCE(MAX(position), -1) as max_pos FROM categories WHERE user_id = ?'
        ).get(user.id) as { max_pos: number };

        db.run(
          'INSERT INTO categories (user_id, title, position) VALUES (?, ?, ?)',
          [user.id, categoryTitle, maxPos.max_pos + 1]
        );
        const newCat = db.query(
          'SELECT id FROM categories WHERE user_id = ? AND title = ?'
        ).get(user.id, categoryTitle) as { id: number };
        categoryId = newCat.id;
      }

      // Insert feed (skip duplicates)
      try {
        db.run(`
          INSERT INTO feeds (user_id, category_id, feed_url, site_url, title)
          VALUES (?, ?, ?, ?, ?)
        `, [user.id, categoryId, feed.feedUrl, feed.siteUrl, feed.title || feed.feedUrl]);
        const row = db.query('SELECT last_insert_rowid() as id').get() as { id: number };
        importedFeedIds.push(row.id);
        imported++;
      } catch {
        // Duplicate feed_url — skip
      }
    }
  })();

  // Async: discover icons and trigger initial fetch for all imported feeds
  if (importedFeedIds.length > 0) {
    const scheduler = getScheduler();
    const importedRows = db.query(
      `SELECT * FROM feeds WHERE id IN (${importedFeedIds.map(() => '?').join(',')})`
    ).all(...importedFeedIds) as any[];

    for (const row of importedRows) {
      const iconUrl = row.site_url || row.feed_url;
      if (iconUrl) {
        discoverAndStoreIcon(row.id, iconUrl).catch(() => {});
      }
      scheduler.refresh(row).catch((e: any) => {
        log.warn('Initial sync failed for imported feed', { feed_id: row.id, error: e.message });
      });
    }
  }

  return c.json({ message: `Imported ${imported} feeds` });
});

export default opml;

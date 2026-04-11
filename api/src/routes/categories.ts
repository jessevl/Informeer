import { Hono } from 'hono';
import { getDb } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { badRequest, notFound, conflict } from '../lib/errors.ts';

const categories = new Hono<{ Variables: { user: AuthUser } }>();

// Helper to format a category row for the API response
function formatCategory(row: any) {
  return {
    id: row.id,
    title: row.title,
    user_id: row.user_id,
    hide_globally: !!row.hide_globally,
    is_system: !!row.is_system,
  };
}

// GET /v1/categories
categories.get('/v1/categories', (c) => {
  const user = c.get('user');
  const db = getDb();
  const rows = db.query(
    'SELECT * FROM categories WHERE user_id = ? ORDER BY position ASC, title ASC'
  ).all(user.id);
  return c.json(rows.map(formatCategory));
});

// POST /v1/categories
categories.post('/v1/categories', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ title?: string }>();

  if (!body?.title) {
    throw badRequest('title is required');
  }

  const db = getDb();

  // Get next position
  const maxPos = db.query(
    'SELECT COALESCE(MAX(position), -1) as max_pos FROM categories WHERE user_id = ?'
  ).get(user.id) as { max_pos: number };

  try {
    db.run(
      'INSERT INTO categories (user_id, title, position) VALUES (?, ?, ?)',
      [user.id, body.title, maxPos.max_pos + 1]
    );
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) {
      throw conflict(`Category "${body.title}" already exists`);
    }
    throw e;
  }

  const row = db.query(
    'SELECT * FROM categories WHERE user_id = ? AND title = ?'
  ).get(user.id, body.title);

  return c.json(formatCategory(row), 201);
});

// PUT /v1/categories/:id
categories.put('/v1/categories/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{ title?: string; hide_globally?: boolean }>();

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  ).get(id, user.id);

  if (!existing) {
    throw notFound('Category not found');
  }

  // System categories cannot be renamed
  if ((existing as any).is_system && body.title !== undefined && body.title !== (existing as any).title) {
    throw badRequest('System categories cannot be renamed');
  }

  const updates: string[] = [];
  const params: any[] = [];

  if (body.title !== undefined) {
    updates.push('title = ?');
    params.push(body.title);
  }
  if (body.hide_globally !== undefined) {
    updates.push('hide_globally = ?');
    params.push(body.hide_globally ? 1 : 0);
  }

  if (updates.length > 0) {
    params.push(id, user.id);
    db.run(
      `UPDATE categories SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
      params
    );
  }

  const updated = db.query(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  ).get(id, user.id);

  return c.json(formatCategory(updated));
});

// DELETE /v1/categories/:id
categories.delete('/v1/categories/:id', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  ).get(id, user.id);

  if (!existing) {
    throw notFound('Category not found');
  }

  // System categories cannot be deleted
  if ((existing as any).is_system) {
    throw badRequest('System categories cannot be deleted');
  }

  // Check if category has feeds
  const feedCount = db.query(
    'SELECT COUNT(*) as count FROM feeds WHERE category_id = ?'
  ).get(id) as { count: number };

  if (feedCount.count > 0) {
    throw badRequest('Cannot delete category with feeds');
  }

  db.run('DELETE FROM categories WHERE id = ? AND user_id = ?', [id, user.id]);
  return c.body(null, 204);
});

// PUT /v1/categories/:id/mark-all-as-read
categories.put('/v1/categories/:id/mark-all-as-read', (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  ).get(id, user.id);

  if (!existing) {
    throw notFound('Category not found');
  }

  db.run(`
    UPDATE entries SET status = 'read', changed_at = datetime('now')
    WHERE user_id = ? AND status = 'unread'
      AND feed_id IN (SELECT id FROM feeds WHERE category_id = ?)
  `, [user.id, id]);

  return c.body(null, 204);
});

// GET /v1/categories/:id/entries — reuses shared entry query logic
// This is implemented via the entries route with category_id filter
// For completeness, we handle it here too
categories.get('/v1/categories/:id/entries', (c) => {
  const user = c.get('user');
  const categoryId = parseInt(c.req.param('id'), 10);

  const db = getDb();
  const existing = db.query(
    'SELECT * FROM categories WHERE id = ? AND user_id = ?'
  ).get(categoryId, user.id);

  if (!existing) {
    throw notFound('Category not found');
  }

  // Parse query params
  const query = c.req.query();
  return c.json(queryEntries(db, user.id, { ...query, category_id: String(categoryId) }));
});

// Shared entry query builder (used by categories and feeds)
export function queryEntries(
  db: ReturnType<typeof getDb>,
  userId: number,
  params: Record<string, string>
): { total: number; entries: any[] } {
  const conditions: string[] = ['e.user_id = ?'];
  const values: any[] = [userId];

  if (params.status) {
    conditions.push('e.status = ?');
    values.push(params.status);
  }

  if (params.starred === 'true' || params.starred === '1') {
    conditions.push('e.starred = 1');
  }

  if (params.category_id) {
    conditions.push('f.category_id = ?');
    values.push(parseInt(params.category_id, 10));
  }

  if (params.feed_id) {
    conditions.push('e.feed_id = ?');
    values.push(parseInt(params.feed_id, 10));
  }

  if (params.before) {
    conditions.push('e.published_at < datetime(?, \'unixepoch\')');
    values.push(parseInt(params.before, 10));
  }

  if (params.after) {
    conditions.push('e.published_at > datetime(?, \'unixepoch\')');
    values.push(parseInt(params.after, 10));
  }

  if (params.before_entry_id) {
    conditions.push('e.id < ?');
    values.push(parseInt(params.before_entry_id, 10));
  }

  if (params.after_entry_id) {
    conditions.push('e.id > ?');
    values.push(parseInt(params.after_entry_id, 10));
  }

  if (params.search) {
    conditions.push('e.id IN (SELECT rowid FROM entries_fts WHERE entries_fts MATCH ?)');
    values.push(params.search);
  }

  const where = conditions.join(' AND ');

  // Count total
  const countSql = `
    SELECT COUNT(*) as total FROM entries e
    JOIN feeds f ON e.feed_id = f.id
    WHERE ${where}
  `;
  const { total } = db.query(countSql).get(...values) as { total: number };

  // Order
  const order = params.order || 'published_at';
  const direction = (params.direction || 'desc').toUpperCase();
  const validOrders = ['id', 'status', 'published_at', 'created_at', 'category_title'];
  const orderCol = validOrders.includes(order)
    ? (order === 'category_title' ? 'cat.title' : `e.${order}`)
    : 'e.published_at';
  const validDirections = ['ASC', 'DESC'];
  const dir = validDirections.includes(direction) ? direction : 'DESC';

  // Pagination
  const limit = Math.min(parseInt(params.limit || '100', 10), 1000);
  const offset = parseInt(params.offset || '0', 10);

  const sql = `
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
    WHERE ${where}
    ORDER BY ${orderCol} ${dir}
    LIMIT ? OFFSET ?
  `;
  const rows = db.query(sql).all(...values, limit, offset) as any[];

  // Get enclosures for all entries in one query
  const entryIds = rows.map(r => r.id);
  let enclosureMap = new Map<number, any[]>();
  if (entryIds.length > 0) {
    const placeholders = entryIds.map(() => '?').join(',');
    const enclosures = db.query(
      `SELECT * FROM enclosures WHERE entry_id IN (${placeholders})`
    ).all(...entryIds) as any[];
    for (const enc of enclosures) {
      if (!enclosureMap.has(enc.entry_id)) {
        enclosureMap.set(enc.entry_id, []);
      }
      enclosureMap.get(enc.entry_id)!.push({
        id: enc.id,
        user_id: enc.user_id,
        entry_id: enc.entry_id,
        url: enc.url,
        mime_type: enc.mime_type,
        size: enc.size,
        media_progression: enc.media_progression,
      });
    }
  }

  const entries = rows.map(row => formatEntry(row, enclosureMap));

  return { total, entries };
}

export function formatEntry(row: any, enclosureMap?: Map<number, any[]>) {
  const enclosures = enclosureMap?.get(row.id) || null;

  // Strip inline HTML tags (e.g. <i>, <em>, <b>) from titles
  const title = row.title ? row.title.replace(/<[^>]+>/g, '') : row.title;

  return {
    id: row.id,
    user_id: row.user_id,
    feed_id: row.feed_id,
    status: row.status,
    hash: row.hash,
    title: title,
    url: row.url,
    comments_url: row.comments_url,
    published_at: row.published_at,
    created_at: row.created_at,
    changed_at: row.changed_at,
    content: row.content,
    author: row.author,
    share_code: row.share_code,
    starred: !!row.starred,
    reading_time: row.reading_time,
    image_url: row.image_url || '',
    download_failed: !!row.download_failed,
    enclosures,
    tags: typeof row.tags === 'string' ? JSON.parse(row.tags) : (row.tags || []),
    feed: row.feed_title ? {
      id: row.feed_id,
      user_id: row.user_id,
      feed_url: row.feed_url,
      site_url: row.site_url,
      title: row.feed_title,
      source_type: row.source_type || 'rss',
      hide_globally: !!row.feed_hide_globally,
      no_media_player: !!row.no_media_player,
      content_fetch_policy: row.content_fetch_policy || 'rss_only',
      category: {
        id: row.category_id,
        title: row.category_title,
        user_id: row.user_id,
        hide_globally: !!row.category_hide_globally,
      },
      icon: row.icon_id ? { feed_id: row.feed_id, icon_id: row.icon_id } : undefined,
    } : undefined,
  };
}

/**
 * Get or create a system category by title for a user.
 * System categories (Video, Audio, Magazines) are immutable and auto-created.
 */
export function getSystemCategoryId(userId: number, title: string): number {
  const db = getDb();
  const row = db.query(
    'SELECT id FROM categories WHERE user_id = ? AND title = ? AND is_system = 1'
  ).get(userId, title) as { id: number } | null;
  if (row) return row.id;
  // Auto-create if missing (e.g. older DB without migration)
  const maxPos = db.query(
    'SELECT COALESCE(MAX(position), -1) as max_pos FROM categories WHERE user_id = ?'
  ).get(userId) as { max_pos: number };
  db.run(
    'INSERT OR IGNORE INTO categories (user_id, title, position, is_system) VALUES (?, ?, ?, 1)',
    [userId, title, maxPos.max_pos + 1]
  );
  const newRow = db.query(
    'SELECT id FROM categories WHERE user_id = ? AND title = ?'
  ).get(userId, title) as { id: number };
  return newRow.id;
}

export default categories;

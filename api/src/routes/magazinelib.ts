/**
 * MagazineLib Routes
 *
 * All routes under `/v1/magazinelib/*` — require auth.
 *
 * Architecture matches the standalone magazine-proxy service:
 * PDFs are resolved on-demand when the user actually requests them,
 * not eagerly during feed fetching.
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';
import { getDb } from '../db/connection.ts';
import { isModuleEnabled } from '../services/settings.ts';
import { searchMagazines, cacheIssues, getPdf, getCover, getCachedIssue } from '../sources/magazinelib.ts';
import { getScheduler } from '../services/scheduler.ts';
import { badRequest, forbidden, notFound, conflict } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';
import { getSystemCategoryId } from './categories.ts';

const magazinelib = new Hono<{ Variables: { user: AuthUser } }>();

// Public cover route — registered BEFORE auth middleware in index.ts
// because <img> tags cannot send auth headers.
export const magazinelibCover = new Hono();
magazinelibCover.get('/cover/mag/:issueId', async (c) => {
  const { issueId } = c.req.param();
  if (!/^[0-9a-f]{1,32}$/.test(issueId)) {
    return c.json({ error: 'Not Found' }, 404);
  }
  try {
    const filePath = await getCover(issueId);
    return new Response(Bun.file(filePath), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    log.debug('[magazinelib] Cover proxy error', { issueId, error: err.message });
    return c.json({ error: 'Cover not found' }, 404);
  }
});

/** Guard: require module enabled */
function requireModule() {
  if (!isModuleEnabled('magazinelib')) {
    throw forbidden('MagazineLib module is not enabled');
  }
}

// ===========================================================================
// All routes under /v1/ — require auth
// ===========================================================================

// Threshold of consecutive on-demand failures before the entry is flagged
// as broken in the UI. VK signed URLs and userapi.com redirects fail
// transiently often enough that a single miss should not stick.
const PDF_FAILURE_THRESHOLD = 3;

// GET /v1/magazinelib/pdf/:issueId — on-demand PDF resolution & streaming
magazinelib.get('/v1/magazinelib/pdf/:issueId', async (c) => {
  requireModule();

  const user = c.get('user');
  const { issueId } = c.req.param();

  try {
    const filePath = await getPdf(issueId);

    // Success — clear both the attempt counter and any prior failure flag
    const db = getDb();
    db.run(
      "UPDATE entries SET download_failed = 0, download_attempts = 0 WHERE user_id = ? AND hash = ? AND (download_failed = 1 OR download_attempts > 0)",
      [user.id, `mag-${issueId}`]
    );

    const cached = getCachedIssue(issueId);
    const rawName = cached ? cached.title : issueId;
    const safeName = rawName.replace(/[^\x20-\x7E]/g, '-').replace(/["/\\:*?<>|]/g, '-');

    return new Response(Bun.file(filePath), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}.pdf"`,
        'Cache-Control': 'public, max-age=604800', // 7 days
      },
    });
  } catch (err: any) {
    log.warn('[magazinelib] PDF proxy error', { issueId, error: err.message });

    // Increment attempts; only set the sticky failed flag once we cross
    // the threshold. This keeps a single transient failure from blurring
    // the cover and forcing a manual retry.
    const db = getDb();
    db.run(
      `UPDATE entries
         SET download_attempts = download_attempts + 1,
             download_failed = CASE WHEN download_attempts + 1 >= ? THEN 1 ELSE download_failed END,
             changed_at = datetime('now')
       WHERE user_id = ? AND hash = ?`,
      [PDF_FAILURE_THRESHOLD, user.id, `mag-${issueId}`]
    );

    throw notFound('PDF not found or unavailable');
  }
});

// GET /v1/magazinelib/search?q=...&page=1
magazinelib.get('/v1/magazinelib/search', async (c) => {
  requireModule();

  const query = c.req.query('q');
  const page = parseInt(c.req.query('page') || '1', 10);

  if (!query) {
    throw badRequest('Missing query parameter: q');
  }

  const results = await searchMagazines(query, page);
  // Cache issue metadata for on-demand PDF resolution
  cacheIssues(results.issues);
  return c.json(results);
});

// POST /v1/magazinelib/subscribe
magazinelib.post('/v1/magazinelib/subscribe', async (c) => {
  requireModule();

  const user = c.get('user');
  const body = await c.req.json<{
    query: string;
    title?: string;
    category_id?: number;
  }>();

  if (!body?.query) {
    throw badRequest('query is required');
  }

  const db = getDb();

  // Always use system "Magazines" category
  const categoryId = getSystemCategoryId(user.id, 'Magazines');

  // Verify category belongs to user
  const cat = db.query('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(categoryId, user.id);
  if (!cat) {
    throw notFound('Category not found');
  }

  const feedTitle = body.title || `Magazines: ${body.query}`;
  const sourceConfig = JSON.stringify({ query: body.query });
  // Synthetic feed_url so the UNIQUE(user_id, feed_url) constraint is satisfied
  const feedUrl = `magazinelib://search/${encodeURIComponent(body.query)}`;

  // Check for duplicate
  const existingFeed = db.query(
    "SELECT id FROM feeds WHERE user_id = ? AND feed_url = ?"
  ).get(user.id, feedUrl) as { id: number } | null;

  if (existingFeed) {
    throw conflict('A feed for this magazine query already exists');
  }

  db.run(`
    INSERT INTO feeds (user_id, category_id, source_type, source_config, feed_url, title, site_url)
    VALUES (?, ?, 'magazinelib', ?, ?, ?, ?)
  `, [user.id, categoryId, sourceConfig, feedUrl, feedTitle, 'https://magazinelib.com']);

  const newFeed = db.query(
    "SELECT * FROM feeds WHERE user_id = ? AND feed_url = ?"
  ).get(user.id, feedUrl) as any;

  // Trigger immediate fetch
  if (newFeed) {
    getScheduler().refresh(newFeed).catch((err: any) => {
      log.warn('[magazinelib] Initial fetch failed', { feed_id: newFeed.id, error: err.message });
    });
  }

  return c.json({ feed_id: newFeed?.id }, 201);
});

// PUT /v1/magazinelib/retry/:entryId — actually re-attempt the PDF download.
// Returns { ok: true } only when the PDF resolves and downloads successfully,
// so the UI can give the user real feedback instead of optimistically clearing
// the failure state.
magazinelib.put('/v1/magazinelib/retry/:entryId', async (c) => {
  requireModule();

  const user = c.get('user');
  const entryId = parseInt(c.req.param('entryId'), 10);

  const db = getDb();
  const entry = db.query(
    'SELECT id, hash FROM entries WHERE id = ? AND user_id = ?'
  ).get(entryId, user.id) as { id: number; hash: string } | null;

  if (!entry) {
    throw notFound('Entry not found');
  }

  const issueId = entry.hash.replace('mag-', '');

  // Clear the sticky flag while we try again, but keep download_attempts
  // intact so repeated retries still accumulate toward the threshold.
  // Keep the cached PDF — getPdf() validates it before serving and
  // re-resolves only if missing or invalid.
  db.run('UPDATE entries SET download_failed = 0 WHERE id = ?', [entryId]);

  try {
    await getPdf(issueId);
    db.run('UPDATE entries SET download_attempts = 0 WHERE id = ?', [entryId]);
    return c.json({ ok: true });
  } catch (err: any) {
    log.warn('[magazinelib] Retry failed', { issueId, error: err.message });
    db.run(
      `UPDATE entries
         SET download_attempts = download_attempts + 1,
             download_failed = CASE WHEN download_attempts + 1 >= ? THEN 1 ELSE 0 END,
             changed_at = datetime('now')
       WHERE id = ?`,
      [PDF_FAILURE_THRESHOLD, entryId]
    );
    return c.json({ ok: false, error: err.message }, 502);
  }
});

export default magazinelib;

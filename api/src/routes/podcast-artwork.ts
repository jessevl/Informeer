/**
 * Podcast Artwork API
 * Server-side caching of podcast cover art from iTunes.
 * Avoids redundant client-side iTunes API calls by caching artwork URLs
 * in the database and proxying images through the server.
 */

import { Hono } from 'hono';
import { getDb } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { notFound, badRequest } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';

const podcastArtwork = new Hono<{ Variables: { user: AuthUser } }>();

const CACHE_TTL_DAYS = 30;
const ITUNES_TIMEOUT_MS = 8000;

/**
 * Search iTunes for podcast artwork by title.
 * Returns the highest-resolution artwork URL available, or null.
 */
async function searchItunesArtwork(title: string): Promise<string | null> {
  const cleaned = title
    .replace(/\s*\((?:Audio|Video|HD|HQ)\)\s*/gi, ' ')
    .replace(/\s*-\s*(?:Audio|Video)\s*$/gi, '')
    .trim();

  if (!cleaned) return null;

  const url = `https://itunes.apple.com/search?${new URLSearchParams({
    term: cleaned,
    media: 'podcast',
    limit: '3',
  })}`;

  try {
    const resp = await fetch(url, {
      signal: AbortSignal.timeout(ITUNES_TIMEOUT_MS),
    });
    if (!resp.ok) return null;

    const data = await resp.json() as any;
    if (!data.results?.length) return null;

    const lowerTitle = cleaned.toLowerCase();
    const best =
      data.results.find((r: any) =>
        r.collectionName?.toLowerCase() === lowerTitle
      ) ??
      data.results.find((r: any) =>
        r.collectionName?.toLowerCase().includes(lowerTitle) ||
        lowerTitle.includes(r.collectionName?.toLowerCase())
      ) ??
      data.results[0];

    return best.artworkUrl600 || best.artworkUrl100 || best.artworkUrl60 || null;
  } catch {
    return null;
  }
}

/**
 * Resize an iTunes artwork URL to a given size.
 * iTunes URLs contain e.g. /100x100bb.jpg — we replace the size part.
 */
function resizeArtworkUrl(url: string, size: number): string {
  return url.replace(/\/\d+x\d+bb/, `/${size}x${size}bb`);
}

// GET /v1/podcast-artwork/:feedId
// Returns { artwork_url } from cache (DB), or looks it up from iTunes and caches it.
podcastArtwork.get('/v1/podcast-artwork/:feedId', async (c) => {
  const feedId = parseInt(c.req.param('feedId'), 10);
  if (isNaN(feedId)) throw badRequest('Invalid feed ID');

  const size = parseInt(c.req.query('size') || '600', 10);
  const db = getDb();

  // Check cache first
  const cached = db.query(
    `SELECT artwork_url, cached_at FROM podcast_artwork WHERE feed_id = ?`
  ).get(feedId) as { artwork_url: string | null; cached_at: string } | undefined;

  if (cached) {
    const cachedDate = new Date(cached.cached_at + 'Z');
    const age = Date.now() - cachedDate.getTime();
    if (age < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      const url = cached.artwork_url ? resizeArtworkUrl(cached.artwork_url, size) : null;
      return c.json({ artwork_url: url });
    }
  }

  // Look up the feed title
  const feed = db.query('SELECT title FROM feeds WHERE id = ?').get(feedId) as { title: string } | undefined;
  if (!feed) throw notFound('Feed not found');

  // Search iTunes
  const artworkUrl = await searchItunesArtwork(feed.title);

  // Cache result (even null = "not found")
  db.run(
    `INSERT INTO podcast_artwork (feed_id, artwork_url, cached_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(feed_id) DO UPDATE SET artwork_url = excluded.artwork_url, cached_at = excluded.cached_at`,
    [feedId, artworkUrl]
  );

  const url = artworkUrl ? resizeArtworkUrl(artworkUrl, size) : null;
  return c.json({ artwork_url: url });
});

// GET /v1/podcast-artwork/batch
// Accepts ?ids=1,2,3 and returns artwork for multiple feeds at once.
podcastArtwork.get('/v1/podcast-artwork/batch', async (c) => {
  const idsParam = c.req.query('ids');
  if (!idsParam) throw badRequest('Missing ids parameter');

  const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n));
  if (ids.length === 0) throw badRequest('No valid feed IDs');
  if (ids.length > 50) throw badRequest('Too many IDs (max 50)');

  const size = parseInt(c.req.query('size') || '600', 10);
  const db = getDb();
  const results: Record<string, string | null> = {};
  const needsLookup: Array<{ id: number; title: string }> = [];

  // Check cache for all IDs
  for (const id of ids) {
    const cached = db.query(
      `SELECT artwork_url, cached_at FROM podcast_artwork WHERE feed_id = ?`
    ).get(id) as { artwork_url: string | null; cached_at: string } | undefined;

    if (cached) {
      const cachedDate = new Date(cached.cached_at + 'Z');
      const age = Date.now() - cachedDate.getTime();
      if (age < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
        results[String(id)] = cached.artwork_url ? resizeArtworkUrl(cached.artwork_url, size) : null;
        continue;
      }
    }

    const feed = db.query('SELECT title FROM feeds WHERE id = ?').get(id) as { title: string } | undefined;
    if (feed) {
      needsLookup.push({ id, title: feed.title });
    }
  }

  // Look up missing ones (sequentially to avoid rate-limiting)
  for (const { id, title } of needsLookup) {
    const artworkUrl = await searchItunesArtwork(title);
    db.run(
      `INSERT INTO podcast_artwork (feed_id, artwork_url, cached_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(feed_id) DO UPDATE SET artwork_url = excluded.artwork_url, cached_at = excluded.cached_at`,
      [id, artworkUrl]
    );
    results[String(id)] = artworkUrl ? resizeArtworkUrl(artworkUrl, size) : null;
  }

  return c.json({ results });
});

export default podcastArtwork;

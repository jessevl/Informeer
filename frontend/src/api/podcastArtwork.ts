/**
 * Podcast Artwork Lookup
 * Fetches high-resolution podcast cover art via the server-side cache.
 * The server handles iTunes Search API lookups and caches results in the DB,
 * avoiding redundant iTunes API calls from each browser.
 *
 * Strategy:
 *   1. Check local in-memory + localStorage cache for the artwork URL
 *   2. If not cached, request from server (which queries iTunes and caches)
 *   3. Cache the result locally for instant subsequent lookups
 *   4. Fallback gracefully when a show isn't found (caller renders FeedIcon)
 */

import { api } from './client';

const CACHE_KEY = 'informeer-podcast-artwork';
const CACHE_VERSION = 3;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

interface ArtworkCacheEntry {
  url: string | null; // null = searched but not found
  ts: number;         // timestamp of lookup
}

interface ArtworkCache {
  v: number;
  entries: Record<string, ArtworkCacheEntry>; // key = feedId
}

// ── Cache helpers ────────────────────────────────────────────────

function loadCache(): ArtworkCache {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.v === CACHE_VERSION) return parsed;
    }
  } catch { /* ignore */ }
  return { v: CACHE_VERSION, entries: {} };
}

let cache = loadCache();

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persistCache() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch { /* storage full */ }
  }, 500);
}

// ── Server API ───────────────────────────────────────────────────

/** In-flight dedup map */
const pending = new Map<number, Promise<string | null>>();

/**
 * Resize an iTunes artwork URL to the given pixel dimension.
 * iTunes URLs end with e.g. `/100x100bb.jpg`; we replace the size part.
 */
function resizeArtworkUrl(url: string, size: number): string {
  return url.replace(/\/\d+x\d+bb/, `/${size}x${size}bb`);
}

/**
 * Fetch artwork URL from the server (which caches iTunes lookups in the DB).
 */
async function fetchArtworkFromServer(feedId: number, size: number): Promise<string | null> {
  try {
    const resp = await fetch(`/v1/podcast-artwork/${feedId}?size=${size}`, {
      headers: {
        'Authorization': (api as any).getAuthHeader(),
      },
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.artwork_url || null;
  } catch {
    return null;
  }
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Get a high-resolution podcast artwork URL for a feed.
 *
 * @param feedId   Informeer feed ID (used as cache key)
 * @param title    Feed/podcast title (kept for API compatibility, not used for client-side search)
 * @param size     Desired image dimension in pixels (default 600)
 * @returns        Artwork URL, or `null` if unavailable
 */
export async function getPodcastArtwork(
  feedId: number,
  title: string,
  size = 600,
): Promise<string | null> {
  const key = String(feedId);

  // 1. Check local cache
  const cached = cache.entries[key];
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.url ? resizeArtworkUrl(cached.url, size) : null;
  }

  // 2. Dedup in-flight requests
  if (pending.has(feedId)) {
    return pending.get(feedId)!;
  }

  // 3. Fetch from server (server handles iTunes lookup + DB caching)
  const promise = fetchArtworkFromServer(feedId, size).then(url => {
    cache.entries[key] = { url, ts: Date.now() };
    persistCache();
    pending.delete(feedId);
    return url;
  });

  pending.set(feedId, promise);
  return promise;
}

/**
 * Synchronous check: return cached artwork URL if available, else `null`.
 * Does **not** trigger a network request.
 */
export function getCachedPodcastArtwork(feedId: number, size = 600): string | null {
  const cached = cache.entries[String(feedId)];
  if (cached?.url && Date.now() - cached.ts < CACHE_TTL_MS) {
    return resizeArtworkUrl(cached.url, size);
  }
  return null;
}

/**
 * Invalidate a single entry so the next lookup re-fetches.
 */
export function invalidatePodcastArtwork(feedId: number) {
  delete cache.entries[String(feedId)];
  persistCache();
}


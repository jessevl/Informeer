/**
 * Search Routes
 *
 * Server-side proxied search for YouTube channels, Reddit subreddits,
 * and podcasts. Avoids CORS issues by running these requests from the
 * backend instead of the browser.
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';
import { badRequest } from '../lib/errors.ts';
import { throttledFetch, BROWSER_USER_AGENT } from '../lib/http.ts';
import { log } from '../lib/logger.ts';

const search = new Hono<{ Variables: { user: AuthUser } }>();

// ─── YouTube Channel Search ──────────────────────────────────────

/**
 * Invidious instances for YouTube search.
 * We try multiple instances since individual ones can go down.
 */
const PIPED_INSTANCES = [
  'https://pipedapi.kavin.rocks',
  'https://pipedapi.adminforge.de',
  'https://api.piped.privacydev.net',
  'https://pipedapi.in.projectsegfau.lt',
];

const INVIDIOUS_INSTANCES = [
  'https://vid.puffyan.us',
  'https://invidious.lunar.icu',
  'https://yt.artemislena.eu',
  'https://invidious.privacydev.net',
  'https://inv.tux.pizza',
];

interface YouTubeChannelResult {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  subscriberCount?: string;
}

function formatSubCount(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(count);
}

async function searchYouTubeViaPiped(query: string): Promise<YouTubeChannelResult[]> {
  for (const instance of PIPED_INSTANCES) {
    try {
      const url = `${instance}/search?q=${encodeURIComponent(query)}&filter=channels`;
      const res = await throttledFetch(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json() as any;
      const items = data.items || data;
      if (!Array.isArray(items) || items.length === 0) continue;

      return items
        .filter((item: any) => item.type === 'channel' || item.url?.startsWith('/channel/'))
        .slice(0, 10)
        .map((item: any) => ({
          id: item.url?.replace('/channel/', '') || item.id || '',
          title: item.name || item.title || '',
          description: item.description || '',
          thumbnailUrl: item.thumbnail || item.avatarUrl || '',
          subscriberCount: item.subscribers != null
            ? (typeof item.subscribers === 'number' ? formatSubCount(item.subscribers) : String(item.subscribers))
            : undefined,
        }))
        .filter((ch: YouTubeChannelResult) => ch.id);
    } catch {
      continue;
    }
  }
  return [];
}

async function searchYouTubeViaInvidious(query: string): Promise<YouTubeChannelResult[]> {
  for (const instance of INVIDIOUS_INSTANCES) {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=channel`;
      const res = await throttledFetch(url, {
        headers: { 'User-Agent': BROWSER_USER_AGENT },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const data = await res.json() as any;
      if (!Array.isArray(data) || data.length === 0) continue;

      return data
        .filter((item: any) => item.type === 'channel')
        .slice(0, 10)
        .map((item: any) => ({
          id: item.authorId || '',
          title: item.author || '',
          description: item.description || '',
          thumbnailUrl: item.authorThumbnails?.[item.authorThumbnails.length - 1]?.url || item.authorThumbnails?.[0]?.url || '',
          subscriberCount: item.subCount ? formatSubCount(item.subCount) : undefined,
        }))
        .filter((ch: YouTubeChannelResult) => ch.id);
    } catch {
      continue;
    }
  }
  return [];
}

// GET /v1/search/youtube?q=...
search.get('/v1/search/youtube', async (c) => {
  const query = c.req.query('q');
  if (!query) throw badRequest('Missing query parameter: q');

  log.debug('[search] YouTube channel search', { query });

  // Try Piped first (tends to be more reliable), then Invidious
  let channels = await searchYouTubeViaPiped(query);
  if (channels.length === 0) {
    channels = await searchYouTubeViaInvidious(query);
  }

  return c.json({ results: channels });
});

// ─── Reddit Subreddit Search ─────────────────────────────────────

interface SubredditResult {
  name: string;
  title: string;
  description: string;
  subscribers: number;
  iconUrl: string | null;
  over18: boolean;
}

// GET /v1/search/reddit?q=...
search.get('/v1/search/reddit', async (c) => {
  const query = c.req.query('q');
  if (!query) throw badRequest('Missing query parameter: q');

  log.debug('[search] Reddit subreddit search', { query });

  try {
    const url = `https://www.reddit.com/subreddits/search.json?q=${encodeURIComponent(query)}&limit=10&raw_json=1`;
    const res = await throttledFetch(url, {
      headers: {
        'User-Agent': 'Informeer/1.0 (Feed Reader)',
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      log.warn('[search] Reddit search failed', { status: res.status });
      return c.json({ results: [] });
    }

    const data = await res.json() as any;
    if (!data?.data?.children) return c.json({ results: [] });

    const results: SubredditResult[] = data.data.children
      .filter((child: any) => child.kind === 't5')
      .map((child: any) => ({
        name: child.data.display_name,
        title: child.data.title || child.data.display_name,
        description: child.data.public_description || '',
        subscribers: child.data.subscribers || 0,
        iconUrl: child.data.icon_img || child.data.community_icon?.split('?')[0] || null,
        over18: child.data.over18 || false,
      }));

    return c.json({ results });
  } catch (err) {
    log.warn('[search] Reddit search error', { error: String(err) });
    return c.json({ results: [] });
  }
});

// ─── Podcast Search (iTunes) ────────────────────────────────────

interface PodcastResult {
  id: number;
  title: string;
  author: string;
  feedUrl: string;
  artworkUrl: string;
  genres: string[];
  episodeCount: number;
}

// GET /v1/search/podcasts?q=...
search.get('/v1/search/podcasts', async (c) => {
  const query = c.req.query('q');
  if (!query) throw badRequest('Missing query parameter: q');

  log.debug('[search] Podcast search', { query });

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=15`;
    const res = await throttledFetch(url, {
      headers: { 'User-Agent': BROWSER_USER_AGENT },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      log.warn('[search] iTunes search failed', { status: res.status });
      return c.json({ results: [] });
    }

    const data = await res.json() as any;
    if (!data?.results) return c.json({ results: [] });

    const results: PodcastResult[] = data.results
      .filter((item: any) => item.feedUrl)
      .map((item: any) => ({
        id: item.trackId || item.collectionId,
        title: item.trackName || item.collectionName || '',
        author: item.artistName || '',
        feedUrl: item.feedUrl,
        artworkUrl: item.artworkUrl600 || item.artworkUrl100 || item.artworkUrl60 || '',
        genres: item.genres || [],
        episodeCount: item.trackCount || 0,
      }));

    return c.json({ results });
  } catch (err) {
    log.warn('[search] Podcast search error', { error: String(err) });
    return c.json({ results: [] });
  }
});

export default search;

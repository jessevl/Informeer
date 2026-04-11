import { extractFromXml } from '@extractus/feed-extractor';
import { log } from '../lib/logger.ts';
import { throttledFetch, FEED_ACCEPT } from '../lib/http.ts';

export interface DiscoveredFeed {
  url: string;
  title: string;
  type: 'rss' | 'atom' | 'json';
}

/**
 * Feed discovery — given a URL, find RSS/Atom/JSON feeds.
 *
 * Strategy:
 * 1. Try to parse the URL directly as a feed
 * 2. If it's HTML, look for <link> tags pointing to feeds
 * 3. Try common feed URL patterns (/feed, /rss, /atom.xml, etc.)
 */
export async function discoverFeeds(url: string): Promise<DiscoveredFeed[]> {
  let normalizedUrl: string;
  try {
    const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
    normalizedUrl = parsed.href;
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }

  const discovered: DiscoveredFeed[] = [];
  const seen = new Set<string>();

  const addFeed = (feed: DiscoveredFeed) => {
    const normalized = feed.url.replace(/\/$/, '');
    if (!seen.has(normalized)) {
      seen.add(normalized);
      discovered.push(feed);
    }
  };

  // Step 1: Try fetching the URL directly as a feed
  try {
    const response = await throttledFetch(normalizedUrl, {
      headers: { Accept: `${FEED_ACCEPT}, text/html, */*` },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const contentType = response.headers.get('Content-Type') || '';
    const rawBody = await response.text();
    // Limit body size to avoid memory/parse issues with large pages
    const body = rawBody.length > 5 * 1024 * 1024 ? rawBody.slice(0, 5 * 1024 * 1024) : rawBody;

    // Check if it's a feed
    if (isFeedContentType(contentType) || looksLikeFeed(body)) {
      try {
        const parsed = extractFromXml(body);
        if (parsed?.entries?.length) {
          const type = detectFeedType(body, contentType);
          addFeed({
            url: normalizedUrl,
            title: parsed.title || normalizedUrl,
            type,
          });
          return discovered;
        }
      } catch {
        // Not a valid feed — fall through to HTML link extraction
      }
    }

    // Step 2: Parse HTML for <link> tags
    if (contentType.includes('text/html') || body.trimStart().startsWith('<!') || body.trimStart().startsWith('<html')) {
      const htmlFeeds = extractFeedLinksFromHtml(body, normalizedUrl);
      for (const feed of htmlFeeds) {
        addFeed(feed);
      }
    }
  } catch (err) {
    // URL might not be fetchable directly — continue with guessing
    log.warn('Direct feed fetch failed', { url: normalizedUrl, error: (err as Error).message });
  }

  // Step 3: If no feeds found, try common patterns
  if (discovered.length === 0) {
    const baseUrl = new URL(normalizedUrl);
    const commonPaths = [
      '/feed',
      '/feed/',
      '/rss',
      '/rss/',
      '/rss.xml',
      '/atom.xml',
      '/feed.xml',
      '/index.xml',
      '/feeds/all.atom.xml',
      '/blog/feed',
      '/blog/rss',
      '/.rss',
      '/feed/rss',
    ];

    for (const path of commonPaths) {
      const feedUrl = `${baseUrl.origin}${path}`;
      try {
        const response = await throttledFetch(feedUrl, {
          headers: { Accept: FEED_ACCEPT },
          redirect: 'follow',
          timeoutMs: 5_000,
        });

        if (!response.ok) continue;

        const rawBody = await response.text();
        if (!looksLikeFeed(rawBody)) continue;
        const body = rawBody.length > 5 * 1024 * 1024 ? rawBody.slice(0, 5 * 1024 * 1024) : rawBody;

        let parsed;
        try {
          parsed = extractFromXml(body);
        } catch {
          continue;
        }
        if (parsed?.entries?.length) {
          const type = detectFeedType(body, response.headers.get('Content-Type') || '');
          addFeed({
            url: feedUrl,
            title: parsed.title || feedUrl,
            type,
          });
          // Found one — that's usually enough
          break;
        }
      } catch {
        // Ignore — just trying common paths
      }
    }
  }

  return discovered;
}

/** Extract feed URLs from HTML <link> tags */
function extractFeedLinksFromHtml(html: string, baseUrl: string): DiscoveredFeed[] {
  const feeds: DiscoveredFeed[] = [];
  const base = new URL(baseUrl);

  // Only search the <head> section to avoid processing the entire page body.
  // This also avoids catastrophic backtracking on large HTML bodies.
  const headEnd = html.indexOf('</head>');
  const head = headEnd > -1 ? html.slice(0, headEnd) : html.slice(0, 20_000);

  // Use a simple regex to extract individual self-closing <link ...> tags
  const tagRegex = /<link\s([^>]{0,2000})\/?>/gi;

  let tagMatch;
  while ((tagMatch = tagRegex.exec(head)) !== null) {
    const attrs = tagMatch[1];

    // Extract type attribute
    const typeMatch = attrs.match(/\btype\s*=\s*["']([^"']{0,100})["']/i);
    const type = (typeMatch?.[1] || '').toLowerCase();

    if (!type.includes('rss') && !type.includes('atom') && !type.includes('xml') && !type.includes('feed+json')) {
      continue;
    }

    // Extract href attribute
    const hrefMatch = attrs.match(/\bhref\s*=\s*["']([^"']{0,2000})["']/i);
    const href = hrefMatch?.[1] || '';
    if (!href) continue;

    let feedType: DiscoveredFeed['type'] = 'rss';
    if (type.includes('atom')) feedType = 'atom';
    else if (type.includes('json')) feedType = 'json';

    let resolvedUrl: string;
    try {
      resolvedUrl = new URL(href, base).href;
    } catch {
      continue;
    }

    // Extract title attribute
    const titleMatch = attrs.match(/\btitle\s*=\s*["']([^"']{0,200})["']/i);
    const title = titleMatch?.[1] || resolvedUrl;

    feeds.push({ url: resolvedUrl, title, type: feedType });
  }

  return feeds;
}

/** Check if a Content-Type header indicates a feed */
function isFeedContentType(contentType: string): boolean {
  const ct = contentType.toLowerCase();
  return ct.includes('xml') || ct.includes('rss') || ct.includes('atom') || ct.includes('feed+json');
}

/** Quick heuristic to check if a string looks like a feed */
function looksLikeFeed(body: string): boolean {
  const trimmed = body.trimStart().substring(0, 500);
  return (
    trimmed.includes('<rss') ||
    trimmed.includes('<feed') ||
    trimmed.includes('<RDF') ||
    trimmed.includes('<?xml') ||
    (trimmed.startsWith('{') && (trimmed.includes('"items"') || trimmed.includes('"feed_url"')))
  );
}

/** Detect the feed type from content and content-type */
function detectFeedType(body: string, contentType: string): DiscoveredFeed['type'] {
  const ct = contentType.toLowerCase();
  if (ct.includes('atom')) return 'atom';
  if (ct.includes('json')) return 'json';

  const trimmed = body.trimStart().substring(0, 500);
  if (trimmed.includes('<feed')) return 'atom';
  if (trimmed.startsWith('{')) return 'json';
  return 'rss';
}

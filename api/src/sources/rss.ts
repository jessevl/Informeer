import { extractFromXml } from '@extractus/feed-extractor';
import type { ContentSource, Feed, FetchResult, NewEntry } from './types.ts';
import { contentHash } from '../lib/hash.ts';
import { sanitizeHtml, resolveRelativeUrls, extractFirstImage, resolveLazyImages } from '../lib/html.ts';
import { throttledFetch, feedFetchHeaders } from '../lib/http.ts';

/**
 * Convert a parsed XML node into an HTML string.
 *
 * Handles the shapes fast-xml-parser produces with `ignoreAttributes: false`:
 * a plain string, a `{ '#text': ... }` object carrying attributes, CDATA, or a
 * repeated element (array). Atom `type="text"` content is escaped so stray
 * angle brackets don't become markup, and `type="xhtml"` (parsed into nested
 * nodes rather than a string) is skipped.
 */
function nodeToHtml(node: unknown): string {
  if (!node) return '';

  if (Array.isArray(node)) {
    for (const child of node) {
      const html = nodeToHtml(child);
      if (html) return html;
    }
    return '';
  }

  if (typeof node === 'string') return node.trim();
  if (typeof node !== 'object') return '';

  const obj = node as Record<string, unknown>;

  // <content src="..."/> — the body lives elsewhere, nothing inline to use
  if (obj['@_src']) return '';

  const text = obj['#text'] ?? obj['_cdata'] ?? obj['__cdata'];
  // Non-string means type="xhtml": nested element nodes, not usable as HTML
  if (typeof text !== 'string') return '';

  const trimmed = text.trim();
  if (!trimmed) return '';

  const type = String(obj['@_type'] || '').toLowerCase();
  if (type === 'text' || type === 'text/plain') {
    return trimmed
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  return trimmed;
}

/**
 * Pull the richest HTML body out of a raw feed entry.
 *
 * feed-extractor's normalized `description` is useless as article content: it
 * runs every candidate through stripTags(), so it only ever yields plain text,
 * and for Atom it prefers <summary> (a one-line teaser) over <content> (the
 * full article). Feeds that syndicate full text — The Atlantic's "Best of"
 * feed, for one — therefore lost the entire article body, leaving the crawler
 * as the only way to get it.
 *
 * Priority matches what other readers do: RSS <content:encoded>, then Atom
 * <content>, then <description>, then Atom <summary>.
 */
function extractFeedHtml(entry: Record<string, unknown>): string {
  for (const key of ['content:encoded', 'content', 'description', 'summary']) {
    const html = nodeToHtml(entry[key]);
    if (html) return html;
  }
  return '';
}

/**
 * RSSSource — fetches and parses RSS/Atom/JSON Feed URLs.
 * Supports conditional GET via ETag and If-Modified-Since headers.
 * Uses throttled fetch to respect per-domain rate limits.
 */
export class RSSSource implements ContentSource {
  readonly type = 'rss';

  async fetch(feed: Feed, signal: AbortSignal): Promise<FetchResult> {
    const headers = feedFetchHeaders(feed);

    // Fetch the feed (rate-limited per domain)
    const response = await throttledFetch(feed.feed_url, {
      headers,
      signal,
      redirect: 'follow',
    });

    // 304 Not Modified — no new content
    if (response.status === 304) {
      return { entries: [] };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const body = await response.text();
    const etag = response.headers.get('ETag') || undefined;
    const lastModified = response.headers.get('Last-Modified') || undefined;

    // Parse the feed
    const parsed = extractFromXml(body, {
      xmlParserOptions: { ignoreAttributes: false },
      getExtraEntryFields: (feedEntry: any) => {
        // Extract enclosures from RSS <enclosure> or Atom <link rel="enclosure">
        const enclosures: Array<{ url: string; mime_type: string; size: number }> = [];

        // RSS enclosure
        if (feedEntry.enclosure) {
          const enc = feedEntry.enclosure;
          const encObj = enc['@_url'] ? enc : (enc[0] || enc);
          if (encObj['@_url']) {
            enclosures.push({
              url: encObj['@_url'],
              mime_type: encObj['@_type'] || '',
              size: parseInt(encObj['@_length'] || '0', 10) || 0,
            });
          }
        }

        // Atom links with rel="enclosure"
        if (feedEntry.link) {
          const links = Array.isArray(feedEntry.link) ? feedEntry.link : [feedEntry.link];
          for (const link of links) {
            if (link['@_rel'] === 'enclosure' && link['@_href']) {
              enclosures.push({
                url: link['@_href'],
                mime_type: link['@_type'] || '',
                size: parseInt(link['@_length'] || '0', 10) || 0,
              });
            }
          }
        }

        // Media RSS
        if (feedEntry['media:content']) {
          const media = Array.isArray(feedEntry['media:content'])
            ? feedEntry['media:content']
            : [feedEntry['media:content']];
          for (const m of media) {
            if (m['@_url']) {
              enclosures.push({
                url: m['@_url'],
                mime_type: m['@_type'] || m['@_medium'] || '',
                size: parseInt(m['@_fileSize'] || '0', 10) || 0,
              });
            }
          }
        }

        return {
          _contentHtml: extractFeedHtml(feedEntry),
          _enclosures: enclosures,
          _commentsUrl: feedEntry.comments || feedEntry['slash:comments'] || '',
          _thumbnail: feedEntry['media:thumbnail']?.['@_url']
            || feedEntry['media:content']?.['@_url']
            || feedEntry['enclosure']?.['@_url']
            || '',
        };
      },
    });

    if (!parsed || !parsed.entries) {
      return { entries: [], etag, lastModified };
    }

    const baseUrl = feed.site_url || feed.feed_url;
    const entries: NewEntry[] = [];

    for (const item of parsed.entries) {
      const url = item.link || '';
      const title = item.title || 'Untitled';
      // Prefer the feed's own markup — it holds the full article whenever the
      // publisher syndicates one. feed-extractor's `description` is only a
      // tag-stripped fallback for feeds that provide nothing richer.
      const plainDescription = (item as any).description || '';
      let content = (item as any)._contentHtml || plainDescription;

      // Sanitize and resolve relative URLs
      if (content) {
        content = sanitizeHtml(content);
        content = resolveLazyImages(content);
        content = resolveRelativeUrls(content, baseUrl);
      }

      // Generate dedup hash from URL + title (or the description if no URL).
      // Hash the plain-text description rather than `content`, so hashes stay
      // stable now that `content` carries the feed's original markup.
      const hashInput = url || `${title}:${plainDescription}`;
      const hash = contentHash(hashInput);

      const publishedAt = item.published
        ? new Date(item.published).toISOString()
        : new Date().toISOString();

      const extra = item as any;
      const enclosures = extra._enclosures || [];
      const commentsUrl = extra._commentsUrl || '';

      // Extract preview image: prefer media:thumbnail, then first image in content
      let imageUrl = extra._thumbnail || '';
      if (!imageUrl && content) {
        imageUrl = extractFirstImage(content, baseUrl);
      }

      entries.push({
        hash,
        title,
        url,
        author: (item as any).creator || '',
        content,
        published_at: publishedAt,
        enclosures,
        comments_url: commentsUrl,
        image_url: imageUrl,
        tags: [],
      });
    }

    return { entries, etag, lastModified };
  }
}

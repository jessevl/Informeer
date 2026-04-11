import { extractFromXml } from '@extractus/feed-extractor';
import type { ContentSource, Feed, FetchResult, NewEntry } from './types.ts';
import { contentHash } from '../lib/hash.ts';
import { sanitizeHtml, resolveRelativeUrls, extractFirstImage, resolveLazyImages } from '../lib/html.ts';
import { throttledFetch, feedFetchHeaders } from '../lib/http.ts';

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
      let content = (item as any).description || item.description || '';

      // Sanitize and resolve relative URLs
      if (content) {
        content = sanitizeHtml(content);
        content = resolveLazyImages(content);
        content = resolveRelativeUrls(content, baseUrl);
      }

      // Generate dedup hash from URL + title (or content if no URL)
      const hashInput = url || `${title}:${content}`;
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

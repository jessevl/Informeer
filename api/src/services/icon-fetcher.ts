import { getDb } from '../db/connection.ts';
import { contentHash } from '../lib/hash.ts';
import { log } from '../lib/logger.ts';
import { throttledFetch, htmlFetchHeaders, BROWSER_USER_AGENT } from '../lib/http.ts';

/**
 * Favicon discovery and storage.
 * Multi-strategy approach with per-domain rate limiting.
 */

/** Discover and store an icon for a feed, linking it in feed_icons */
export async function discoverAndStoreIcon(feedId: number, siteUrl: string): Promise<void> {
  if (!siteUrl) return;

  try {
    const iconData = await discoverIcon(siteUrl);
    if (!iconData) {
      log.debug('No icon found', { feed_id: feedId, site_url: siteUrl });
      return;
    }

    const db = getDb();
    const hash = contentHash(iconData.data);

    // Check if icon with same hash already exists
    let iconId: number;
    const existing = db.query('SELECT id FROM icons WHERE hash = ?').get(hash) as { id: number } | null;

    if (existing) {
      iconId = existing.id;
    } else {
      db.run(
        'INSERT INTO icons (data, mime_type, hash) VALUES (?, ?, ?)',
        [iconData.data, iconData.mimeType, hash]
      );
      const row = db.query('SELECT last_insert_rowid() as id').get() as { id: number };
      iconId = row.id;
    }

    // Link feed to icon (upsert)
    db.run(
      'INSERT INTO feed_icons (feed_id, icon_id) VALUES (?, ?) ON CONFLICT(feed_id) DO UPDATE SET icon_id = excluded.icon_id',
      [feedId, iconId]
    );

    log.debug('Icon stored', { feed_id: feedId, icon_id: iconId });
  } catch (err) {
    log.warn('Icon discovery failed', { feed_id: feedId, error: (err as Error).message });
  }
}

interface IconData {
  data: string;     // base64-encoded data URI
  mimeType: string;
}

/** Try multiple strategies to find an icon for a URL */
async function discoverIcon(siteUrl: string): Promise<IconData | null> {
  let baseUrl: URL;
  try {
    baseUrl = new URL(siteUrl);
  } catch {
    return null;
  }

  // Strategy 1: Check for <link rel="icon"> in the site URL's HTML
  try {
    const icons = await findIconsInHtml(baseUrl.href);
    for (const iconUrl of icons) {
      const data = await fetchIconAsDataUri(iconUrl, baseUrl);
      if (data) return data;
    }
  } catch { /* continue */ }

  // Strategy 2: If site URL has a path, try the root URL's HTML
  if (baseUrl.pathname !== '/' && baseUrl.pathname !== '') {
    try {
      const rootUrl = baseUrl.origin + '/';
      const icons = await findIconsInHtml(rootUrl);
      for (const iconUrl of icons) {
        const data = await fetchIconAsDataUri(iconUrl, new URL(rootUrl));
        if (data) return data;
      }
    } catch { /* continue */ }
  }

  // Strategy 3: Try /favicon.ico
  try {
    const faviconUrl = `${baseUrl.origin}/favicon.ico`;
    const data = await fetchIconAsDataUri(faviconUrl, baseUrl);
    if (data) return data;
  } catch { /* continue */ }

  // Strategy 4: Try /apple-touch-icon.png
  try {
    const appleIconUrl = `${baseUrl.origin}/apple-touch-icon.png`;
    const data = await fetchIconAsDataUri(appleIconUrl, baseUrl);
    if (data) return data;
  } catch { /* continue */ }

  // Strategy 5: Try /apple-touch-icon-precomposed.png
  try {
    const appleIconUrl = `${baseUrl.origin}/apple-touch-icon-precomposed.png`;
    const data = await fetchIconAsDataUri(appleIconUrl, baseUrl);
    if (data) return data;
  } catch { /* continue */ }

  // Strategy 6: Google Favicon Service as last resort
  // This almost always works and returns a reasonable icon.
  try {
    const googleUrl = `https://www.google.com/s2/favicons?sz=64&domain_url=${encodeURIComponent(baseUrl.origin)}`;
    const data = await fetchIconAsDataUri(googleUrl, baseUrl);
    if (data) {
      log.debug('Icon from Google Favicon Service', { url: baseUrl.origin });
      return data;
    }
  } catch { /* continue */ }

  return null;
}

/**
 * Parse HTML to find all icon URLs, ordered by quality (best first).
 * Looks for: link[rel~=icon], link[rel=apple-touch-icon], og:image, etc.
 */
async function findIconsInHtml(url: string): Promise<string[]> {
  const response = await throttledFetch(url, {
    headers: htmlFetchHeaders(),
    redirect: 'follow',
    timeoutMs: 10_000,
  });

  if (!response.ok) return [];

  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('html')) return [];

  const html = await response.text();
  const icons: Array<{ url: string; size: number; priority: number }> = [];

  // Match all <link> tags with rel containing "icon" (including shortcut icon)
  const linkRegex = /<link\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkRegex.exec(html)) !== null) {
    const tag = match[0];

    const relMatch = tag.match(/rel\s*=\s*["']([^"']+)["']/i);
    if (!relMatch) continue;
    const rel = relMatch[1].toLowerCase();

    const hrefMatch = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[1].trim();
    if (!href) continue;

    // Extract size if available
    const sizeMatch = tag.match(/sizes\s*=\s*["'](\d+)x\d+["']/i);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : 0;

    if (rel.includes('apple-touch-icon')) {
      icons.push({ url: href, size: size || 180, priority: 1 });
    } else if (rel.includes('icon')) {
      // Prefer larger icons, but not too large (>= 32 is ideal)
      icons.push({ url: href, size, priority: size >= 32 ? 2 : 3 });
    }
  }

  // Sort: apple-touch-icon first, then by size descending
  icons.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return b.size - a.size;
  });

  return icons.map(i => i.url);
}

/** Fetch an icon URL and convert to base64 data URI */
async function fetchIconAsDataUri(url: string, baseUrl: URL): Promise<IconData | null> {
  // Handle data: URIs directly
  if (url.startsWith('data:')) {
    const mimeMatch = url.match(/^data:([^;,]+)/);
    if (mimeMatch && (mimeMatch[1].startsWith('image/') || mimeMatch[1] === 'image/svg+xml')) {
      return { data: url, mimeType: mimeMatch[1] };
    }
    return null;
  }

  let resolvedUrl: string;
  try {
    resolvedUrl = new URL(url, baseUrl).href;
  } catch {
    return null;
  }

  const response = await throttledFetch(resolvedUrl, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      Accept: 'image/*, */*',
    },
    redirect: 'follow',
    timeoutMs: 10_000,
  });

  if (!response.ok) return null;

  const contentType = response.headers.get('Content-Type') || '';
  const mimeType = contentType.split(';')[0].trim();

  const buffer = await response.arrayBuffer();

  // Reject if too small (likely a 404 page or empty) or too large
  if (buffer.byteLength < 50 || buffer.byteLength > 2_000_000) {
    return null;
  }

  const bytes = new Uint8Array(buffer);

  // Detect MIME from magic bytes (more reliable than Content-Type)
  const detectedMime = detectImageMime(bytes);

  // Use detected MIME if available, otherwise fall back to Content-Type
  let effectiveMime = detectedMime || mimeType;

  // Validate it's an image
  if (!effectiveMime.startsWith('image/') && effectiveMime !== 'application/octet-stream') {
    // Last resort: check if it's valid image bytes
    if (!detectedMime) return null;
    effectiveMime = detectedMime;
  }

  if (!effectiveMime || effectiveMime === 'application/octet-stream') {
    return null;
  }

  const base64 = Buffer.from(buffer).toString('base64');
  const dataUri = `data:${effectiveMime};base64,${base64}`;

  return { data: dataUri, mimeType: effectiveMime };
}

/** Detect image MIME type from magic bytes */
function detectImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;

  // PNG
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) return 'image/png';
  // JPEG
  if (bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) return 'image/jpeg';
  // GIF (GIF87a or GIF89a)
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
  // WebP (RIFF....WEBP)
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45) return 'image/webp';
  // ICO (00 00 01 00)
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x01 && bytes[3] === 0x00) return 'image/x-icon';
  // CUR (00 00 02 00)
  if (bytes[0] === 0x00 && bytes[1] === 0x00 && bytes[2] === 0x02 && bytes[3] === 0x00) return 'image/x-icon';
  // BMP
  if (bytes[0] === 0x42 && bytes[1] === 0x4D) return 'image/bmp';

  // SVG detection (text-based)
  const text = new TextDecoder().decode(bytes.subarray(0, Math.min(512, bytes.length)));
  if (text.includes('<svg') || (text.includes('<?xml') && text.includes('<svg'))) return 'image/svg+xml';

  return null;
}

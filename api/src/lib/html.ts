/**
 * Known ad, tracking, and social media image domains/patterns.
 */
const AD_TRACKING_DOMAINS = /(?:^|\/)(?:(?:ads?|pixel|tracker|analytics|beacon|stat[s]?)\.|(?:doubleclick|googlesyndication|google-analytics|googleadservices|moatads|amazon-adsystem|facebook\.com\/tr|platform\.twitter\.com\/widgets|feeds\.feedburner\.com\/~ff|feedsportal\.com|stats\.wp\.com|s\.gravatar\.com\/avatar|i[0-9]\.wp\.com.*\?(?:resize=1|w=1|h=1)|fbcdn\.net))/i;

const SOCIAL_ICON_PATTERNS = /(?:\/(?:share|social|follow|like|tweet|fb|facebook|twitter|linkedin|pinterest|whatsapp|telegram|email|rss)[-_]?(?:icon|button|badge|logo|count|btn|widget)|\/(?:flattr|paypal|patreon)[-_]?(?:icon|button|badge)|(?:feedburner|feedblitz)(?:\/|-)|(?:facebook|twitter|x-twitter|linkedin|pinterest|whatsapp|telegram|reddit|email|rss|mastodon)[-_](?:icon|logo|button|badge|share|btn)\.\w{3,4}(?:\?|$)|\/(?:facebook|twitter|linkedin|pinterest|whatsapp|telegram|reddit|email|rss|mastodon|x-twitter)\.\w{3,4}(?:\?|$))/i;

/** Strip <script> tags and event handler attributes from HTML */
export function sanitizeHtml(html: string): string {
  // Remove <script> tags and their content
  let clean = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  // Remove event handler attributes (onclick, onerror, etc.)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  return clean;
}

/** Rewrite relative URLs in HTML to absolute using a base URL */
export function resolveRelativeUrls(html: string, baseUrl: string): string {
  if (!baseUrl) return html;
  try {
    const base = new URL(baseUrl);
    // Rewrite src and href attributes
    return html.replace(
      /((?:src|href)\s*=\s*["'])(?!(?:https?:|data:|mailto:|#|javascript:))([^"']+)(["'])/gi,
      (_, prefix, url, suffix) => {
        try {
          const resolved = new URL(url, base).href;
          return `${prefix}${resolved}${suffix}`;
        } catch {
          return `${prefix}${url}${suffix}`;
        }
      }
    );
  } catch {
    return html;
  }
}

/**
 * Extract the first meaningful image URL from HTML content.
 * Skips tracking pixels (1x1, 0x0), data: URIs, SVG images,
 * and images with explicitly small dimensions (< 75px).
 * Also resolves lazy-loaded images from data-src attributes.
 */
export function extractFirstImage(html: string, baseUrl?: string): string {
  if (!html) return '';

  // First try <figure> and <picture> elements which usually contain the hero image
  const figureRegex = /<(?:figure|picture)\b[^>]*>[\s\S]*?<img\s+[^>]*?(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/(?:figure|picture)>/gi;
  let figMatch: RegExpExecArray | null;
  while ((figMatch = figureRegex.exec(html)) !== null) {
    const tag = figMatch[0];
    const url = extractBestImgUrl(tag, baseUrl);
    if (url && isGoodImage(url, tag)) return url;
  }

  // Then try og:image or meta image tags embedded in content
  const ogMatch = html.match(/<meta\s+[^>]*?(?:property|name)\s*=\s*["']og:image["'][^>]*?content\s*=\s*["']([^"']+)["']/i)
    || html.match(/<meta\s+[^>]*?content\s*=\s*["']([^"']+)["'][^>]*?(?:property|name)\s*=\s*["']og:image["']/i);
  if (ogMatch?.[1]) {
    const url = resolveUrl(ogMatch[1], baseUrl);
    if (url) return url;
  }

  // Match <img> tags and capture src + data-src attributes
  const imgRegex = /<img\s+[^>]*?(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = imgRegex.exec(html)) !== null) {
    const tag = match[0];
    const url = extractBestImgUrl(tag, baseUrl);
    if (url && isGoodImage(url, tag)) return url;
  }

  return '';
}

/** Check if an image URL / tag represents a meaningful (non-tiny, non-SVG) image */
function isGoodImage(url: string, tag: string): boolean {
  // Skip SVG images
  if (/\.svg(?:\?|$)/i.test(url) || url.startsWith('data:image/svg')) return false;

  // Skip data: URIs (except large base64 which might be real images)
  if (url.startsWith('data:')) return false;

  // Skip images from known ad/tracking/social domains
  if (AD_TRACKING_DOMAINS.test(url)) return false;

  // Skip common social sharing / count badge images
  if (SOCIAL_ICON_PATTERNS.test(url)) return false;

  // Skip tracking pixels and tiny images
  if (/(?:width|height)\s*=\s*["']?([01]|[0-9]{1,2})(?:px)?["']?/i.test(tag)) {
    // Extract actual dimension values
    const wMatch = tag.match(/width\s*=\s*["']?(\d+)/i);
    const hMatch = tag.match(/height\s*=\s*["']?(\d+)/i);
    const w = wMatch ? parseInt(wMatch[1], 10) : 999;
    const h = hMatch ? parseInt(hMatch[1], 10) : 999;
    if (w < 75 || h < 75) return false;
  }

  // Skip known tracking/pixel patterns in tag attributes or alt text
  if (/\btracking\b|\bpixel\b|\bbeacon\b|\bspacer\b|\bblank\b|\btransparent\b/i.test(tag)) return false;
  if (/\btracking\b|\bpixel\b|\bbeacon\b|\bspacer\b/i.test(url)) return false;

  return true;
}

/**
 * Extract the best image URL from an <img> (or surrounding figure) tag.
 * Priority: data-src > real src > largest srcset entry.
 * Falls back to srcset when src is absent, a data-URI, or a known placeholder.
 */
function extractBestImgUrl(tag: string, baseUrl?: string): string {
  const dataSrcMatch = tag.match(/data-src\s*=\s*["']([^"']+)["']/i);
  const srcMatch     = tag.match(/\bsrc\s*=\s*["']([^"']+)["']/i);

  let url = '';
  if (dataSrcMatch?.[1] && !dataSrcMatch[1].startsWith('data:')) {
    url = dataSrcMatch[1];
  } else if (srcMatch?.[1] && !srcMatch[1].startsWith('data:')) {
    url = srcMatch[1];
  }

  // Fall back to srcset when src is missing or looks like a lazy-load placeholder
  const isPlaceholder = !url || /(?:pixel|blank|spacer|placeholder|1[xX]1)/i.test(url);
  if (isPlaceholder) {
    const srcsetRaw = (tag.match(/data-srcset\s*=\s*["']([^"']+)["']/i)
                    || tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i))?.[1];
    if (srcsetRaw) {
      let bestUrl = ''; let bestW = 0;
      for (const part of srcsetRaw.split(',')) {
        const [candidate, descriptor] = part.trim().split(/\s+/);
        if (!candidate) continue;
        const w = descriptor?.endsWith('w') ? parseInt(descriptor, 10) : 1;
        if (w > bestW) { bestW = w; bestUrl = candidate; }
      }
      if (bestUrl) url = bestUrl;
    }
  }

  if (!url) return '';
  return resolveUrl(url, baseUrl) || '';
}

/** Resolve a potentially relative URL */
function resolveUrl(url: string, baseUrl?: string): string {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (baseUrl) {
    try {
      return new URL(url, baseUrl).href;
    } catch { return ''; }
  }
  return '';
}

/**
 * Resolve lazy-loaded images: replace src with data-src/data-original/etc.
 */
export function resolveLazyImages(html: string): string {
  // List of data attributes commonly used for lazy loading (in priority order)
  const lazyAttrs = [
    'data-src', 'data-original', 'data-orig', 'data-url',
    'data-lazy-src', 'data-ori-file', 'data-large-file',
    'data-medium-file', 'data-2000src', 'data-1000src', 'data-800src',
    'data-655src', 'data-500src', 'data-380src',
  ];

  return html.replace(/<img\s+[^>]*>/gi, (tag) => {
    const srcMatch = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i);
    const src = srcMatch?.[1] || '';
    // Consider src a placeholder if absent, a data-URI, or a known lazy-load pattern
    const isPlaceholder = !src
      || src.startsWith('data:')
      || /(?:pixel|blank|spacer|placeholder|1[xX]1)/i.test(src)
      || /^https?:\/\/[^/]+\/[^/]*(?:pixel|blank|spacer)/i.test(src);

    if (!isPlaceholder) return tag; // Has a real src already

    // Try each lazy data-* attribute
    for (const attr of lazyAttrs) {
      const re = new RegExp(`${attr}\\s*=\\s*["']([^"']+)["']`, 'i');
      const m = tag.match(re);
      if (m && m[1] && !m[1].startsWith('data:')) {
        return srcMatch
          ? tag.replace(/\bsrc\s*=\s*["'][^"']*["']/i, `src="${m[1]}"`)
          : tag.replace(/<img\s/i, `<img src="${m[1]}" `);
      }
    }

    // Last resort: pick the largest URL from srcset / data-srcset
    const srcsetRaw = (tag.match(/data-srcset\s*=\s*["']([^"']+)["']/i)
                    || tag.match(/\bsrcset\s*=\s*["']([^"']+)["']/i))?.[1];
    if (srcsetRaw) {
      let bestUrl = ''; let bestW = 0;
      for (const part of srcsetRaw.split(',')) {
        const [candidate, descriptor] = part.trim().split(/\s+/);
        if (!candidate) continue;
        const w = descriptor?.endsWith('w') ? parseInt(descriptor, 10) : 1;
        if (w > bestW) { bestW = w; bestUrl = candidate; }
      }
      if (bestUrl) {
        return srcMatch
          ? tag.replace(/\bsrc\s*=\s*["'][^"']*["']/i, `src="${bestUrl}"`)
          : tag.replace(/<img\s/i, `<img src="${bestUrl}" `);
      }
    }

    return tag;
  });
}

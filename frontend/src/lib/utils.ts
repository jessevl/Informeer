// Re-export cn from Frameer design system
export { cn } from '@frameer/lib/design-system';

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Future date
  if (diffMs < 0) {
    const absDiffMs = -diffMs;
    const absSecs = Math.floor(absDiffMs / 1000);
    const absMins = Math.floor(absSecs / 60);
    const absHours = Math.floor(absMins / 60);
    const absDays = Math.floor(absHours / 24);

    if (absSecs < 60) return 'in a moment';
    if (absMins < 60) return `in ${absMins}m`;
    if (absHours < 24) return `in ${absHours}h`;
    if (absDays < 7) return `in ${absDays}d`;
    return date.toLocaleDateString();
  }

  // Past date
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format reading time
 */
export function formatReadingTime(minutes: number): string {
  if (minutes < 1) {
    return '< 1 min';
  } else if (minutes === 1) {
    return '1 min';
  } else {
    return `${minutes} min`;
  }
}

/**
 * Format duration for audio/video
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length).trim() + '…';
}

/**
 * Strip HTML tags from content
 */
export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

/**
 * Get excerpt from HTML content
 */
export function getExcerpt(html: string, maxLength = 200): string {
  const text = stripHtml(html);
  return truncate(text, maxLength);
}

/**
 * Extract first image URL from HTML content
 */
/** Patterns for images that should be skipped as "first image" (favicons, social icons, tracking pixels, etc.) */
const BAD_IMAGE_PATTERN = /(?:favicon|(?:\/share|social|follow|like|tweet|fb|facebook|twitter|linkedin|pinterest)[-_]?(?:icon|button|badge|logo)|\/(?:flattr|paypal|patreon)[-_]?(?:icon|button|badge)|feedburner|feeds\.feedburner\.com|doubleclick|googlesyndication|google-analytics|platform\.twitter\.com|gravatar\.com\/avatar|wp\.com.*\?(?:resize=1|w=1|h=1)|fbcdn\.net|sharethis|addthis|\/(?:facebook|twitter|linkedin|pinterest|whatsapp|telegram|reddit|email|rss|mastodon|x-twitter)\.\w{3,4}(?:\?|$))/i;
const SOCIAL_LINK_PATTERN = /(?:facebook\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.com|reddit\.com|whatsapp:|t\.me\/|telegram\.me\/|mailto:|sharethis|addthis)/i;
const SOCIAL_CONTAINER_PATTERN = /(?:^|[^a-z])(share|sharing|social|follow|addthis|sharethis)(?:[^a-z]|$)/i;
const SOCIAL_ICON_PATTERN = /(?:^|[^a-z])(facebook|twitter|linkedin|pinterest|reddit|whatsapp|telegram|email|mastodon|rss|icon|icons|logo|badge|button)(?:[^a-z]|$)/i;

function getElementHints(el: Element | null): string {
  if (!el) return '';
  return [
    el.getAttribute('class') || '',
    el.getAttribute('id') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('title') || '',
    el.getAttribute('alt') || '',
    el.getAttribute('role') || '',
    el.getAttribute('href') || '',
    el.getAttribute('src') || '',
  ].join(' ');
}

function isSocialContainer(el: Element | null): boolean {
  let current = el;
  let depth = 0;
  while (current && depth < 4) {
    const hints = getElementHints(current);
    if (SOCIAL_CONTAINER_PATTERN.test(hints) || SOCIAL_ICON_PATTERN.test(hints)) {
      return true;
    }
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

function isGoodImageUrl(url: string, tag: string, hints = ''): boolean {
  if (!url) return false;
  // Skip data URIs, SVGs, and tracking/social images
  if (url.startsWith('data:') || /\.svg(\?|$)/i.test(url)) return false;
  if (BAD_IMAGE_PATTERN.test(url)) return false;
  if (SOCIAL_ICON_PATTERN.test(hints)) return false;
  // Skip images with explicitly small dimensions in the tag (< 50px)
  const widthMatch = tag.match(/width=["']?(\d+)/i);
  const heightMatch = tag.match(/height=["']?(\d+)/i);
  if (widthMatch && parseInt(widthMatch[1]) < 50) return false;
  if (heightMatch && parseInt(heightMatch[1]) < 50) return false;
  return true;
}

export function extractFirstImage(html: string): string | null {
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (!src || isSocialContainer(img)) continue;
    if (isGoodImageUrl(src, img.outerHTML, getElementHints(img))) return src;
  }

  for (const source of Array.from(doc.querySelectorAll('picture source, source'))) {
    const srcset = source.getAttribute('srcset') || '';
    const firstSrc = srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
    if (!firstSrc || isSocialContainer(source)) continue;
    if (isGoodImageUrl(firstSrc, source.outerHTML, getElementHints(source))) return firstSrc;
  }
  
  // Try to find an og:image or similar in the content
  const ogMatch = html.match(/og:image[^>]+content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1];
  
  return null;
}

function removeElementOrEmptyWrapper(el: Element): void {
  const parent = el.parentElement;
  if (parent && (
    parent.tagName === 'FIGURE' ||
    parent.tagName === 'PICTURE' ||
    parent.tagName === 'A' ||
    parent.tagName === 'P' ||
    parent.tagName === 'DIV' ||
    parent.tagName === 'SPAN'
  ) && parent.children.length === 1 && !parent.textContent?.trim()) {
    parent.remove();
    return;
  }
  el.remove();
}

function isLikelySocialShareElement(el: Element): boolean {
  const hints = getElementHints(el);
  const text = (el.textContent || '').trim();
  const linkHrefs = Array.from(el.querySelectorAll('a')).map(a => a.getAttribute('href') || '');
  const hasSocialLink = linkHrefs.some(href => SOCIAL_LINK_PATTERN.test(href)) || SOCIAL_LINK_PATTERN.test(hints);
  const hasSocialHints = SOCIAL_CONTAINER_PATTERN.test(hints) || SOCIAL_ICON_PATTERN.test(hints);
  const hasIconOnlyContent = !!el.querySelector('svg, img, i') && text.length < 40;
  const isCompactWidget = el.children.length > 0 && el.children.length <= 8 && text.length < 80;

  return (hasSocialLink && (hasSocialHints || hasIconOnlyContent || isCompactWidget)) ||
    (hasSocialHints && hasIconOnlyContent && isCompactWidget);
}

export function sanitizeArticleHtml(html: string): string {
  if (!html) return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (!isGoodImageUrl(src, img.outerHTML, getElementHints(img)) || isSocialContainer(img)) {
      removeElementOrEmptyWrapper(img);
    }
  }

  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (isLikelySocialShareElement(el)) {
      removeElementOrEmptyWrapper(el);
    }
  }

  for (const el of Array.from(doc.body.querySelectorAll('p, div, section, aside'))) {
    if (!el.textContent?.trim() && el.querySelectorAll('img, iframe, video, audio, svg').length === 0) {
      el.remove();
    }
  }

  return doc.body.innerHTML;
}

/**
 * Remove the first image from HTML content if it matches the cover image
 * This prevents showing duplicate images when cover image is displayed
 */
export function removeFirstImageFromContent(html: string, coverImageUrl: string | null): string {
  if (!html || !coverImageUrl) return html;
  
  // Parse the HTML
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  // Find the first img element
  const firstImg = doc.querySelector('img');
  if (!firstImg) return html;
  
  const imgSrc = firstImg.getAttribute('src');
  if (!imgSrc) return html;
  
  // Check if this image matches or is similar to the cover image
  // Compare by checking if URLs match or if they're from the same source
  const isSameImage = imgSrc === coverImageUrl || 
    imgSrc.includes(coverImageUrl) || 
    coverImageUrl.includes(imgSrc) ||
    // Also check if it's the same filename (handles CDN variants)
    extractFilename(imgSrc) === extractFilename(coverImageUrl);
  
  if (isSameImage) {
    // Remove the img element
    // Also remove parent element if it's a figure, picture, or wrapper div
    const parent = firstImg.parentElement;
    if (parent && (
      parent.tagName === 'FIGURE' || 
      parent.tagName === 'PICTURE' ||
      (parent.tagName === 'A' && parent.children.length === 1) ||
      (parent.tagName === 'P' && parent.children.length === 1 && !parent.textContent?.trim())
    )) {
      parent.remove();
    } else {
      firstImg.remove();
    }
    
    return doc.body.innerHTML;
  }
  
  return html;
}

/**
 * Extract filename from URL for comparison
 */
function extractFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || '';
  } catch {
    return url.split('/').pop() || '';
  }
}

/**
 * Check if entry has media (podcast/video)
 */
export function hasMedia(enclosures: { mime_type: string }[] | null): boolean {
  if (!enclosures || enclosures.length === 0) return false;
  return enclosures.some(
    (e) => e.mime_type.startsWith('audio/') || e.mime_type.startsWith('video/')
  );
}

/**
 * Get media type from enclosures
 */
export function getMediaType(
  enclosures: { mime_type: string }[] | null
): 'audio' | 'video' | null {
  if (!enclosures || enclosures.length === 0) return null;
  
  const media = enclosures.find(
    (e) => e.mime_type.startsWith('audio/') || e.mime_type.startsWith('video/')
  );
  
  if (!media) return null;
  return media.mime_type.startsWith('audio/') ? 'audio' : 'video';
}

/**
 * Check if URL is a YouTube video
 */
export function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(url);
}

/**
 * Extract YouTube video ID from URL
 * Supports: watch, embed, shorts, live, youtu.be, and v/ formats
 */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,  // YouTube Shorts
    /youtube\.com\/live\/([^&\n?#]+)/,    // YouTube Live
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Strip YouTube embeds (iframes) from HTML content
 * This prevents duplicate video players when we have our own video player
 * Also extracts YouTube IDs found in the content
 */
export function stripYouTubeEmbeds(html: string): { html: string; youtubeIds: string[] } {
  if (!html) return { html, youtubeIds: [] };
  
  const youtubeIds: string[] = [];
  
  // Parse the HTML
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  // Find all iframes that are YouTube embeds
  const iframes = doc.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src') || '';
    if (isYouTubeUrl(src) || src.includes('youtube.com/embed') || src.includes('youtube-nocookie.com/embed')) {
      // Extract video ID from the embed URL
      const videoId = extractYouTubeId(src);
      if (videoId && !youtubeIds.includes(videoId)) {
        youtubeIds.push(videoId);
      }
      
      // Remove the iframe
      // Also check if parent is a div wrapper and remove it too
      const parent = iframe.parentElement;
      if (parent && (
        parent.tagName === 'DIV' && parent.children.length === 1 ||
        parent.tagName === 'P' && parent.children.length === 1 && !parent.textContent?.trim() ||
        parent.tagName === 'FIGURE'
      )) {
        parent.remove();
      } else {
        iframe.remove();
      }
    }
  });
  
  // Also look for object/embed tags that might contain YouTube
  const objects = doc.querySelectorAll('object, embed');
  objects.forEach(obj => {
    const data = obj.getAttribute('data') || obj.getAttribute('src') || '';
    if (isYouTubeUrl(data) || data.includes('youtube.com')) {
      const videoId = extractYouTubeId(data);
      if (videoId && !youtubeIds.includes(videoId)) {
        youtubeIds.push(videoId);
      }
      
      const parent = obj.parentElement;
      if (parent && parent.tagName === 'OBJECT' && parent.children.length <= 2) {
        parent.remove();
      } else if (parent && parent.children.length === 1) {
        parent.remove();
      } else {
        obj.remove();
      }
    }
  });
  
  return { html: doc.body.innerHTML, youtubeIds };
}

// Re-export cn from Frameer design system
export { cn } from '@frameer/lib/design-system';

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
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
export function extractFirstImage(html: string): string | null {
  if (!html) return null;
  
  // Try to find an img tag
  const imgMatch = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  if (imgMatch) return imgMatch[1];
  
  // Try to find a picture/source tag
  const srcsetMatch = html.match(/<source[^>]+srcset=["']([^\s"']+)/i);
  if (srcsetMatch) return srcsetMatch[1];
  
  // Try to find an og:image or similar in the content
  const ogMatch = html.match(/og:image[^>]+content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1];
  
  return null;
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

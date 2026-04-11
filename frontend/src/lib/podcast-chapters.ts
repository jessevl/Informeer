/**
 * Podcast Chapter Utilities
 * Extracts chapter timestamps from podcast show notes / entry content.
 * Podcasts often include timestamps like "00:05:30 - Topic Name" in descriptions.
 */

export interface PodcastChapter {
  time: number; // seconds
  title: string;
  formattedTime: string;
}

const TIMESTAMP_RE = /(?:^|\n)\s*(?:\[?\s*)?(\d{1,2}:\d{2}(?::\d{2})?)\s*(?:\]?\s*)?[-–—:)]\s*(.+?)(?:\n|$)/g;

/**
 * Extract chapters from HTML/text content by finding timestamp patterns.
 * Common formats:
 *   00:05:30 - Introduction
 *   [05:30] Chapter Title
 *   1:23:45 — Deep Dive
 */
export function extractChapters(htmlContent: string): PodcastChapter[] {
  // Strip HTML tags for simpler matching
  const text = htmlContent
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ');

  const chapters: PodcastChapter[] = [];
  let match: RegExpExecArray | null;
  
  while ((match = TIMESTAMP_RE.exec(text)) !== null) {
    const [, timestamp, title] = match;
    const time = parseTimestamp(timestamp);
    if (time >= 0 && title.trim()) {
      chapters.push({
        time,
        title: title.trim(),
        formattedTime: timestamp,
      });
    }
  }

  // Only return if we found at least 2 chapters (single timestamp likely isn't chapters)
  if (chapters.length < 2) return [];
  
  // Sort by time
  chapters.sort((a, b) => a.time - b.time);
  
  return chapters;
}

function parseTimestamp(ts: string): number {
  const parts = ts.split(':').map(Number);
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  return -1;
}

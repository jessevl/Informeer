/** Estimate reading time in minutes from HTML content */
export function estimateReadingTime(html: string, wpm = 265): number {
  // Strip HTML tags
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wordCount = text.split(' ').filter(w => w.length > 0).length;
  return Math.max(1, Math.round(wordCount / wpm));
}

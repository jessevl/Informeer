import { readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

/**
 * Calculate sizes of cache sub-directories. Shared between health and settings routes.
 */
export function getCacheStats(cacheDir: string): {
  covers_bytes: number;
  pdfs_bytes: number;
  cover_count: number;
  pdf_count: number;
} {
  let covers_bytes = 0, pdfs_bytes = 0, cover_count = 0, pdf_count = 0;

  for (const [subdir, stats] of [
    ['covers', { bytes: 0, count: 0 }],
    ['pdfs', { bytes: 0, count: 0 }],
  ] as const) {
    const dir = join(cacheDir, subdir);
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir);
      for (const f of files) {
        try {
          const s = statSync(join(dir, f));
          if (subdir === 'covers') { covers_bytes += s.size; cover_count++; }
          else { pdfs_bytes += s.size; pdf_count++; }
        } catch { /* skip unreadable files */ }
      }
    } catch { /* skip unreadable dirs */ }
  }

  return { covers_bytes, pdfs_bytes, cover_count, pdf_count };
}

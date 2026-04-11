/**
 * Cache Manager
 *
 * Handles age-based and size-based eviction of cached files (PDFs, covers).
 * Runs periodically and can be triggered manually via the settings/cleanup API.
 */

import { readdirSync, statSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { config } from '../config.ts';
import { getDb } from '../db/connection.ts';
import { getSetting } from './settings.ts';
import { log } from '../lib/logger.ts';

const CACHE_DIR = join(config.dataDir, 'cache');
const PDF_DIR = join(CACHE_DIR, 'pdfs');
const COVER_DIR = join(CACHE_DIR, 'covers');

// ---------------------------------------------------------------------------
// Cleanup logic
// ---------------------------------------------------------------------------

interface CacheFile {
  path: string;
  mtimeMs: number;
  size: number;
}

function listCacheFiles(): CacheFile[] {
  const all: CacheFile[] = [];
  for (const dir of [PDF_DIR, COVER_DIR]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const filePath = join(dir, file);
      try {
        const stats = statSync(filePath);
        if (stats.isFile()) {
          all.push({ path: filePath, mtimeMs: stats.mtimeMs, size: stats.size });
        }
      } catch { /* skip unreadable files */ }
    }
  }
  return all;
}

/** Remove files older than maxAgeDays. Returns count of files removed. */
function cleanupByAge(maxAgeDays: number): number {
  const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - maxAge;
  let removed = 0;

  for (const dir of [PDF_DIR, COVER_DIR]) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      const filePath = join(dir, file);
      try {
        const stats = statSync(filePath);
        if (stats.isFile() && stats.mtimeMs < cutoff) {
          unlinkSync(filePath);
          removed++;
        }
      } catch { /* skip */ }
    }
  }

  if (removed > 0) {
    log.info('[cache] Age cleanup', { removed, max_age_days: maxAgeDays });
  }
  return removed;
}

/** Evict oldest files when total cache exceeds maxSizeMB. Returns count removed. */
function evictBySize(maxSizeMB: number): number {
  const all = listCacheFiles();
  let totalSize = all.reduce((sum, f) => sum + f.size, 0);
  const maxBytes = maxSizeMB * 1024 * 1024;

  if (totalSize <= maxBytes) return 0;

  // Sort oldest first
  all.sort((a, b) => a.mtimeMs - b.mtimeMs);

  let removed = 0;
  for (const file of all) {
    if (totalSize <= maxBytes) break;
    try {
      unlinkSync(file.path);
      totalSize -= file.size;
      removed++;
    } catch { /* skip */ }
  }

  if (removed > 0) {
    log.info('[cache] Size eviction', { removed, max_size_mb: maxSizeMB });
  }
  return removed;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CleanupResult {
  byAge: number;
  bySize: number;
}

/** Run a full cleanup cycle using current settings. */
export function runCacheCleanup(): CleanupResult {
  const maxAgeDays = getSetting<number>('cache.max_age_days') ?? 90;
  const maxSizeMB = getSetting<number>('cache.max_size_mb') ?? 500;

  const byAge = cleanupByAge(maxAgeDays);
  const bySize = evictBySize(maxSizeMB);

  // Remove cache files whose DB entries no longer exist (feed deletion, retention, etc.)
  cleanOrphanedCacheFiles();

  return { byAge, bySize };
}

/**
 * Remove cover/PDF cache files that no longer have a matching entry in the DB.
 * Handles orphans from: feed deletion, retention cleanup, module limit changes.
 */
export function cleanOrphanedCacheFiles(): number {
  const db = getDb();
  let removed = 0;

  const checks: Array<{ dir: string; prefix: string; ext: string }> = [
    { dir: COVER_DIR, prefix: 'nrc-', ext: '.jpg' },
    { dir: COVER_DIR, prefix: 'mag-', ext: '.jpg' },
    { dir: PDF_DIR,   prefix: 'nrc-', ext: '.pdf' },
    { dir: PDF_DIR,   prefix: 'mag-', ext: '.pdf' },
  ];

  for (const { dir, prefix, ext } of checks) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir)) {
      if (!file.startsWith(prefix) || !file.endsWith(ext)) continue;
      // Extract hash: "nrc-2026-03-14.jpg" → "nrc-2026-03-14"
      const hash = file.slice(0, -ext.length);
      const exists = db.query('SELECT 1 FROM entries WHERE hash = ? LIMIT 1').get(hash);
      if (!exists) {
        try {
          unlinkSync(join(dir, file));
          removed++;
        } catch { /* ignore */ }
      }
    }
  }

  if (removed > 0) {
    log.info('[cache] Orphan cleanup', { removed });
  }
  return removed;
}

/** Start the periodic cleanup timer. Called once at server startup. */
export function startCacheCleanupScheduler(): void {
  const intervalHours = 24;
  const intervalMs = intervalHours * 60 * 60 * 1000;

  log.info('[cache] Cleanup scheduler started', { interval_hours: intervalHours });

  // Run once shortly after startup
  setTimeout(() => runCacheCleanup(), 30_000);

  // Then periodically
  setInterval(() => runCacheCleanup(), intervalMs);
}

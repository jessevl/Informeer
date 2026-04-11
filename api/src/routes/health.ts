import { Hono } from 'hono';
import { getDb } from '../db/connection.ts';
import { getSetting } from '../services/settings.ts';
import { config } from '../config.ts';
import { statSync } from 'fs';
import { join } from 'path';
import { getCacheStats } from '../lib/cache-stats.ts';

const health = new Hono();

health.get('/health', (c) => {
  const db = getDb();

  // Database stats
  const entryCount = db.query('SELECT COUNT(*) as count FROM entries').get() as { count: number };
  const feedCount = db.query('SELECT COUNT(*) as count FROM feeds WHERE disabled = 0').get() as { count: number };
  const erroringCount = db.query(
    "SELECT COUNT(*) as count FROM feeds WHERE parsing_error_count > 0 AND disabled = 0"
  ).get() as { count: number };

  // Database file size
  let dbSizeMb = 0;
  try {
    const stat = statSync(config.databasePath);
    dbSizeMb = Math.round((stat.size / 1024 / 1024) * 10) / 10;
  } catch { /* file might not exist yet */ }

  // Cache stats (shared utility)
  const cache = getCacheStats(join(config.dataDir, 'cache'));
  const cacheSizeMb = Math.round(((cache.covers_bytes + cache.pdfs_bytes) / 1024 / 1024) * 10) / 10;

  // Module status
  const nrcEnabled = getSetting<boolean>('modules.nrc.enabled') === true;
  const magazinelibEnabled = getSetting<boolean>('modules.magazinelib.enabled') === true;
  const booksEnabled = getSetting<boolean>('modules.books.enabled') === true;
  const booksZlibEnabled = getSetting<boolean>('modules.books.zlib_enabled') !== false;

  return c.json({
    status: 'ok',
    version: '0.1.0',
    modules: {
      nrc: { enabled: nrcEnabled },
      magazinelib: { enabled: magazinelibEnabled },
      books: { enabled: booksEnabled, zlib_enabled: booksZlibEnabled },
    },
    scheduler: {
      running: true,
      feeds: feedCount.count,
      erroring: erroringCount.count,
    },
    database: {
      entries: entryCount.count,
      size_mb: dbSizeMb,
    },
    cache: {
      pdfs: cache.pdf_count,
      covers: cache.cover_count,
      size_mb: cacheSizeMb,
    },
  });
});

export default health;

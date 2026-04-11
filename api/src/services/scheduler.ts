import { getDb } from '../db/connection.ts';
import { getSetting } from './settings.ts';
import { estimateReadingTime } from './reading-time.ts';
import { extractContent } from './content-extractor.ts';
import type { FeedExtractOptions } from './content-extractor.ts';
import { discoverAndStoreIcon } from './icon-fetcher.ts';
import type { ContentSource, Feed, NewEntry } from '../sources/types.ts';
import { RSSSource } from '../sources/rss.ts';
import { NRCSource } from '../sources/nrc.ts';
import { MagazineLibSource } from '../sources/magazinelib.ts';
import { log } from '../lib/logger.ts';

/**
 * Scheduler — unified polling loop for all content sources.
 * Handles adaptive intervals, error backoff, and entry deduplication.
 */
export class Scheduler {
  private sources = new Map<string, ContentSource>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private tickInProgress = false;

  constructor() {
    // Register built-in sources
    this.register(new RSSSource());
    this.register(new NRCSource());
    this.register(new MagazineLibSource());
  }

  register(source: ContentSource): void {
    this.sources.set(source.type, source);
  }

  /** Start the scheduler polling loop */
  start(): void {
    if (this.running) return;
    this.running = true;

    const intervalMinutes = getSetting<number>('scheduler.interval_minutes') ?? 60;
    const intervalMs = intervalMinutes * 60 * 1000;

    log.info(`Scheduler starting`, { interval_minutes: intervalMinutes });

    // Run first tick soon after startup (5 seconds delay)
    setTimeout(() => {
      if (this.running) this.tick();
    }, 5000);

    // Then on interval
    this.timer = setInterval(() => {
      if (this.running) this.tick();
    }, intervalMs);

    // Run retention cleanup periodically
    const cleanupHours = getSetting<number>('retention.cleanup_interval_hours') ?? 24;
    setInterval(() => {
      if (this.running) runRetentionCleanup();
    }, cleanupHours * 60 * 60 * 1000);

    // Run cleanup once on startup (after 30s delay to not interfere with first tick)
    setTimeout(() => {
      if (this.running) runRetentionCleanup();
    }, 30_000);
  }

  /** Stop the scheduler */
  stop(): void {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    log.info('Scheduler stopped');
  }

  /** Single tick: fetch all due feeds in batches */
  async tick(): Promise<void> {
    if (this.tickInProgress) {
      console.log('[scheduler] Tick already in progress, skipping');
      return;
    }

    this.tickInProgress = true;
    try {
      const concurrency = getSetting<number>('scheduler.concurrency') ?? 4;
      const db = getDb();

      // Process due feeds in batches until none remain
      let totalProcessed = 0;
      const MAX_BATCHES = 50; // Safety limit to prevent infinite loops
      for (let batch = 0; batch < MAX_BATCHES; batch++) {
        const dueFeeds = db.query(`
          SELECT * FROM feeds
          WHERE disabled = 0
            AND (next_check_at IS NULL OR next_check_at <= datetime('now'))
          ORDER BY next_check_at ASC
          LIMIT ?
        `).all(concurrency) as Feed[];

        if (dueFeeds.length === 0) break;

        log.debug(`Processing batch ${batch + 1}: ${dueFeeds.length} feeds`);

        await Promise.allSettled(
          dueFeeds.map(feed => this.refresh(feed))
        );

        totalProcessed += dueFeeds.length;

        // If we got fewer than concurrency, no more due feeds
        if (dueFeeds.length < concurrency) break;
      }

      if (totalProcessed > 0) {
        log.info(`Tick complete: processed ${totalProcessed} feeds`);
      }
    } catch (err) {
      log.error('Scheduler tick error', { error: String(err) });
    } finally {
      this.tickInProgress = false;
    }
  }

  /** Refresh a single feed */
  async refresh(feed: Feed): Promise<void> {
    const source = this.sources.get(feed.source_type);
    if (!source) {
      console.warn(`[scheduler] No source for type: ${feed.source_type}`);
      return;
    }

    // Skip if parent module is disabled (only for non-RSS sources)
    if (feed.source_type !== 'rss') {
      const { isModuleEnabled } = await import('./settings.ts');
      if (!isModuleEnabled(feed.source_type)) return;
    }

    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort(), 30_000); // 30s timeout per feed

    try {
      log.debug(`Fetching feed`, { feed_id: feed.id, title: feed.title });
      const result = await source.fetch(feed, abort.signal);

      const newCount = upsertEntries(feed, result.entries);

      // Mark all entries for non-RSS feeds as content_fetched = 1 — their content
      // is self-contained (NRC, MagazineLib) and must never be overwritten by the crawler.
      if (feed.source_type !== 'rss') {
        const db3 = getDb();
        db3.run(`UPDATE entries SET content_fetched = 1 WHERE feed_id = ? AND content_fetched = 0`, [feed.id]);
      }

      updateFeedChecked(feed, {
        etag: result.etag,
        lastModified: result.lastModified,
        hadNewEntries: newCount > 0,
      });

      if (newCount > 0) {
        log.info(`Feed refreshed with new entries`, { feed_id: feed.id, new_entries: newCount });
      }

      // Ensure feed has an icon — re-attempt periodically even if a previous try failed.
      // Feed_icons row is only created on success, so missing = worth retrying.
      const db2 = getDb();
      const hasIcon = db2.query('SELECT 1 FROM feed_icons WHERE feed_id = ?').get(feed.id);
      if (!hasIcon) {
        // Try site_url first (usually the homepage), fall back to feed_url origin
        const iconUrl = feed.site_url || feed.feed_url;
        discoverAndStoreIcon(feed.id, iconUrl).catch(() => {});
      }

      // Fetch full article content for unfetched entries when content_fetch_policy is 'always'.
      // This covers both newly inserted entries AND existing entries whose
      // content_fetched flag was reset (e.g. after changing the fetch policy).
      const policy = (feed as any).content_fetch_policy || (feed.crawler ? 'always' : 'rss_only');
      if (policy === 'always') {
        await crawlUnfetchedEntries(feed);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        updateFeedError(feed, 'Request timed out');
      } else {
        updateFeedError(feed, err.message || 'Unknown error');
      }
      log.warn(`Feed fetch error`, { feed_id: feed.id, error: err.message });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /** Get a registered source (for manual refresh) */
  getSource(type: string): ContentSource | undefined {
    return this.sources.get(type);
  }
}

/**
 * Fetch full article content for entries that haven't been crawled yet
 * (content_fetched = 0). This covers both newly inserted entries and existing
 * entries whose content_fetched flag was reset after a policy change.
 * Passes per-feed settings (scraper_rules, user_agent, cookie) to the extractor.
 * Sets content_fetched = 1 so we don't re-fetch when the user opens the article.
 * Runs concurrently but capped to avoid flooding the target site.
 */
async function crawlUnfetchedEntries(feed: Feed): Promise<void> {
  // Only crawl standard RSS feeds — never NRC, MagazineLib, or other module sources
  if (feed.source_type !== 'rss') return;
  const db = getDb();
  const wpm = getSetting<number>('content.reading_time_wpm') ?? 265;
  const maxConcurrent = getSetting<number>('crawler.max_concurrent') ?? 3;
  const requestDelay = getSetting<number>('crawler.request_delay_ms') ?? 500;
  const maxContentKb = getSetting<number>('crawler.max_content_length_kb') ?? 512;

  const entries = db.query(
    "SELECT id, url FROM entries WHERE feed_id = ? AND content_fetched = 0 AND url != '' ORDER BY published_at DESC LIMIT 20"
  ).all(feed.id) as Array<{ id: number; url: string }>;

  if (entries.length === 0) return;

  log.debug('Crawler: fetching full content for unfetched entries', {
    feed_id: feed.id,
    count: entries.length,
  });

  // Build per-feed extraction options from feed settings
  const feedOpts: FeedExtractOptions = {};
  if (feed.scraper_rules) feedOpts.scraperRules = feed.scraper_rules;
  if (feed.user_agent) feedOpts.userAgent = feed.user_agent;
  if (feed.cookie) feedOpts.cookie = feed.cookie;

  // Crawl entries SEQUENTIALLY — one at a time per feed.
  // Using concurrent/batched fetches to the same domain triggers socket-reuse
  // bugs in Bun's native HTTP client that cause SIGSEGV crashes. Sequential
  // processing avoids this while the per-domain rate limiter in throttledFetch
  // still enforces politeness toward external servers.
  for (const entry of entries) {
    try {
      const extracted = await extractContent(entry.url, feedOpts);
      if (extracted?.content) {
        // Truncate excessively large content to stay lean
        let contentToStore = extracted.content;
        if (contentToStore.length > maxContentKb * 1024) {
          contentToStore = contentToStore.substring(0, maxContentKb * 1024);
          log.debug('Crawler: truncated oversized content', {
            entry_id: entry.id, original_kb: Math.round(extracted.content.length / 1024),
          });
        }
        const readingTime = estimateReadingTime(contentToStore, wpm);
        db.run(
          "UPDATE entries SET content = ?, reading_time = ?, content_fetched = 1, image_url = CASE WHEN image_url = '' THEN ? ELSE image_url END, changed_at = datetime('now') WHERE id = ?",
          [contentToStore, readingTime, extracted.imageUrl || '', entry.id]
        );
      }
    } catch (err: any) {
      log.debug('Crawler: failed to fetch content', {
        entry_id: entry.id,
        url: entry.url,
        error: err.message,
      });
    }
    // Small delay between requests to be a good citizen
    if (requestDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, requestDelay));
    }
  }

  log.debug('Crawler: done', { feed_id: feed.id });
}

/**
 * Upsert entries into the database with deduplication.
 * Uses batch prepared statements for performance.
 * Returns the number of newly inserted entries.
 */
export function upsertEntries(feed: Feed, entries: NewEntry[]): number {
  if (entries.length === 0) return 0;

  const db = getDb();
  const wpm = getSetting<number>('content.reading_time_wpm') ?? 265;
  const maxPerFeed = getSetting<number>('retention.max_entries_per_feed') ?? 500;
  let inserted = 0;

  // Sort entries newest-first and cap to maxPerFeed to avoid ingesting
  // more entries than we'll keep (e.g. podcast feeds with 1000+ episodes).
  const sorted = [...entries].sort((a, b) =>
    new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
  );
  const capped = sorted.slice(0, maxPerFeed);

  // Pre-compile all statements outside the transaction for reuse
  const insertEntry = db.prepare(`
    INSERT INTO entries (
      user_id, feed_id, hash, title, url, comments_url,
      author, content, image_url, published_at, reading_time, tags, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unread')
  `);

  const insertEnclosure = db.prepare(`
    INSERT INTO enclosures (user_id, entry_id, url, mime_type, size)
    VALUES (?, ?, ?, ?, ?)
  `);

  // Batch-check existing hashes in one query to avoid N round-trips
  const hashes = capped.map(e => e.hash);
  const placeholders = hashes.map(() => '?').join(',');
  const existingRows = db.query(
    `SELECT hash FROM entries WHERE feed_id = ? AND hash IN (${placeholders})`
  ).all(feed.id, ...hashes) as Array<{ hash: string }>;
  const existingHashes = new Set(existingRows.map(r => r.hash));

  const getLastId = db.prepare('SELECT last_insert_rowid() as id');

  db.transaction(() => {
    for (const entry of capped) {
      // Skip duplicates (already checked in batch)
      if (existingHashes.has(entry.hash)) continue;

      // Calculate reading time
      const readingTime = estimateReadingTime(entry.content, wpm);
      const tags = JSON.stringify(entry.tags || []);

      try {
        insertEntry.run(
          feed.user_id, feed.id, entry.hash, entry.title, entry.url,
          entry.comments_url || '', entry.author, entry.content,
          entry.image_url || '',
          entry.published_at, readingTime, tags
        );

        const entryId = getLastId.get() as { id: number };

        // Insert enclosures
        if (entry.enclosures?.length) {
          for (const enc of entry.enclosures) {
            insertEnclosure.run(
              feed.user_id, entryId.id, enc.url, enc.mime_type, enc.size
            );
          }
        }

        // Track to prevent intra-batch duplicates
        existingHashes.add(entry.hash);
        inserted++;
      } catch (err: any) {
        // UNIQUE constraint violation — skip duplicate
        if (!err.message?.includes('UNIQUE')) {
          log.error('Entry insert error', { error: err.message });
        }
      }
    }
  })();

  return inserted;
}

/**
 * Update feed after successful check.
 * Calculates adaptive next_check_at based on activity.
 */
function updateFeedChecked(
  feed: Feed,
  opts: { etag?: string; lastModified?: string; hadNewEntries: boolean }
): void {
  const db = getDb();

  // Adaptive interval calculation
  const activeInterval = getSetting<number>('scheduler.active_feed_interval') ?? 15;
  const normalInterval = getSetting<number>('scheduler.interval_minutes') ?? 60;
  const slowInterval = getSetting<number>('scheduler.slow_feed_interval') ?? 360;

  let intervalMinutes: number;

  if (opts.hadNewEntries) {
    // Feed is active — check more frequently
    intervalMinutes = activeInterval;
  } else {
    // Check if feed has been idle for 7+ days
    const lastEntry = db.query(
      'SELECT published_at FROM entries WHERE feed_id = ? ORDER BY published_at DESC LIMIT 1'
    ).get(feed.id) as { published_at: string } | null;

    if (lastEntry) {
      const daysSinceLastEntry = (Date.now() - new Date(lastEntry.published_at).getTime()) / (1000 * 60 * 60 * 24);
      intervalMinutes = daysSinceLastEntry > 7 ? slowInterval : normalInterval;
    } else {
      intervalMinutes = normalInterval;
    }
  }

  // Use parameterized interval to prevent SQL injection
  const safeInterval = `+${Math.max(1, Math.round(intervalMinutes))} minutes`;

  const updates: string[] = [
    "checked_at = datetime('now')",
    "next_check_at = datetime('now', ?)",
    "parsing_error_message = ''",
    'parsing_error_count = 0',
  ];
  const params: any[] = [safeInterval];

  if (opts.etag) {
    updates.push('etag_header = ?');
    params.push(opts.etag);
  }
  if (opts.lastModified) {
    updates.push('last_modified_header = ?');
    params.push(opts.lastModified);
  }

  params.push(feed.id);
  db.run(`UPDATE feeds SET ${updates.join(', ')} WHERE id = ?`, params);
}

/**
 * Update feed after an error. Uses exponential backoff.
 */
function updateFeedError(feed: Feed, message: string): void {
  const db = getDb();
  const maxBackoff = getSetting<number>('scheduler.error_max_backoff') ?? 1440;

  // Get current error count
  const current = db.query(
    'SELECT parsing_error_count FROM feeds WHERE id = ?'
  ).get(feed.id) as { parsing_error_count: number } | null;

  const errorCount = (current?.parsing_error_count || 0) + 1;

  // Exponential backoff: 15min, 30min, 60min, 120min, ... capped at maxBackoff
  const backoffMinutes = Math.min(15 * Math.pow(2, errorCount - 1), maxBackoff);
  const safeBackoff = `+${Math.max(1, Math.round(backoffMinutes))} minutes`;

  db.run(`
    UPDATE feeds SET
      checked_at = datetime('now'),
      next_check_at = datetime('now', ?),
      parsing_error_message = ?,
      parsing_error_count = ?
    WHERE id = ?
  `, [safeBackoff, message, errorCount, feed.id]);
}

// ---------------------------------------------------------------------------
// Retention cleanup — removes old entries and reclaims space
// ---------------------------------------------------------------------------

/**
 * Run retention cleanup: remove old entries, enforce per-feed limits,
 * and optionally VACUUM the database.
 */
export function runRetentionCleanup(): void {
  const db = getDb();
  const maxAgeDays = getSetting<number>('retention.max_age_days') ?? 180;
  const maxPerFeed = getSetting<number>('retention.max_entries_per_feed') ?? 500;
  const keepStarred = getSetting<boolean>('retention.keep_starred') !== false;
  const shouldVacuum = getSetting<boolean>('database.vacuum_on_cleanup') !== false;

  let totalDeleted = 0;

  try {
    // 1. Delete entries older than max_age_days (preserve starred if configured)
    const starredClause = keepStarred ? 'AND starred = 0' : '';
    const safeMaxAge = `-${Math.max(1, Math.round(maxAgeDays))} days`;
    db.run(`
      DELETE FROM entries
      WHERE published_at < datetime('now', ?)
        ${starredClause}
    `, [safeMaxAge]);
    const ageChanges = (db.query('SELECT changes() as c').get() as { c: number }).c;
    totalDeleted += ageChanges;

    // 2. Enforce per-feed entry limit in a single query (keep newest, preserve starred)
    //    Uses a window function to rank entries per feed and delete excess rows.
    db.run(`
      DELETE FROM entries WHERE id IN (
        SELECT id FROM (
          SELECT id, feed_id,
            ROW_NUMBER() OVER (PARTITION BY feed_id ORDER BY published_at DESC) as rn
          FROM entries
          WHERE 1=1 ${starredClause}
        ) WHERE rn > ?
      )
    `, [maxPerFeed]);
    const limitChanges = (db.query('SELECT changes() as c').get() as { c: number }).c;
    totalDeleted += limitChanges;

    // 3. Clean up orphaned enclosures (entries already deleted via CASCADE,
    //    but just in case)
    db.run('DELETE FROM enclosures WHERE entry_id NOT IN (SELECT id FROM entries)');

    // 4. Optionally VACUUM to reclaim space
    if (shouldVacuum && totalDeleted > 100) {
      db.run('VACUUM');
      log.info('Database vacuumed after cleanup');
    }

    if (totalDeleted > 0) {
      log.info('Retention cleanup complete', { deleted: totalDeleted });
    }
  } catch (err) {
    log.error('Retention cleanup error', { error: String(err) });
  }
}

/**
 * Get database size info for the settings UI.
 */
export function getDatabaseStats(): { size_bytes: number; entry_count: number; feed_count: number } {
  const db = getDb();
  const pageCount = db.query('PRAGMA page_count').get() as { page_count: number };
  const pageSize = db.query('PRAGMA page_size').get() as { page_size: number };
  const entryCount = db.query('SELECT COUNT(*) as c FROM entries').get() as { c: number };
  const feedCount = db.query('SELECT COUNT(*) as c FROM feeds').get() as { c: number };

  return {
    size_bytes: pageCount.page_count * pageSize.page_size,
    entry_count: entryCount.c,
    feed_count: feedCount.c,
  };
}

// Singleton scheduler instance
let _scheduler: Scheduler | null = null;

export function getScheduler(): Scheduler {
  if (!_scheduler) {
    _scheduler = new Scheduler();
  }
  return _scheduler;
}

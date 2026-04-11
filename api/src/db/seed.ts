import { getDb } from './connection.ts';
import { config } from '../config.ts';
import { hashPassword } from '../lib/crypto.ts';
import { log } from '../lib/logger.ts';

/** Seed default data on first boot: admin user + default settings */
export async function seed(): Promise<void> {
  const db = getDb();

  // Create admin user if no users exist
  const userCount = db.query('SELECT COUNT(*) as count FROM users').get() as { count: number };
  if (userCount.count === 0) {
    const hash = await hashPassword(config.adminPassword);
    db.run(
      'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)',
      [config.adminUsername, hash]
    );
    log.info(`Created admin user: ${config.adminUsername}`);

    // Create default category for the admin user
    const user = db.query('SELECT id FROM users WHERE username = ?').get(config.adminUsername) as { id: number };
    db.run(
      'INSERT INTO categories (user_id, title, position) VALUES (?, ?, 0)',
      [user.id, 'All']
    );
    // Create immutable system categories
    for (const [i, title] of ['Video', 'Audio', 'Magazines'].entries()) {
      db.run(
        'INSERT INTO categories (user_id, title, position, is_system) VALUES (?, ?, ?, 1)',
        [user.id, title, i + 1]
      );
    }
    log.info('Created default category: All');
    log.info('Created system categories: Video, Audio, Magazines');
  }

  // Seed default settings (only insert if not already present)
  const defaultSettings: Array<[string, string, string]> = [
    // Module toggles
    ['modules.nrc.enabled', 'false', 'system'],
    ['modules.nrc.email', '""', 'system'],
    ['modules.nrc.password', '""', 'system'],
    ['modules.nrc.category_id', 'null', 'system'],
    ['modules.nrc.feed_days', '14', 'system'],
    ['modules.magazinelib.enabled', 'false', 'system'],
    ['modules.magazinelib.category_id', 'null', 'system'],
    ['modules.books.enabled', 'false', 'system'],
    ['modules.books.zlib_enabled', 'true', 'system'],
    ['modules.books.zlib_mirror', '"z-lib.fm"', 'system'],
    ['modules.books.zlib_daily_limit', '5', 'system'],
    ['modules.books.zlib_email', '""', 'system'],
    ['modules.books.zlib_password', '""', 'system'],

    // Scheduler
    ['scheduler.interval_minutes', '60', 'system'],
    ['scheduler.concurrency', '4', 'system'],
    ['scheduler.active_feed_interval', '15', 'system'],
    ['scheduler.slow_feed_interval', '360', 'system'],
    ['scheduler.error_max_backoff', '1440', 'system'],

    // Cache
    ['cache.max_age_days', '90', 'system'],
    ['cache.max_size_mb', '500', 'system'],

    // Content
    ['content.reading_time_wpm', '265', 'system'],

    // Retention — auto-cleanup old entries
    ['retention.max_age_days', '180', 'system'],       // Remove entries older than 6 months
    ['retention.max_entries_per_feed', '500', 'system'], // Max entries to keep per feed
    ['retention.keep_starred', 'true', 'system'],       // Never delete starred entries
    ['retention.cleanup_interval_hours', '24', 'system'], // Run cleanup every 24h

    // Database
    ['database.max_size_mb', '512', 'system'],          // Warn/act when DB exceeds this
    ['database.vacuum_on_cleanup', 'true', 'system'],   // VACUUM after large deletions

    // Crawler
    ['crawler.max_concurrent', '3', 'system'],          // Max concurrent crawl requests
    ['crawler.request_delay_ms', '500', 'system'],      // Delay between crawl requests to same domain
    ['crawler.max_content_length_kb', '512', 'system'], // Max article content size to store
  ];

  const insertSetting = db.prepare(
    'INSERT OR IGNORE INTO settings (key, value, scope) VALUES (?, ?, ?)'
  );

  const insertMany = db.transaction(() => {
    for (const [key, value, scope] of defaultSettings) {
      insertSetting.run(key, value, scope);
    }
  });
  insertMany();

  log.info('Default settings ensured');
}

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';
import { getNestedSettings, updateSettings, getSetting } from '../services/settings.ts';
import { getDatabaseStats, getScheduler, runRetentionCleanup } from '../services/scheduler.ts';
import { join } from 'path';
import { readdirSync, unlinkSync, statSync, existsSync } from 'fs';
import { getCacheStats } from '../lib/cache-stats.ts';
import { config } from '../config.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { getDb } from '../db/connection.ts';
import { getSystemCategoryId } from './categories.ts';
import { log } from '../lib/logger.ts';
import { clearZLibSession } from '../services/zlib.ts';

const settings = new Hono<{ Variables: { user: AuthUser } }>();

/**
 * Side-effects when module settings change.
 * Auto-creates or disables module-owned feeds on enable/disable.
 */
function handleModuleSideEffects(
  updates: Record<string, unknown>,
  userId: number
): void {
  const db = getDb();

  // --- NRC module ---
  if ('modules.nrc.enabled' in updates) {
    const enabled = updates['modules.nrc.enabled'] === true;
    if (enabled) {
      // Auto-create NRC feed if none exists
      const existing = db.query(
        "SELECT id FROM feeds WHERE user_id = ? AND source_type = 'nrc'"
      ).get(userId) as { id: number } | null;

      if (!existing) {
        const categoryId = getSystemCategoryId(userId, 'Magazines');
        db.run(`
          INSERT INTO feeds (user_id, category_id, source_type, source_config, title, site_url, disabled)
          VALUES (?, ?, 'nrc', '{}', 'NRC – Dagelijkse Krant', 'https://www.nrc.nl', 0)
        `, [userId, categoryId]);
        log.info('[settings] Auto-created NRC feed', { user_id: userId });

        // Trigger initial fetch
        const newFeed = db.query(
          "SELECT * FROM feeds WHERE user_id = ? AND source_type = 'nrc'"
        ).get(userId) as any;
        if (newFeed) {
          getScheduler().refresh(newFeed).catch((err: any) => {
            log.warn('[settings] NRC initial fetch failed', { error: err.message });
          });
        }
      } else {
        // Re-enable if disabled
        db.run("UPDATE feeds SET disabled = 0 WHERE id = ?", [existing.id]);
      }
    } else {
      // Disable NRC feed(s)
      db.run(
        "UPDATE feeds SET disabled = 1 WHERE user_id = ? AND source_type = 'nrc'",
        [userId]
      );
      log.info('[settings] Disabled NRC feeds', { user_id: userId });
    }
  }

  // Move NRC feed to new category if category changed
  if ('modules.nrc.category_id' in updates && updates['modules.nrc.category_id']) {
    db.run(
      "UPDATE feeds SET category_id = ? WHERE user_id = ? AND source_type = 'nrc'",
      [updates['modules.nrc.category_id'] as number, userId]
    );
  }

  // --- MagazineLib module ---
  if ('modules.magazinelib.enabled' in updates) {
    const enabled = updates['modules.magazinelib.enabled'] === true;
    if (enabled) {
      // Re-enable any previously disabled magazinelib feeds
      db.run(
        "UPDATE feeds SET disabled = 0 WHERE user_id = ? AND source_type = 'magazinelib'",
        [userId]
      );
    } else {
      // Disable all magazinelib feeds
      db.run(
        "UPDATE feeds SET disabled = 1 WHERE user_id = ? AND source_type = 'magazinelib'",
        [userId]
      );
      log.info('[settings] Disabled MagazineLib feeds', { user_id: userId });
    }
  }

  // --- Z-Library credentials ---
  if ('modules.books.zlib_email' in updates || 'modules.books.zlib_password' in updates) {
    // Clear cached session so it re-authenticates with new credentials
    clearZLibSession();
    log.info('[settings] Z-Library credentials updated, session cleared');
  }
}

/** Resolve or create a category for a module */
function resolveCategoryId(userId: number, settingKey: string, defaultName: string): number {
  const db = getDb();

  // Try the configured category
  const configuredId = getSetting<number>(settingKey);
  if (configuredId) {
    const exists = db.query('SELECT id FROM categories WHERE id = ? AND user_id = ?').get(configuredId, userId);
    if (exists) return configuredId;
  }

  // Fall back to first category or create
  const first = db.query(
    'SELECT id FROM categories WHERE user_id = ? ORDER BY position ASC LIMIT 1'
  ).get(userId) as { id: number } | null;

  if (first) return first.id;

  // Create a default category
  db.run(
    'INSERT INTO categories (user_id, title, position) VALUES (?, ?, 0)',
    [userId, defaultName]
  );
  const created = db.query(
    'SELECT id FROM categories WHERE user_id = ? AND title = ?'
  ).get(userId, defaultName) as { id: number };
  return created.id;
}

// GET /v1/settings — all settings (nested)
settings.get('/v1/settings', (c) => {
  const user = c.get('user');

  // Get system settings
  const system = getNestedSettings('system');

  // Also get user-scoped settings and merge
  const userSettings = getNestedSettings(`user:${user.id}`);

  return c.json({ ...system, user: userSettings });
});

// PUT /v1/settings — bulk update (flat dot-notation keys)
settings.put('/v1/settings', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<Record<string, unknown>>();

  if (!body || typeof body !== 'object') {
    throw badRequest('Request body must be a JSON object');
  }

  // Separate system vs user settings
  const systemUpdates: Record<string, unknown> = {};
  const userUpdates: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(body)) {
    // User-scoped keys start with "user."
    if (key.startsWith('user.')) {
      userUpdates[key.slice(5)] = value;
    } else {
      // System settings require admin
      if (!user.is_admin) {
        throw forbidden('Admin access required for system settings');
      }
      systemUpdates[key] = value;
    }
  }

  if (Object.keys(systemUpdates).length > 0) {
    updateSettings(systemUpdates, 'system');
    // Run side-effects for module toggles
    handleModuleSideEffects(systemUpdates, user.id);
  }

  if (Object.keys(userUpdates).length > 0) {
    updateSettings(userUpdates, `user:${user.id}`);
  }

  // Return updated settings
  const system = getNestedSettings('system');
  const userSettingsNested = getNestedSettings(`user:${user.id}`);

  return c.json({ ...system, user: userSettingsNested });
});

// GET /v1/settings/stats — database and cache statistics
// Must be registered BEFORE the :key wildcard route so it isn't swallowed
settings.get('/v1/settings/stats', (c) => {
  const dbStats = getDatabaseStats();
  const cache = getCacheStats(join(config.dataDir, 'cache'));

  return c.json({
    database: {
      size_bytes: dbStats.size_bytes,
      entry_count: dbStats.entry_count,
      feed_count: dbStats.feed_count,
    },
    cache: {
      covers_bytes: cache.covers_bytes,
      pdfs_bytes: cache.pdfs_bytes,
      total_bytes: cache.covers_bytes + cache.pdfs_bytes,
    },
  });
});

// GET /v1/settings/:key — single setting
// Registered after /stats so it doesn't shadow concrete paths
settings.get('/v1/settings/:key', (c) => {
  const key = c.req.param('key');
  const user = c.get('user');

  // Try user scope first, then system
  const userSettings = getNestedSettings(`user:${user.id}`);
  const systemSettings = getNestedSettings('system');

  // Navigate the nested object using the dot-notation key
  const parts = key.split('.');
  let value: any = userSettings;
  for (const part of parts) {
    if (value && typeof value === 'object' && part in value) {
      value = value[part];
    } else {
      // Try system scope
      value = systemSettings;
      for (const p of parts) {
        if (value && typeof value === 'object' && p in value) {
          value = value[p];
        } else {
          value = undefined;
          break;
        }
      }
      break;
    }
  }

  if (value === undefined) {
    throw notFound(`Setting not found: ${key}`);
  }

  return c.json({ key, value });
});

// PUT /v1/settings/:key — single setting
settings.put('/v1/settings/:key', async (c) => {
  const key = c.req.param('key');
  const user = c.get('user');
  const body = await c.req.json<{ value: unknown }>();

  if (!body || !('value' in body)) {
    throw badRequest('Request body must have a "value" field');
  }

  if (key.startsWith('user.')) {
    updateSettings({ [key.slice(5)]: body.value }, `user:${user.id}`);
  } else {
    if (!user.is_admin) {
      throw forbidden('Admin access required for system settings');
    }
    updateSettings({ [key]: body.value }, 'system');
  }

  return c.json({ key, value: body.value });
});

// POST /v1/settings/cache/clear — delete all cached files (covers + PDFs)
settings.post('/v1/settings/cache/clear', (c) => {
  const user = c.get('user');
  if (!user.is_admin) throw forbidden('Admin access required');

  const cacheDir = join(config.dataDir, 'cache');
  let deleted = 0;

  for (const subdir of ['covers', 'pdfs']) {
    const dir = join(cacheDir, subdir);
    if (!existsSync(dir)) continue;
    try {
      const files = readdirSync(dir);
      for (const file of files) {
        try {
          unlinkSync(join(dir, file));
          deleted++;
        } catch { /* skip locked files */ }
      }
    } catch (err: any) {
      log.warn('[settings] Cache clear error', { subdir, error: err.message });
    }
  }

  log.info('[settings] Cache cleared', { files_deleted: deleted });
  return c.json({ deleted });
});

// POST /v1/settings/cleanup — run retention cleanup on demand
settings.post('/v1/settings/cleanup', (c) => {
  const user = c.get('user');
  if (!user.is_admin) throw forbidden('Admin access required');

  runRetentionCleanup();
  return c.json({ success: true });
});

// POST /v1/settings/cleanup/older-than — delete articles older than N days
settings.post('/v1/settings/cleanup/older-than', async (c) => {
  const user = c.get('user');
  if (!user.is_admin) throw forbidden('Admin access required');

  const body = await c.req.json<{ days: number }>();
  if (!body?.days || body.days < 1) {
    throw badRequest('days must be a positive integer');
  }

  const db = getDb();
  const keepStarred = getSetting<boolean>('retention.keep_starred') !== false;
  const starredClause = keepStarred ? 'AND starred = 0' : '';
  const safeAge = `-${Math.max(1, Math.round(body.days))} days`;

  db.run(`
    DELETE FROM entries
    WHERE published_at < datetime('now', ?)
      ${starredClause}
  `, [safeAge]);
  const deleted = (db.query('SELECT changes() as c').get() as { c: number }).c;

  log.info('[settings] Manual cleanup: deleted old articles', { days: body.days, deleted });
  return c.json({ deleted });
});

export default settings;

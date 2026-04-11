import { getDb } from '../db/connection.ts';
import { config } from '../config.ts';
import { encrypt, decrypt } from '../lib/crypto.ts';

// In-memory cache for fast reads
let cache: Map<string, string> | null = null;

/** Secret keys that should be encrypted at rest */
const SECRET_KEYS = new Set(['modules.nrc.password', 'modules.books.zlib_password']);

/** Keys that should be masked in GET responses */
const MASKED_KEYS = new Set(['modules.nrc.password', 'modules.books.zlib_password']);

function loadCache(): Map<string, string> {
  if (cache) return cache;
  const db = getDb();
  const rows = db.query('SELECT key, value, scope FROM settings').all() as Array<{
    key: string;
    value: string;
    scope: string;
  }>;
  cache = new Map();
  for (const row of rows) {
    cache.set(`${row.scope}:${row.key}`, row.value);
  }
  return cache;
}

/** Invalidate in-memory cache (called after writes) */
export function invalidateSettingsCache(): void {
  cache = null;
}

/** Get a single setting value (parsed from JSON) */
export function getSetting<T = unknown>(key: string, scope = 'system'): T | undefined {
  const c = loadCache();
  const raw = c.get(`${scope}:${key}`);
  if (raw === undefined) return undefined;

  let value = raw;
  // Decrypt secrets
  if (SECRET_KEYS.has(key) && value && value !== '""' && value !== 'null') {
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === 'string' && parsed.length > 0) {
        value = JSON.stringify(decrypt(parsed, config.secretKey));
      }
    } catch {
      // Not encrypted or invalid — return as-is
    }
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return value as T;
  }
}

/** Get all settings for a scope, as a flat key→value map */
export function getAllSettings(scope = 'system'): Record<string, unknown> {
  const c = loadCache();
  const result: Record<string, unknown> = {};
  const prefix = `${scope}:`;

  for (const [cacheKey, raw] of c) {
    if (cacheKey.startsWith(prefix)) {
      const key = cacheKey.slice(prefix.length);
      let value: unknown;
      try {
        value = JSON.parse(raw);
      } catch {
        value = raw;
      }

      // Mask secrets
      if (MASKED_KEYS.has(key) && value && typeof value === 'string' && value.length > 0) {
        value = '••••••••';
      }

      result[key] = value;
    }
  }

  return result;
}

/** Build nested settings object from flat dot-notation keys */
export function getNestedSettings(scope = 'system'): Record<string, unknown> {
  const flat = getAllSettings(scope);
  const nested: Record<string, any> = {};

  for (const [key, value] of Object.entries(flat)) {
    const parts = key.split('.');
    let current = nested;
    for (let i = 0; i < parts.length - 1; i++) {
      if (!(parts[i] in current)) {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
  }

  return nested;
}

/** Update settings (flat key→value pairs). Encrypts secrets. */
export function updateSettings(
  updates: Record<string, unknown>,
  scope = 'system'
): void {
  const db = getDb();

  const upsert = db.prepare(
    'INSERT INTO settings (key, value, scope) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  db.transaction(() => {
    for (const [key, rawValue] of Object.entries(updates)) {
      let value = JSON.stringify(rawValue);

      // Encrypt secrets before storing
      if (SECRET_KEYS.has(key) && rawValue && typeof rawValue === 'string' && rawValue.length > 0) {
        const encrypted = encrypt(rawValue, config.secretKey);
        value = JSON.stringify(encrypted);
      }

      upsert.run(key, value, scope);
    }
  })();

  invalidateSettingsCache();
}

/** Check if a module is enabled */
export function isModuleEnabled(moduleType: string): boolean {
  return getSetting<boolean>(`modules.${moduleType}.enabled`) === true;
}

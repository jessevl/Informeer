/**
 * Test helper: sets up an isolated in-memory SQLite database
 * using the actual migrate() + seed() from the app.
 */
import { Database } from 'bun:sqlite';
import { setDb } from '../../src/db/connection.ts';
import { migrate } from '../../src/db/migrate.ts';
import { seed } from '../../src/db/seed.ts';
import { invalidateSettingsCache } from '../../src/services/settings.ts';

let testDb: Database | null = null;

/**
 * Create a fresh in-memory DB with the real schema and seed data.
 * Must be called in beforeAll/beforeEach.
 */
export async function setupTestDb(): Promise<Database> {
  if (testDb) {
    try { testDb.close(); } catch {}
  }

  testDb = new Database(':memory:');
  testDb.run('PRAGMA journal_mode = WAL');
  testDb.run('PRAGMA foreign_keys = ON');

  // Inject into the app's DB singleton
  setDb(testDb);
  invalidateSettingsCache();

  // Run real migrations + seed
  migrate();
  await seed();

  return testDb;
}

export function getTestDb(): Database {
  if (!testDb) throw new Error('Test DB not initialized — call setupTestDb() first');
  return testDb;
}

export function teardownTestDb(): void {
  if (testDb) {
    try { testDb.close(); } catch {}
    testDb = null;
  }
}

export function getTestDb(): Database {
  if (!testDb) throw new Error('Test DB not initialized — call setupTestDb() first');
  return testDb;
}

export function teardownTestDb(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

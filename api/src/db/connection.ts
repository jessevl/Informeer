import { Database } from 'bun:sqlite';
import { config } from '../config.ts';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

let _db: Database | null = null;

export function getDb(): Database {
  if (!_db) {
    // Ensure directory exists
    mkdirSync(dirname(config.databasePath), { recursive: true });

    _db = new Database(config.databasePath);

    // Performance pragmas
    _db.run('PRAGMA journal_mode = WAL');
    _db.run('PRAGMA synchronous = NORMAL');
    _db.run('PRAGMA cache_size = -64000'); // 64MB
    _db.run('PRAGMA foreign_keys = ON');
    _db.run('PRAGMA busy_timeout = 5000');
    _db.run('PRAGMA temp_store = MEMORY');
  }
  return _db;
}

/** Replace the DB instance (used in tests with in-memory DBs) */
export function setDb(db: Database): void {
  _db = db;
}

export function closeDb(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

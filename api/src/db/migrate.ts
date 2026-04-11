import { getDb } from './connection.ts';
import { log } from '../lib/logger.ts';

/** Run all pending migrations in order */
export function migrate(): void {
  const db = getDb();

  // Create migrations tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL UNIQUE,
      ran_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    db.query('SELECT name FROM _migrations').all().map((r: any) => r.name)
  );

  for (const migration of migrations) {
    if (!applied.has(migration.name)) {
      log.info(`Running migration: ${migration.name}`);
      db.transaction(() => {
        migration.up(db);
        db.run('INSERT INTO _migrations (name) VALUES (?)', [migration.name]);
      })();
    }
  }
}

interface Migration {
  name: string;
  up: (db: ReturnType<typeof getDb>) => void;
}

const migrations: Migration[] = [
  {
    name: '001_initial_schema',
    up(db) {
      db.run(`
        CREATE TABLE users (
          id            INTEGER PRIMARY KEY,
          username      TEXT NOT NULL UNIQUE,
          password_hash TEXT NOT NULL,
          is_admin      INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT NOT NULL DEFAULT (datetime('now')),
          last_login_at TEXT
        )
      `);

      db.run(`
        CREATE TABLE settings (
          key   TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          scope TEXT NOT NULL DEFAULT 'system'
        )
      `);

      db.run(`
        CREATE TABLE categories (
          id             INTEGER PRIMARY KEY,
          user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title          TEXT NOT NULL,
          hide_globally  INTEGER NOT NULL DEFAULT 0,
          position       INTEGER NOT NULL DEFAULT 0,
          UNIQUE(user_id, title)
        )
      `);

      db.run(`
        CREATE TABLE feeds (
          id                    INTEGER PRIMARY KEY,
          user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category_id           INTEGER NOT NULL REFERENCES categories(id),
          source_type           TEXT NOT NULL DEFAULT 'rss',
          source_config         TEXT NOT NULL DEFAULT '{}',
          feed_url              TEXT NOT NULL DEFAULT '',
          site_url              TEXT NOT NULL DEFAULT '',
          title                 TEXT NOT NULL,
          description           TEXT NOT NULL DEFAULT '',
          checked_at            TEXT,
          next_check_at         TEXT,
          etag_header           TEXT NOT NULL DEFAULT '',
          last_modified_header  TEXT NOT NULL DEFAULT '',
          parsing_error_message TEXT NOT NULL DEFAULT '',
          parsing_error_count   INTEGER NOT NULL DEFAULT 0,
          disabled              INTEGER NOT NULL DEFAULT 0,
          hide_globally         INTEGER NOT NULL DEFAULT 0,
          crawler               INTEGER NOT NULL DEFAULT 0,
          scraper_rules         TEXT NOT NULL DEFAULT '',
          rewrite_rules         TEXT NOT NULL DEFAULT '',
          blocklist_rules       TEXT NOT NULL DEFAULT '',
          keeplist_rules        TEXT NOT NULL DEFAULT '',
          user_agent            TEXT NOT NULL DEFAULT '',
          cookie                TEXT NOT NULL DEFAULT '',
          username              TEXT NOT NULL DEFAULT '',
          password              TEXT NOT NULL DEFAULT '',
          no_media_player       INTEGER NOT NULL DEFAULT 0,
          ignore_http_cache     INTEGER NOT NULL DEFAULT 0,
          created_at            TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, feed_url)
        )
      `);

      db.run(`
        CREATE TABLE icons (
          id        INTEGER PRIMARY KEY,
          data      TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          hash      TEXT NOT NULL UNIQUE
        )
      `);

      db.run(`
        CREATE TABLE feed_icons (
          feed_id INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
          icon_id INTEGER NOT NULL REFERENCES icons(id)
        )
      `);

      db.run(`
        CREATE TABLE entries (
          id           INTEGER PRIMARY KEY,
          user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          feed_id      INTEGER NOT NULL REFERENCES feeds(id) ON DELETE CASCADE,
          hash         TEXT NOT NULL,
          title        TEXT NOT NULL,
          url          TEXT NOT NULL DEFAULT '',
          comments_url TEXT NOT NULL DEFAULT '',
          author       TEXT NOT NULL DEFAULT '',
          content      TEXT NOT NULL DEFAULT '',
          status       TEXT NOT NULL DEFAULT 'unread'
                       CHECK (status IN ('unread','read','removed')),
          starred      INTEGER NOT NULL DEFAULT 0,
          reading_time INTEGER NOT NULL DEFAULT 0,
          share_code   TEXT NOT NULL DEFAULT '',
          tags         TEXT NOT NULL DEFAULT '[]',
          published_at TEXT NOT NULL,
          created_at   TEXT NOT NULL DEFAULT (datetime('now')),
          changed_at   TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(feed_id, hash)
        )
      `);

      db.run(`
        CREATE TABLE enclosures (
          id                INTEGER PRIMARY KEY,
          user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          entry_id          INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
          url               TEXT NOT NULL,
          mime_type         TEXT NOT NULL DEFAULT '',
          size              INTEGER NOT NULL DEFAULT 0,
          media_progression REAL NOT NULL DEFAULT 0
        )
      `);

      // Indexes
      db.run('CREATE INDEX idx_entries_user_status ON entries(user_id, status)');
      db.run('CREATE INDEX idx_entries_feed ON entries(feed_id)');
      db.run('CREATE INDEX idx_entries_published ON entries(user_id, published_at DESC)');
      db.run('CREATE INDEX idx_entries_starred ON entries(user_id, starred) WHERE starred = 1');
      db.run('CREATE INDEX idx_feeds_user ON feeds(user_id)');
      db.run('CREATE INDEX idx_feeds_category ON feeds(category_id)');
      db.run('CREATE INDEX idx_feeds_next_check ON feeds(next_check_at) WHERE disabled = 0');
      db.run('CREATE INDEX idx_enclosures_entry ON enclosures(entry_id)');

      // FTS5
      db.run(`
        CREATE VIRTUAL TABLE entries_fts USING fts5(
          title, content, url, author,
          content=entries, content_rowid=id
        )
      `);

      db.run(`
        CREATE TRIGGER entries_fts_ai AFTER INSERT ON entries BEGIN
          INSERT INTO entries_fts(rowid, title, content, url, author)
          VALUES (new.id, new.title, new.content, new.url, new.author);
        END
      `);

      db.run(`
        CREATE TRIGGER entries_fts_ad AFTER DELETE ON entries BEGIN
          INSERT INTO entries_fts(entries_fts, rowid, title, content, url, author)
          VALUES ('delete', old.id, old.title, old.content, old.url, old.author);
        END
      `);

      db.run(`
        CREATE TRIGGER entries_fts_au AFTER UPDATE ON entries BEGIN
          INSERT INTO entries_fts(entries_fts, rowid, title, content, url, author)
          VALUES ('delete', old.id, old.title, old.content, old.url, old.author);
          INSERT INTO entries_fts(rowid, title, content, url, author)
          VALUES (new.id, new.title, new.content, new.url, new.author);
        END
      `);
    },
  },
  {
    name: '002_performance_indexes',
    up(db) {
      // Composite index for counters query (feed_id + status grouped)
      db.run('CREATE INDEX IF NOT EXISTS idx_entries_feed_status ON entries(user_id, feed_id, status)');
      // Index for entry changed_at (used in sorting/filtering)
      db.run('CREATE INDEX IF NOT EXISTS idx_entries_changed ON entries(user_id, changed_at DESC)');
    },
  },
  {
    name: '003_add_image_url',
    up(db) {
      // Add image_url column to entries for card view thumbnails
      db.run("ALTER TABLE entries ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
    },
  },
  {
    name: '004_content_fetched_flag',
    up(db) {
      // Track whether full article content has been extracted and stored,
      // so we don't re-fetch it every time the article is opened.
      db.run('ALTER TABLE entries ADD COLUMN content_fetched INTEGER NOT NULL DEFAULT 0');
    },
  },
  {
    name: '005_content_fetch_policy',
    up(db) {
      // Replace the boolean `crawler` column with a 3-option content_fetch_policy:
      //   rss_only  – never fetch full article, show RSS content as-is (default)
      //   on_demand – fetch full article when the user opens the entry
      //   always    – fetch full article during sync (old crawler behaviour)
      db.run("ALTER TABLE feeds ADD COLUMN content_fetch_policy TEXT NOT NULL DEFAULT 'rss_only'");
      // Migrate existing crawler=1 feeds to 'always'
      db.run("UPDATE feeds SET content_fetch_policy = 'always' WHERE crawler = 1");
    },
  },
  {
    name: '006_system_categories',
    up(db) {
      // Add is_system flag to categories — system categories are auto-created
      // and cannot be deleted or renamed. Used for Video, Audio, Magazines.
      db.run("ALTER TABLE categories ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0");

      // Create system categories for every existing user
      const users = db.prepare('SELECT id FROM users').all() as Array<{ id: number }>;
      const insertCat = db.prepare(
        "INSERT OR IGNORE INTO categories (user_id, title, position, is_system) VALUES (?, ?, ?, 1)"
      );
      const systemCats = ['Video', 'Audio', 'Magazines'];
      for (const user of users) {
        const maxPos = db.prepare(
          'SELECT COALESCE(MAX(position), -1) as max_pos FROM categories WHERE user_id = ?'
        ).get(user.id) as { max_pos: number };
        for (let i = 0; i < systemCats.length; i++) {
          insertCat.run(user.id, systemCats[i], maxPos.max_pos + 1 + i);
          // If category already existed (OR IGNORE), mark it as system
          db.run(
            "UPDATE categories SET is_system = 1 WHERE user_id = ? AND title = ?",
            [user.id, systemCats[i]]
          );
        }
      }
    },
  },
  {
    name: '007_performance_indexes',
    up(db) {
      // Index for the crawler's unfetched entries query
      db.run(`CREATE INDEX IF NOT EXISTS idx_entries_feed_content_fetched
        ON entries (feed_id, content_fetched) WHERE content_fetched = 0`);

      // Index for scheduler's due feeds query
      db.run(`CREATE INDEX IF NOT EXISTS idx_feeds_next_check
        ON feeds (disabled, next_check_at)`);

      // Index for retention cleanup queries
      db.run(`CREATE INDEX IF NOT EXISTS idx_entries_published
        ON entries (published_at)`);
    },
  },
  {
    name: '008_download_failed',
    up(db) {
      // Track download failures for magazine issues (PDFs that couldn't be fetched).
      // 0 = ok/not attempted, 1 = download failed — skip during refresh, show blur in UI.
      db.run("ALTER TABLE entries ADD COLUMN download_failed INTEGER NOT NULL DEFAULT 0");
    },
  },
  {
    name: '009_books',
    up(db) {
      // EPUB Books — library, reading progress, and highlights
      db.run(`
        CREATE TABLE books (
          id          INTEGER PRIMARY KEY,
          user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title       TEXT NOT NULL,
          author      TEXT NOT NULL DEFAULT '',
          publisher   TEXT NOT NULL DEFAULT '',
          language    TEXT NOT NULL DEFAULT '',
          description TEXT NOT NULL DEFAULT '',
          cover_path  TEXT NOT NULL DEFAULT '',
          epub_path   TEXT NOT NULL DEFAULT '',
          file_size   INTEGER NOT NULL DEFAULT 0,
          isbn        TEXT NOT NULL DEFAULT '',
          tags        TEXT NOT NULL DEFAULT '[]',
          metadata    TEXT NOT NULL DEFAULT '{}',
          created_at  TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      db.run(`
        CREATE TABLE book_progress (
          id         INTEGER PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          cfi        TEXT NOT NULL DEFAULT '',
          percentage REAL NOT NULL DEFAULT 0,
          chapter    TEXT NOT NULL DEFAULT '',
          updated_at TEXT NOT NULL DEFAULT (datetime('now')),
          UNIQUE(user_id, book_id)
        )
      `);

      db.run(`
        CREATE TABLE book_highlights (
          id         INTEGER PRIMARY KEY,
          user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
          cfi_range  TEXT NOT NULL,
          text       TEXT NOT NULL,
          note       TEXT NOT NULL DEFAULT '',
          color      TEXT NOT NULL DEFAULT 'yellow',
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);

      db.run('CREATE INDEX idx_books_user ON books(user_id)');
      db.run('CREATE INDEX idx_book_progress_user_book ON book_progress(user_id, book_id)');
      db.run('CREATE INDEX idx_book_highlights_book ON book_highlights(book_id)');
    },
  },
  {
    name: '010_zlib_downloads',
    up(db) {
      // Track Z-Library downloads for daily IP-based rate-limit awareness
      db.run(`
        CREATE TABLE IF NOT EXISTS zlib_downloads (
          id            INTEGER PRIMARY KEY,
          zlib_book_id  TEXT NOT NULL,
          title         TEXT NOT NULL DEFAULT '',
          downloaded_at TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
      db.run('CREATE INDEX IF NOT EXISTS idx_zlib_downloads_date ON zlib_downloads(downloaded_at)');
    },
  },
  {
    name: '011_books_autoincrement',
    up(db) {
      // Recreate books table with AUTOINCREMENT to prevent deleted IDs from being reused.
      // Without this, deleting book #5 and adding a new one could reuse ID 5,
      // causing stale browser-cached covers and offline data to be served for the new book.
      db.run(`CREATE TABLE books_new (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title       TEXT NOT NULL,
        author      TEXT NOT NULL DEFAULT '',
        publisher   TEXT NOT NULL DEFAULT '',
        language    TEXT NOT NULL DEFAULT '',
        description TEXT NOT NULL DEFAULT '',
        cover_path  TEXT NOT NULL DEFAULT '',
        epub_path   TEXT NOT NULL DEFAULT '',
        file_size   INTEGER NOT NULL DEFAULT 0,
        isbn        TEXT NOT NULL DEFAULT '',
        tags        TEXT NOT NULL DEFAULT '[]',
        metadata    TEXT NOT NULL DEFAULT '{}',
        created_at  TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      db.run(`INSERT INTO books_new SELECT * FROM books`);
      db.run(`DROP TABLE books`);
      db.run(`ALTER TABLE books_new RENAME TO books`);
      db.run(`CREATE INDEX idx_books_user ON books(user_id)`);
    },
  },
  {
    name: '012_podcast_artwork_cache',
    up(db) {
      db.run(`
        CREATE TABLE podcast_artwork (
          feed_id     INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
          artwork_url TEXT,
          cached_at   TEXT NOT NULL DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    // Migrate stale static-file paths in magazine/NRC entries to on-demand API routes.
    // Old entries stored paths like /files/cache/covers/... and /files/cache/pdfs/...
    // which break when cached files are removed. On-demand routes re-fetch on demand.
    name: '013_magazine_ondemand_urls',
    up(db) {
      // Fix MagazineLib entries: cover URLs
      db.run(`
        UPDATE entries SET
          image_url = '/cover/mag/' || REPLACE(hash, 'mag-', ''),
          changed_at = datetime('now')
        WHERE hash LIKE 'mag-%'
          AND image_url NOT LIKE '/cover/mag/%'
      `);

      // Fix MagazineLib entries: stale cover paths in content
      db.run(`
        UPDATE entries SET
          content = REPLACE(content,
            '/files/cache/covers/mag-' || REPLACE(hash, 'mag-', '') || '.jpg',
            '/cover/mag/' || REPLACE(hash, 'mag-', '')),
          changed_at = datetime('now')
        WHERE hash LIKE 'mag-%'
          AND content LIKE '%/files/cache/covers/mag-%'
      `);

      // Fix MagazineLib entries: old /v1/magazinelib/cover/ paths in content
      db.run(`
        UPDATE entries SET
          content = REPLACE(content,
            '/v1/magazinelib/cover/' || REPLACE(hash, 'mag-', ''),
            '/cover/mag/' || REPLACE(hash, 'mag-', '')),
          changed_at = datetime('now')
        WHERE hash LIKE 'mag-%'
          AND content LIKE '%/v1/magazinelib/cover/%'
      `);

      // Fix MagazineLib entries: stale PDF paths in content
      db.run(`
        UPDATE entries SET
          content = REPLACE(content,
            '/files/cache/pdfs/mag-' || REPLACE(hash, 'mag-', '') || '.pdf',
            '/v1/magazinelib/pdf/' || REPLACE(hash, 'mag-', '')),
          changed_at = datetime('now')
        WHERE hash LIKE 'mag-%'
          AND content LIKE '%/files/cache/pdfs/mag-%'
      `);

      // Fix MagazineLib enclosures
      db.run(`
        UPDATE enclosures SET url = '/v1/magazinelib/pdf/' || REPLACE(
          (SELECT hash FROM entries WHERE entries.id = enclosures.entry_id), 'mag-', '')
        WHERE entry_id IN (SELECT id FROM entries WHERE hash LIKE 'mag-%')
          AND url LIKE '/files/cache/pdfs/mag-%'
      `);

      // Fix NRC entries: cover URLs
      db.run(`
        UPDATE entries SET
          image_url = '/cover/nrc/' || REPLACE(hash, 'nrc-', ''),
          changed_at = datetime('now')
        WHERE hash LIKE 'nrc-%'
          AND image_url LIKE '/files/cache/covers/nrc-%'
      `);

      // Fix NRC entries: cover paths in content
      db.run(`
        UPDATE entries SET
          content = REPLACE(content,
            '/files/cache/covers/nrc-' || REPLACE(hash, 'nrc-', '') || '.jpg',
            '/cover/nrc/' || REPLACE(hash, 'nrc-', '')),
          changed_at = datetime('now')
        WHERE hash LIKE 'nrc-%'
          AND content LIKE '%/files/cache/covers/nrc-%'
      `);

      // Fix NRC entries: stale PDF paths in content
      db.run(`
        UPDATE entries SET
          content = REPLACE(content,
            '/files/cache/pdfs/nrc-' || REPLACE(hash, 'nrc-', '') || '.pdf',
            '/v1/nrc/pdf/' || REPLACE(hash, 'nrc-', '')),
          changed_at = datetime('now')
        WHERE hash LIKE 'nrc-%'
          AND content LIKE '%/files/cache/pdfs/nrc-%'
      `);

      // Fix NRC enclosures
      db.run(`
        UPDATE enclosures SET url = '/v1/nrc/pdf/' || REPLACE(
          (SELECT hash FROM entries WHERE entries.id = enclosures.entry_id), 'nrc-', '')
        WHERE entry_id IN (SELECT id FROM entries WHERE hash LIKE 'nrc-%')
          AND url LIKE '/files/cache/pdfs/nrc-%'
      `);
    },
  },
];

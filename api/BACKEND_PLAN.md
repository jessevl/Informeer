# Informeer Backend — Implementation Plan

> **⚠️ Historical Document** — This plan was written during the migration from Miniflux to Informeer's own backend. References to Miniflux describe the old architecture being replaced. The migration is complete.

> Replace Miniflux + nrc-proxy + magazine-proxy with a single, unified backend.  
> SQLite-based. Single Docker container. Modular. Fast.

---

## 1. Goals

1. **Drop-in replacement** for the Miniflux API surface Informeer actually uses — no frontend rewrite for core functionality.
2. **SQLite** instead of PostgreSQL — single file, zero-config, easy backups.
3. **NRC** and **MagazineLib** scrapers as first-class content sources — not RSS proxies — directly inserting entries into the database, toggled on/off from the UI.
4. **EPUB book reader** as an integrated module — upload, library, progress sync.
5. **Settings API** — all runtime configuration (modules, scraper intervals, credentials) managed via API and frontend, not env vars.
6. **Single container** — one Docker image, one process, one port.

---

## 2. Architecture Overview

### 2.1 System Diagram

```
┌──────────────────────────── Docker Compose ────────────────────────────┐
│                                                                        │
│  ┌──────────────┐         ┌───────────────────────────────────────┐   │
│  │  Informeer    │  HTTP   │  informeer-api (Hono + Bun)          │   │
│  │  (frontend)   │ ──────▶ │                                      │   │
│  │  nginx:80     │         │  /v1/*  ── Miniflux-compatible API   │   │
│  └──────────────┘         │  /files/* ── Static file serving      │   │
│                            │                                      │   │
│                            │  ┌──────────────────────────────┐    │   │
│                            │  │  Scheduler                    │    │   │
│                            │  │                               │    │   │
│                            │  │  ┌─────────┐  ┌───────────┐  │    │   │
│                            │  │  │  RSS     │  │  Scrapers  │  │    │   │
│                            │  │  │  Feeds   │  │  NRC       │  │    │   │
│                            │  │  │         │  │  MagLib    │  │    │   │
│                            │  │  └────┬────┘  └─────┬─────┘  │    │   │
│                            │  │       └──────┬──────┘         │    │   │
│                            │  │              ▼                │    │   │
│                            │  │     entries table (SQLite)    │    │   │
│                            │  └──────────────────────────────┘    │   │
│                            │                                      │   │
│                            │  ┌─────────┐  ┌──────────────────┐   │   │
│                            │  │ SQLite  │  │ /data/           │   │   │
│                            │  │ (WAL)   │  │  cache/pdfs/     │   │   │
│                            │  │         │  │  cache/covers/   │   │   │
│                            │  └─────────┘  │  books/          │   │   │
│                            │               └──────────────────┘   │   │
│                            └──────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.2 Key Architectural Decision: Content Sources, Not Feed Proxies

The old architecture had NRC and MagazineLib as **separate services generating RSS feeds** that Miniflux then fetched. This was an indirection forced by Miniflux being a third-party system that only ingests content via RSS. Since we own the backend, scrapers write entries directly:

| Old (Miniflux) | New (Informeer API) |
|----------------|---------------------|
| Scraper → generates RSS XML → Miniflux fetches RSS → parses XML → stores entries | Scraper → **writes entries directly to SQLite** |
| PDF URLs point to external proxy service | PDF URLs point to `/files/cache/pdfs/:id` on same backend |
| Cover URLs point to external proxy, rewritten by Miniflux image proxy | Cover URLs point to `/files/cache/covers/:id` — no proxy rewriting |
| Module = separate Docker container + separate port | Module = a `ContentSource` class registered with the scheduler |
| Config via env vars on separate containers | Config via Settings API, hot-reloadable from the UI |

**The `ContentSource` interface** is the abstraction that unifies RSS feeds and scrapers:

```typescript
interface ContentSource {
  /** Matches feed.source_type */
  readonly type: string;

  /** Fetch new content for the given feed, return entries to upsert */
  fetch(feed: Feed, signal: AbortSignal): Promise<FetchResult>;
}
```

- `RSSSource` implements this for standard RSS/Atom/JSON feeds
- `NRCSource` implements this for NRC daily editions
- `MagazineLibSource` implements this for MagazineLib search queries

The scheduler doesn't know or care which type it's running — it calls `source.fetch(feed)` and writes the results uniformly. The `feeds` table has a `source_type` column that maps to the right `ContentSource`.

### 2.3 Why Hono + Bun

| Criterion | Choice | Rationale |
|-----------|--------|-----------|
| Runtime | **Bun** | 3× faster startup than Node, built-in SQLite driver, native TS |
| Framework | **Hono** | 14KB, 0 deps, middleware system, type-safe routes |
| Database | **bun:sqlite** | Zero-copy, WAL mode, no native addon compilation |
| Feed parsing | **@extractus/feed-extractor** or lightweight custom | RSS 2.0, Atom, JSON Feed |
| HTML parsing | **cheerio** | Same as existing proxies, proven |
| EPUB parsing | **epub2** or **@nicolo-ribaudo/epub** | Lightweight, stream-based |

---

## 3. Database Schema

### 3.1 Core Tables

```sql
CREATE TABLE users (
  id            INTEGER PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at TEXT
);

-- Runtime configuration (replaces env vars for everything mutable)
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,                       -- JSON-encoded
  scope TEXT NOT NULL DEFAULT 'system'       -- 'system' | 'user:{id}'
);

CREATE TABLE categories (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  hide_globally  INTEGER NOT NULL DEFAULT 0,
  position       INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, title)
);

CREATE TABLE feeds (
  id                    INTEGER PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category_id           INTEGER NOT NULL REFERENCES categories(id),
  -- Content source type: 'rss' (default), 'nrc', 'magazinelib'
  source_type           TEXT NOT NULL DEFAULT 'rss',
  -- Source-specific config as JSON (e.g. {"query":"The Economist"} for magazinelib)
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
);

CREATE TABLE icons (
  id        INTEGER PRIMARY KEY,
  data      TEXT NOT NULL,         -- base64 data URI
  mime_type TEXT NOT NULL,
  hash      TEXT NOT NULL UNIQUE
);

CREATE TABLE feed_icons (
  feed_id INTEGER PRIMARY KEY REFERENCES feeds(id) ON DELETE CASCADE,
  icon_id INTEGER NOT NULL REFERENCES icons(id)
);

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
);

CREATE TABLE enclosures (
  id                INTEGER PRIMARY KEY,
  user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entry_id          INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  url               TEXT NOT NULL,
  mime_type         TEXT NOT NULL DEFAULT '',
  size              INTEGER NOT NULL DEFAULT 0,
  media_progression REAL NOT NULL DEFAULT 0
);

-- Indexes for the queries Informeer runs
CREATE INDEX idx_entries_user_status ON entries(user_id, status);
CREATE INDEX idx_entries_feed        ON entries(feed_id);
CREATE INDEX idx_entries_published   ON entries(user_id, published_at DESC);
CREATE INDEX idx_entries_starred     ON entries(user_id, starred) WHERE starred = 1;
CREATE INDEX idx_feeds_user          ON feeds(user_id);
CREATE INDEX idx_feeds_category      ON feeds(category_id);
CREATE INDEX idx_feeds_next_check    ON feeds(next_check_at) WHERE disabled = 0;
CREATE INDEX idx_enclosures_entry    ON enclosures(entry_id);

-- Full-text search
CREATE VIRTUAL TABLE entries_fts USING fts5(
  title, content, url, author,
  content=entries, content_rowid=id
);

CREATE TRIGGER entries_fts_ai AFTER INSERT ON entries BEGIN
  INSERT INTO entries_fts(rowid, title, content, url, author)
  VALUES (new.id, new.title, new.content, new.url, new.author);
END;
CREATE TRIGGER entries_fts_ad AFTER DELETE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, content, url, author)
  VALUES ('delete', old.id, old.title, old.content, old.url, old.author);
END;
CREATE TRIGGER entries_fts_au AFTER UPDATE ON entries BEGIN
  INSERT INTO entries_fts(entries_fts, rowid, title, content, url, author)
  VALUES ('delete', old.id, old.title, old.content, old.url, old.author);
  INSERT INTO entries_fts(rowid, title, content, url, author)
  VALUES (new.id, new.title, new.content, new.url, new.author);
END;
```

### 3.2 Books Tables

```sql
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
);

CREATE TABLE book_progress (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi        TEXT NOT NULL DEFAULT '',         -- EPUB CFI position
  percentage REAL NOT NULL DEFAULT 0,          -- 0.0 – 100.0
  chapter    TEXT NOT NULL DEFAULT '',         -- current chapter title
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, book_id)
);

CREATE TABLE book_highlights (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id    INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  cfi_range  TEXT NOT NULL,
  text       TEXT NOT NULL,
  note       TEXT NOT NULL DEFAULT '',
  color      TEXT NOT NULL DEFAULT 'yellow',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.3 Settings Design

All runtime configuration lives in the `settings` table. Changes take effect immediately — no restart needed.

```sql
-- Seeded on first boot:
INSERT INTO settings (key, value, scope) VALUES
  -- Module toggles
  ('modules.nrc.enabled',         'false',  'system'),
  ('modules.nrc.email',           '""',     'system'),
  ('modules.nrc.password',        '""',     'system'),  -- encrypted at rest
  ('modules.nrc.category_id',     'null',   'system'),
  ('modules.magazinelib.enabled', 'false',  'system'),
  ('modules.magazinelib.category_id', 'null', 'system'),
  ('modules.books.enabled',       'false',  'system'),

  -- Scheduler
  ('scheduler.interval_minutes',       '60',   'system'),
  ('scheduler.concurrency',            '4',    'system'),
  ('scheduler.active_feed_interval',   '15',   'system'),
  ('scheduler.slow_feed_interval',     '360',  'system'),
  ('scheduler.error_max_backoff',      '1440', 'system'),

  -- Cache
  ('cache.max_age_days',  '90',    'system'),
  ('cache.max_size_mb',   '10240', 'system'),

  -- Content
  ('content.reading_time_wpm', '265', 'system');
```

**Scope convention:**
- `system` — global, admin-only writes. Module config, scheduler, cache.
- `user:{id}` — per-user preferences (theme, layout). Any authenticated user writes their own.

Secrets (NRC password) are AES-256-GCM encrypted using `SECRET_KEY` from the one env var that must be set at boot.

---

## 4. Content Source Architecture

### 4.1 Interface

```typescript
interface NewEntry {
  hash: string;            // Dedup key
  title: string;
  url: string;
  author: string;
  content: string;         // HTML
  published_at: string;    // ISO 8601
  enclosures: Array<{
    url: string;
    mime_type: string;
    size: number;
  }>;
  comments_url?: string;
  tags?: string[];
}

interface FetchResult {
  entries: NewEntry[];
  etag?: string;           // For HTTP conditional GET (RSS only)
  lastModified?: string;
}

interface ContentSource {
  readonly type: string;
  fetch(feed: Feed, signal: AbortSignal): Promise<FetchResult>;
}
```

### 4.2 Implementations

#### `RSSSource` (`source_type = 'rss'`)

Standard RSS/Atom/JSON Feed handling:
1. HTTP GET `feed.feed_url` with `If-None-Match` / `If-Modified-Since`
2. Parse → normalize to `NewEntry[]`
3. Return `etag` + `lastModified` for next conditional GET

#### `NRCSource` (`source_type = 'nrc'`)

```
source_config = '{}'  (no per-feed config)
```
1. Authenticate with NRC.nl CAS (cache session 4h)
2. Scrape today's edition page → PDF URL + cover URL
3. Download PDF → `/data/cache/pdfs/nrc-{YYYY-MM-DD}.pdf`
4. Download cover → `/data/cache/covers/nrc-{YYYY-MM-DD}.jpg`
5. Return one `NewEntry`:
   - `content`: `<img src="/files/cache/covers/nrc-2026-03-14.jpg" data-magazine-cover="true">`
   - `enclosures`: `[{ url: "/files/cache/pdfs/nrc-2026-03-14.pdf", mime_type: "application/pdf" }]`
6. Skip Sundays

All URLs are **relative paths** served by the same backend — no proxy rewriting.

#### `MagazineLibSource` (`source_type = 'magazinelib'`)

```
source_config = '{"query": "The Economist"}'
```
1. Search MagazineLib.com for the configured query
2. For each new issue:
   - Scrape detail page → resolve VK→userapi redirect chain
   - Download PDF + cover → cache
3. Return `NewEntry[]` with local file URLs in content and enclosures

### 4.3 Scheduler

One loop that handles all source types uniformly:

```typescript
class Scheduler {
  private sources = new Map<string, ContentSource>();

  register(source: ContentSource) {
    this.sources.set(source.type, source);
  }

  async tick() {
    const { concurrency } = getSettings('scheduler');
    const dueFeeds = db.query(`
      SELECT * FROM feeds
      WHERE disabled = 0
        AND (next_check_at IS NULL OR next_check_at <= datetime('now'))
      ORDER BY next_check_at ASC
      LIMIT ?
    `, [concurrency]);

    await Promise.allSettled(dueFeeds.map(f => this.refresh(f)));
  }

  async refresh(feed: Feed) {
    const source = this.sources.get(feed.source_type);
    if (!source) return;

    // Skip if parent module is disabled
    if (feed.source_type !== 'rss' && !isModuleEnabled(feed.source_type)) return;

    const abort = new AbortController();
    try {
      const result = await source.fetch(feed, abort.signal);
      upsertEntries(feed, result.entries);
      updateFeedChecked(feed, { etag: result.etag, lastModified: result.lastModified });
    } catch (err) {
      updateFeedError(feed, err.message);
    }
  }
}
```

**Adaptive polling** (all configurable via settings):

| Condition | Default |
|-----------|---------|
| New entries found | 15 min |
| Normal (no change) | 60 min |
| Stale (7+ days idle) | 6 hours |
| Erroring | Exponential backoff → max 24h |
| NRC | Once daily at 06:00, skip Sundays |
| MagazineLib | Once daily (magazines are weekly/monthly) |

---

## 5. API Routes

### 5.1 Core — Miniflux-Compatible (`/v1/`)

Wire-compatible with Miniflux. The existing `src/api/miniflux.ts` works unchanged.

| Method | Endpoint | Notes |
|--------|----------|-------|
| `GET` | `/v1/me` | |
| **Categories** |||
| `GET` | `/v1/categories` | |
| `POST` | `/v1/categories` | |
| `PUT` | `/v1/categories/:id` | |
| `DELETE` | `/v1/categories/:id` | |
| `PUT` | `/v1/categories/:id/mark-all-as-read` | |
| `GET` | `/v1/categories/:id/entries` | |
| **Feeds** |||
| `GET` | `/v1/feeds` | Extended: includes `source_type` |
| `GET` | `/v1/feeds/:id` | |
| `POST` | `/v1/feeds` | Extended: accepts `source_type` + `source_config` |
| `PUT` | `/v1/feeds/:id` | |
| `DELETE` | `/v1/feeds/:id` | Cleans up cached files for scraper feeds |
| `PUT` | `/v1/feeds/:id/refresh` | Triggers immediate `source.fetch()` |
| `PUT` | `/v1/feeds/refresh` | |
| `GET` | `/v1/feeds/counters` | |
| `PUT` | `/v1/feeds/:id/mark-all-as-read` | |
| `POST` | `/v1/discover` | |
| `GET` | `/v1/feeds/:id/icon` | |
| `GET` | `/v1/feeds/:id/entries` | |
| **Icons** |||
| `GET` | `/v1/icons/:id` | |
| **Entries** |||
| `GET` | `/v1/entries` | Full query param support + FTS5 search |
| `GET` | `/v1/entries/:id` | |
| `PUT` | `/v1/entries` | Bulk status update |
| `PUT` | `/v1/entries/:id/bookmark` | |
| `GET` | `/v1/entries/:id/fetch-content` | Readability extraction |
| **Enclosures** |||
| `PUT` | `/v1/enclosures/:id` | `media_progression` update |
| **OPML** |||
| `GET` | `/v1/export` | |
| `POST` | `/v1/import` | |

### 5.2 Settings (`/v1/settings`)

All runtime config — module toggles, credentials, scheduler tuning, cache limits.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/settings` | All settings (system + current user) |
| `PUT` | `/v1/settings` | Bulk update (key-value pairs) |
| `GET` | `/v1/settings/:key` | Single setting |
| `PUT` | `/v1/settings/:key` | Single setting |

**Response shape** (nested for readability, flat keys in DB):

```jsonc
// GET /v1/settings
{
  "modules": {
    "nrc": {
      "enabled": false,
      "email": "",
      "password": "••••••••",    // masked
      "category_id": null
    },
    "magazinelib": {
      "enabled": false,
      "category_id": null
    },
    "books": {
      "enabled": false
    }
  },
  "scheduler": {
    "interval_minutes": 60,
    "concurrency": 4,
    "active_feed_interval": 15,
    "slow_feed_interval": 360,
    "error_max_backoff": 1440
  },
  "cache": {
    "max_age_days": 90,
    "max_size_mb": 10240
  },
  "content": {
    "reading_time_wpm": 265
  }
}
```

**Update format** (flat dot-notation keys):

```jsonc
// PUT /v1/settings
{
  "modules.nrc.enabled": true,
  "modules.nrc.email": "user@example.com",
  "modules.nrc.password": "secret",
  "modules.nrc.category_id": 5,
  "scheduler.interval_minutes": 30
}
```

**Side effects on module toggle:**

| Action | Side effect |
|--------|-------------|
| Enable NRC | Auto-creates an NRC feed in the configured category, schedules first fetch |
| Disable NRC | Disables the NRC feed (`disabled=1`). Entries and cached files remain. |
| Enable MagazineLib | Enables the `magazinelib` source type. Existing MagLib feeds resume fetching. |
| Disable MagazineLib | Disables all `source_type='magazinelib'` feeds. |
| Change `category_id` | Moves the module's feed(s) to the new category. |

**Access control:**
- `system` scope → admin only
- `user:{id}` scope → own settings only

### 5.3 MagazineLib Search (`/v1/magazinelib/`)

Search API for discovering and subscribing to magazines. Only available when `modules.magazinelib.enabled`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/magazinelib/search?q=...&page=1` | Search MagazineLib |
| `POST` | `/v1/magazinelib/subscribe` | Creates a `source_type='magazinelib'` feed |

**Subscribe:**

```jsonc
// POST /v1/magazinelib/subscribe
{ "query": "The Economist", "category_id": 5, "title": "The Economist" }

// Response (same shape as POST /v1/feeds)
{ "feed_id": 42 }
```

Creates a feed row with `source_type='magazinelib'`, `source_config='{"query":"The Economist"}'`. The scheduler runs `MagazineLibSource.fetch()` on the next tick.

### 5.4 Books (`/v1/books/`)

Available when `modules.books.enabled`.

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/v1/books` | List (pagination, search) |
| `GET` | `/v1/books/:id` | Metadata |
| `POST` | `/v1/books` | Upload EPUB (multipart/form-data) |
| `DELETE` | `/v1/books/:id` | Remove + delete files |
| `GET` | `/v1/books/:id/file` | Stream EPUB |
| `GET` | `/v1/books/:id/cover` | Cover image |
| `GET` | `/v1/books/:id/progress` | Current reading position |
| `PUT` | `/v1/books/:id/progress` | Update position (CFI + % + chapter) |
| `GET` | `/v1/books/:id/highlights` | List |
| `POST` | `/v1/books/:id/highlights` | Create |
| `PUT` | `/v1/books/:id/highlights/:hid` | Update |
| `DELETE` | `/v1/books/:id/highlights/:hid` | Delete |

### 5.5 Static Files (`/files/`)

Serves cached content with proper MIME types and cache headers:

```
/files/cache/pdfs/:filename     → application/pdf,  Cache-Control: 7d
/files/cache/covers/:filename   → image/*,          Cache-Control: 1d
/files/books/:userId/:bookId/*  → appropriate MIME
```

This replaces separate proxy endpoints per module. Entry content and enclosure URLs reference `/files/...` paths directly.

### 5.6 Health + Capabilities (`/health`)

```jsonc
{
  "status": "ok",
  "version": "1.0.0",
  "modules": {
    "nrc":         { "enabled": true,  "healthy": true },
    "magazinelib": { "enabled": false },
    "books":       { "enabled": true }
  },
  "scheduler": { "running": true, "feeds": 42, "erroring": 2 },
  "database":  { "entries": 12450, "size_mb": 48.2 },
  "cache":     { "pdfs": 23, "covers": 156, "size_mb": 892 }
}
```

The frontend reads `modules` to conditionally show/hide UI elements.

---

## 6. Project Structure

```
informeer-api/
├── Dockerfile
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                     — App entry, Hono + middleware + startup
│   ├── config.ts                    — Boot env vars only (PORT, DB path, SECRET_KEY)
│   │
│   ├── db/
│   │   ├── connection.ts            — SQLite connection, WAL pragmas
│   │   ├── migrate.ts               — Versioned migrations
│   │   └── seed.ts                  — Default settings + admin user
│   │
│   ├── middleware/
│   │   ├── auth.ts                  — HTTP Basic Auth
│   │   └── logger.ts               — Structured request logging
│   │
│   ├── routes/
│   │   ├── health.ts                — /health
│   │   ├── settings.ts              — /v1/settings
│   │   ├── users.ts                 — /v1/me
│   │   ├── categories.ts            — Category CRUD + entries
│   │   ├── feeds.ts                 — Feed CRUD + refresh + discover + icons
│   │   ├── entries.ts               — Entry list/get/update/bookmark/fetch
│   │   ├── enclosures.ts            — PUT progress
│   │   ├── opml.ts                  — Import/export
│   │   ├── magazinelib.ts           — Search + subscribe (module-gated)
│   │   └── books.ts                 — CRUD + progress + highlights (module-gated)
│   │
│   ├── sources/                     — ContentSource implementations
│   │   ├── types.ts                 — Interfaces: ContentSource, NewEntry, FetchResult
│   │   ├── rss.ts                   — Standard RSS/Atom/JSON Feed
│   │   ├── nrc.ts                   — NRC auth + scraper
│   │   └── magazinelib.ts           — MagazineLib scraper + VK chain
│   │
│   ├── services/
│   │   ├── scheduler.ts             — Unified polling loop
│   │   ├── settings.ts              — Read/write with in-memory cache
│   │   ├── feed-discovery.ts        — URL → discovered feeds
│   │   ├── content-extractor.ts     — Readability article extraction
│   │   ├── icon-fetcher.ts          — Favicon discovery + base64 storage
│   │   ├── reading-time.ts          — Word count → minutes
│   │   ├── cache-manager.ts         — File cache eviction (age/size)
│   │   └── epub-parser.ts           — EPUB metadata + cover extraction
│   │
│   └── lib/
│       ├── crypto.ts                — Secret encryption, bcrypt
│       ├── hash.ts                  — Content hashing for dedup
│       ├── html.ts                  — Sanitize, rewrite relative URLs
│       ├── opml.ts                  — OPML parse/generate
│       └── date.ts                  — Date utilities
```

**Key design points:**
- No `modules/` directory — modules are `ContentSource` implementations in `sources/` plus guarded routes. The module concept is a settings toggle, not a code boundary.
- No `feed-generator.ts` — scrapers produce `NewEntry[]` directly, not RSS XML.
- Settings service caches values in memory, invalidates on write via `PUT /v1/settings`.

---

## 7. Environment Variables

Only **boot-time infrastructure** — everything else lives in the `settings` table.

```env
PORT=3000                # Server port
HOST=0.0.0.0             # Bind address
DATABASE_PATH=/data/informeer.db
DATA_DIR=/data
SECRET_KEY=              # Required. Encrypts secrets at rest (NRC password, etc.)
ADMIN_USERNAME=admin     # First-run only — creates admin user, ignored after
ADMIN_PASSWORD=changeme  # First-run only
```

**6 env vars.** Module toggles, credentials, intervals, cache limits — all via the Settings API.

---

## 8. Docker

### Dockerfile

```dockerfile
FROM oven/bun:1-alpine AS builder
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
RUN mkdir -p /data/cache/pdfs /data/cache/covers /data/books

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["bun", "run", "dist/index.js"]
```

### docker-compose.yml

```yaml
version: "3.9"

services:
  frontend:
    build: ./frontend
    ports: ["80:80"]
    depends_on: [api]
    restart: unless-stopped

  api:
    build: ./backend
    ports: ["3000:3000"]
    environment:
      - SECRET_KEY=${SECRET_KEY}
      - ADMIN_USERNAME=${ADMIN_USERNAME:-admin}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-changeme}
    volumes:
      - data:/data
    restart: unless-stopped

volumes:
  data:
```

---

## 9. Frontend Changes

### 9.1 Core — No Changes Needed

| Area | Why |
|------|-----|
| All RSS/podcast/video views | API is wire-compatible |
| `src/api/miniflux.ts` | Same endpoints, same auth, same shapes |
| Magazine PDF viewer | Entries still have enclosures + covers |
| Media progress sync | `PUT /v1/enclosures/:id` unchanged |
| Feed management CRUD | Same endpoints |
| OPML import/export | Same endpoints |

### 9.2 Changes Needed

| Change | Effort | Details |
|--------|--------|--------|
| **Remove `deproxyUrl()`** | Small | Backend serves files directly, no Miniflux proxy rewriting |
| **Settings panel: Modules section** | Medium | Toggle NRC/MagazineLib/Books, configure credentials + category |
| **Settings panel: Scheduler section** | Small | Interval, concurrency, backoff sliders |
| **Settings panel: Cache section** | Small | Max age/size, cleanup button |
| **Module-aware UI** | Small | Read `/health` → hide tabs/buttons for disabled modules |
| **MagazineLib "Search Magazines"** | Medium | New tab in Add Feed modal calling `/v1/magazinelib/search` |
| **Books tab + store** | Medium | `src/stores/books.ts`, `src/components/books/` |
| **EPUB reader** | Medium | Full-screen foliate-js component, same patterns as PDFViewer |

### 9.3 Settings Panel — Wireframe

```
┌─ Settings ───────────────────────────────────────────┐
│                                                       │
│  General                                              │
│  ├─ Theme: [Dark ▾]    Variant: [Warm ▾]             │
│  └─ ...existing...                                   │
│                                                       │
│  ── Modules ─────────────────────────────────         │
│                                                       │
│  NRC Digital                                 [toggle] │
│  ├─ Email:    [_________________]                     │
│  ├─ Password: [_________________]                     │
│  └─ Category: [Magazines ▾]                           │
│                                                       │
│  MagazineLib                                 [toggle] │
│  └─ Category: [Magazines ▾]                           │
│                                                       │
│  Books                                       [toggle] │
│                                                       │
│  ── Scheduler ───────────────────────────────         │
│                                                       │
│  Default refresh:    [60] min                         │
│  Active feeds:       [15] min                         │
│  Concurrent fetches: [4]                              │
│                                                       │
│  ── Cache ───────────────────────────────────         │
│                                                       │
│  Max age:  [90] days       Max size: [10] GB          │
│  [Clean Up Now]                                       │
│                                                       │
│  ── Data ────────────────────────────────────         │
│  [Export OPML]  [Import OPML]                         │
└───────────────────────────────────────────────────────┘
```

---

## 10. Implementation Phases

### Phase 1: Core Backend ✅

**Goal:** Informeer points at this backend and functions identically to Miniflux.

- [x] 1.1 Scaffolding: Bun + Hono + SQLite, Dockerfile, CI
- [x] 1.2 DB layer: connection, migrations, seeding
- [x] 1.3 Auth middleware: HTTP Basic, bcrypt
- [x] 1.4 Settings routes + service: `GET/PUT /v1/settings` with caching
- [x] 1.5 User route: `GET /v1/me`
- [x] 1.6 Category CRUD + mark-as-read + entries
- [x] 1.7 Feed CRUD (no refresh yet)
- [x] 1.8 Entry routes: list (full query params), get, bulk update, bookmark
- [x] 1.9 Enclosure progress update
- [x] 1.10 Icon routes
- [x] 1.11 OPML import/export
- [x] 1.12 Static file serving (`/files/*`)
- [x] 1.13 Health endpoint

### Phase 2: Feed Engine + Settings UI

**Goal:** Feeds auto-refresh. Settings configurable from frontend.

- [x] 2.1 `RSSSource`: parse RSS/Atom/JSON, conditional GET
- [x] 2.2 Scheduler: polling loop, adaptive intervals
- [x] 2.3 Entry deduplication: hash-based upsert
- [x] 2.4 Enclosure extraction
- [x] 2.5 Icon discovery
- [x] 2.6 Feed discovery: `POST /v1/discover`
- [x] 2.7 Content extraction: Readability for `fetch-content`
- [x] 2.8 Full-text search: FTS5
- [x] 2.9 Reading time estimation
- [ ] 2.10 **Frontend:** Settings panel — modules, scheduler, cache
- [ ] 2.11 **Frontend:** Module-aware UI (read `/health`, conditional render)

### Phase 3: NRC + MagazineLib Sources

**Goal:** Scrapers work as first-class content sources.

- [ ] 3.1 `NRCSource`: port auth + scraper, return `NewEntry[]`
- [ ] 3.2 NRC file caching (PDF + cover → `/data/cache/`)
- [ ] 3.3 NRC enable/disable flow via settings
- [ ] 3.4 `MagazineLibSource`: port scraper + VK chain
- [ ] 3.5 MagazineLib file caching
- [ ] 3.6 MagazineLib search API: `/v1/magazinelib/search` + subscribe
- [ ] 3.7 Cache manager: shared age/size eviction
- [ ] 3.8 **Frontend:** "Search Magazines" tab in Add Feed modal
- [ ] 3.9 **Frontend:** Remove `deproxyUrl()`

### Phase 4: EPUB Books

**Goal:** Full book reading experience with cross-device sync.

- [ ] 4.1 EPUB parser: metadata, cover, TOC extraction
- [ ] 4.2 Book storage + file management
- [ ] 4.3 Book CRUD routes
- [ ] 4.4 Progress + highlights routes
- [ ] 4.5 **Frontend:** `src/stores/books.ts`
- [ ] 4.6 **Frontend:** Book library grid + upload
- [ ] 4.7 **Frontend:** EPUB reader (foliate-js)
- [ ] 4.8 **Frontend:** Progress sync UI

### Phase 5: Polish

- [x] 5.2 Performance: query optimization, batch inserts
- [x] 5.3 Error handling: consistent Miniflux-format responses
- [x] 5.4 Structured logging
- [x] 5.5 Rate limiting
- [x] 5.6 Integration tests
- [x] 5.7 Documentation

---

## 11. Performance

| Metric | Target |
|--------|--------|
| Cold start | < 500ms |
| `GET /v1/entries` (100) | < 50ms |
| `GET /v1/feeds/counters` | < 10ms |
| Full-text search | < 100ms |
| Docker image | < 100MB |
| Memory (idle) | < 50MB |

```sql
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA cache_size = -64000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
PRAGMA temp_store = MEMORY;
```

---

## 12. Migration from Miniflux

**Path A — OPML (simple):** Export from Miniflux, import into new backend. Feeds refetch; history & progress lost.

**Path B — Full migration (complete):**
```bash
bun run migrate --pg "postgresql://miniflux:pass@host/miniflux"
```
Migrates users, categories, feeds, icons, entries, enclosures (including `media_progression` and starred/read state).

---

## 13. Security

| Area | Approach |
|------|----------|
| Auth | HTTP Basic over HTTPS |
| Passwords | bcrypt |
| Secrets at rest | AES-256-GCM via `SECRET_KEY` env var |
| File uploads | 100MB limit, MIME validation, path sanitization |
| SQL injection | Parameterized queries only (bun:sqlite) |
| SSRF | Block private IPs, `file://` in feed URLs |
| Rate limiting | Per-IP on auth + upload |
| Content | Strip `<script>` on ingest |

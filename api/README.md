# Informeer API

Self-hosted backend for the Informeer news reader. A Hono + SQLite API that supports RSS feeds, podcasts, magazines, and more through a pluggable **ContentSource** architecture.

See the [root README](../README.md) for full project documentation, Docker setup, and getting started.

## Features

- **REST API** — feeds, entries, categories, settings, search, OPML import/export
- **SQLite + WAL** — single-file database, no external dependencies
- **Full-text search** via FTS5
- **RSS/Atom/JSON Feed engine** — fetching with conditional GET, adaptive polling intervals, entry deduplication
- **Feed discovery** — auto-detect feeds from any URL
- **Content extraction** — Readability-based article extraction for full-text reading
- **Favicon discovery** — automatic icon detection and caching
- **Podcast support** — enclosure extraction (RSS 2.0, Atom, Media RSS)
- **Settings API** — nested dot-notation settings with encryption for secrets
- **ContentSource modules** — pluggable feed sources (RSS, NRC, MagazineLib, Books)
- **HTTP Basic Auth** with bcrypt password hashing
- **AES-256-GCM** encryption for secrets at rest
- **Structured logging** — JSON for production, human-readable for development
- **Rate limiting** — per-IP rate limiting on auth and API endpoints
- **SSRF protection** — blocks private IPs, localhost, cloud metadata endpoints

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) v1.0+

### Development

```bash
# Clone the repo
git clone https://github.com/your-org/informeer-api.git
cd informeer-api

# Install dependencies
bun install

# Copy environment file and edit as needed
cp .env.example .env

# Start dev server (auto-reload)
bun run dev
```

The server starts on `http://localhost:3000` by default. On first boot it will:
1. Run database migrations
2. Create an admin user (from `ADMIN_USERNAME` / `ADMIN_PASSWORD` env vars)
3. Seed default settings

### Test the API

```bash
# Health check (no auth required)
curl http://localhost:3000/health

# Authenticated request
curl -u admin:changeme http://localhost:3000/v1/me
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `DATABASE_PATH` | `./data/informeer.db` | SQLite database file path |
| `DATA_DIR` | `./data` | Directory for cache, PDFs, covers |
| `SECRET_KEY` | *(dev only)* | **Required in production.** Used for AES-256-GCM encryption. Generate with `openssl rand -hex 32` |
| `ADMIN_USERNAME` | `admin` | Initial admin username |
| `ADMIN_PASSWORD` | *(dev only)* | **Required in production.** Initial admin password |
| `NODE_ENV` | `development` | Set to `production` for JSON logging and stricter defaults |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Minimum log level: `debug`, `info`, `warn`, `error` |

> **Security:** In production (`NODE_ENV=production`), `SECRET_KEY` and `ADMIN_PASSWORD` must be set explicitly — the server will refuse to start with dev defaults.

## Scripts

```bash
bun run dev        # Start with hot reload
bun run build      # Bundle to dist/
bun run start      # Run production build
bun run typecheck  # TypeScript type checking
bun test           # Run all tests
```

## Docker

```bash
# Build
docker build -t informeer-api .

# Run
docker run -d \
  -p 3000:3000 \
  -v informeer-data:/data \
  -e SECRET_KEY=$(openssl rand -hex 32) \
  -e ADMIN_PASSWORD=your-secure-password \
  -e NODE_ENV=production \
  informeer-api
```

### Docker Compose

```yaml
services:
  api:
    image: ghcr.io/your-org/informeer-api:latest
    ports:
      - "3000:3000"
    volumes:
      - api-data:/data
    environment:
      - NODE_ENV=production
      - SECRET_KEY=${SECRET_KEY}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD}
    restart: unless-stopped

volumes:
  api-data:
```

## API Overview

All `/v1/*` endpoints require HTTP Basic Auth.

### Core

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Health check (public) |
| `GET` | `/v1/me` | Current user info |

### Categories

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/categories` | List categories |
| `POST` | `/v1/categories` | Create category |
| `PUT` | `/v1/categories/:id` | Update category |
| `DELETE` | `/v1/categories/:id` | Delete category |

### Feeds

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/feeds` | List feeds |
| `POST` | `/v1/feeds` | Create feed (triggers initial fetch + icon discovery) |
| `GET` | `/v1/feeds/:id` | Get feed |
| `PUT` | `/v1/feeds/:id` | Update feed |
| `DELETE` | `/v1/feeds/:id` | Delete feed (cascades entries + enclosures) |
| `GET` | `/v1/feeds/counters` | Read/unread counts per feed |
| `PUT` | `/v1/feeds/refresh` | Trigger refresh of all feeds |
| `PUT` | `/v1/feeds/:id/refresh` | Trigger refresh of a single feed |
| `PUT` | `/v1/feeds/:id/mark-all-as-read` | Mark all entries as read |
| `GET` | `/v1/feeds/:id/icon` | Get feed icon |
| `GET` | `/v1/feeds/:id/entries` | List entries for a feed |
| `POST` | `/v1/discover` | Discover feed URLs from any URL |

### Entries

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/entries` | List entries (filter by status, feed, search, starred) |
| `GET` | `/v1/entries/:id` | Get single entry with enclosures |
| `PUT` | `/v1/entries` | Bulk status update (read/unread/removed) |
| `PUT` | `/v1/entries/:id/bookmark` | Toggle starred |
| `GET` | `/v1/entries/:id/fetch-content` | Extract full article via Readability |

### Settings & Export

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/v1/settings` | Get all settings (nested) |
| `PUT` | `/v1/settings` | Update settings |
| `GET` | `/v1/export` | OPML export |
| `POST` | `/v1/import` | OPML import |
| `GET` | `/v1/icons/:id` | Get icon by ID |

## Project Structure

```
src/
├── config.ts              # Environment configuration
├── index.ts               # App entry point, middleware, scheduler startup
├── db/
│   ├── connection.ts      # SQLite singleton
│   ├── migrate.ts         # Migration system
│   └── seed.ts            # Initial data seeding
├── lib/
│   ├── crypto.ts          # Password hashing + AES encryption
│   ├── errors.ts          # AppError classes + SSRF validation
│   ├── hash.ts            # Content hashing (SHA-256)
│   ├── html.ts            # HTML sanitization
│   ├── date.ts            # Date utilities
│   ├── logger.ts          # Structured logging (JSON/human-readable)
│   └── opml.ts            # OPML generation/parsing
├── middleware/
│   ├── auth.ts            # HTTP Basic Auth
│   ├── logger.ts          # Request logging with request IDs
│   └── rate-limit.ts      # Per-IP rate limiting
├── routes/
│   ├── health.ts          # Health endpoint
│   ├── categories.ts      # Categories + shared query helpers
│   ├── feeds.ts           # Feeds CRUD + counters + discover + refresh
│   ├── entries.ts         # Entries list + updates + fetch-content
│   ├── enclosures.ts      # Media progression
│   ├── icons.ts           # Feed icons
│   ├── settings.ts        # Settings API
│   ├── users.ts           # User info
│   └── opml.ts            # OPML import/export
├── services/
│   ├── content-extractor.ts # Readability article extraction
│   ├── feed-discovery.ts  # Feed URL auto-discovery
│   ├── icon-fetcher.ts    # Favicon discovery + caching
│   ├── reading-time.ts    # Reading time estimator
│   ├── scheduler.ts       # Polling loop, entry upsert, adaptive intervals
│   └── settings.ts        # Settings cache + encryption
└── sources/
    ├── rss.ts             # RSS/Atom/JSON Feed source
    └── types.ts           # ContentSource interface
```

## Architecture

### Feed Engine

The scheduler polls feeds at adaptive intervals:
- **Active feeds** (had new entries): every 15 minutes
- **Normal feeds**: every 60 minutes (configurable)  
- **Stale feeds** (no entries for 7+ days): every 6 hours
- **Error backoff**: exponential, 15min → 30min → 60min → ... capped at 24h

Entry deduplication uses SHA-256 content hashes. Entries with the same hash in the same feed are skipped.

### ContentSource Interface

All content sources implement a shared interface:

```typescript
interface ContentSource {
  readonly type: string;
  fetch(feed: Feed, signal: AbortSignal): Promise<FetchResult>;
}
```

Currently implemented: `RSSSource` (RSS 2.0, Atom, JSON Feed). Future: `NRCSource`, `MagazineLibSource`.

### Rate Limiting

Per-IP rate limits with sliding window:
- **Auth endpoints**: 20 requests/minute
- **API endpoints**: 300 requests/minute
- **Uploads**: 10 requests/minute

Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `Retry-After`) are included in all responses.

## License

[AGPL-3.0-or-later](../frontend/LICENSE)

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.ts';
import { migrate } from './db/migrate.ts';
import { seed } from './db/seed.ts';
import { auth } from './middleware/auth.ts';
import { logger } from './middleware/logger.ts';
import { apiRateLimit, authRateLimit } from './middleware/rate-limit.ts';
import { serveStatic } from 'hono/bun';
import { mkdirSync, existsSync, readFileSync } from 'fs';
import { join, resolve } from 'path';

// Route modules
import health from './routes/health.ts';
import settings from './routes/settings.ts';
import users from './routes/users.ts';
import categories from './routes/categories.ts';
import feeds from './routes/feeds.ts';
import entries from './routes/entries.ts';
import enclosures from './routes/enclosures.ts';
import icons from './routes/icons.ts';
import opml from './routes/opml.ts';
import magazinelib, { magazinelibCover } from './routes/magazinelib.ts';
import nrc, { nrcCover } from './routes/nrc.ts';
import search from './routes/search.ts';
import booksRoutes from './routes/books.ts';
import podcastArtwork from './routes/podcast-artwork.ts';

import { getScheduler } from './services/scheduler.ts';
import { startCacheCleanupScheduler } from './services/cache-manager.ts';
import { log } from './lib/logger.ts';

// --- Global crash guards ---
// Bun will crash the process on unhandled rejections unless we handle them here.
process.on('unhandledRejection', (reason) => {
  log.error('Unhandled promise rejection', { reason: String(reason) });
});
process.on('uncaughtException', (err) => {
  log.error('Uncaught exception', { error: String(err), stack: err.stack });
});

// --- Startup ---

log.info('Informeer API starting...');

// Ensure data directories
mkdirSync(join(config.dataDir, 'cache', 'pdfs'), { recursive: true });
mkdirSync(join(config.dataDir, 'cache', 'covers'), { recursive: true });
mkdirSync(join(config.dataDir, 'books'), { recursive: true });

// Database migrations + seeding
migrate();
await seed();

// --- App ---

const app = new Hono();

// Global middleware
app.use('*', logger);
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Public endpoints (no auth)
app.route('', health);
app.route('', magazinelibCover);
app.route('', nrcCover);

// Public cover proxy — used by <img> tags which can't send auth headers.
// Restricted to known image CDN domains to prevent abuse as an open proxy.
const ALLOWED_COVER_DOMAINS = ['covers.z-lib.fm', 'covers.z-lib.fo', 'covers.z-lib.gd', 'covers.z-lib.gl'];
app.get('/cover-proxy', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing url parameter' }, 400);

  // Validate URL against allow-list
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return c.json({ error: 'Invalid URL' }, 400);
  }
  if (!ALLOWED_COVER_DOMAINS.includes(parsed.hostname)) {
    return c.json({ error: 'Domain not allowed' }, 403);
  }

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Referer': parsed.origin + '/',
        'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return c.json({ error: 'Cover not found' }, 404);

    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const body = await response.arrayBuffer();

    c.header('Content-Type', contentType);
    c.header('Cache-Control', 'public, max-age=86400, immutable');
    return c.body(body);
  } catch {
    return c.json({ error: 'Failed to fetch cover' }, 502);
  }
});

// Static file serving for cached content
app.use('/files/*', serveStatic({
  root: config.dataDir,
  rewriteRequestPath: (path) => path.replace('/files', ''),
}));

// All /v1/* routes require auth + rate limiting
app.use('/v1/*', apiRateLimit);
app.use('/v1/*', auth);

// Register route modules
app.route('', settings);
app.route('', users);
app.route('', categories);
app.route('', feeds);
app.route('', entries);
app.route('', enclosures);
app.route('', icons);
app.route('', opml);
app.route('', magazinelib);
app.route('', nrc);
app.route('', search);
app.route('', booksRoutes);
app.route('', podcastArtwork);

// Error handler — consistent JSON error responses
app.onError((err, c) => {
  // HTTPException (including AppError) — use the status and message
  if (err instanceof Error && 'status' in err) {
    const status = (err as any).status || 500;
    const message = err.message || 'Internal Server Error';
    if (status >= 500) {
      log.error(`${c.req.method} ${c.req.path}: ${message}`, { status, error: String(err) });
    }
    return c.json({ error_message: message }, status);
  }
  // Unexpected errors
  log.error(`${c.req.method} ${c.req.path}: Unhandled error`, { error: String(err) });
  return c.json({ error_message: 'Internal Server Error' }, 500);
});

// --- Frontend SPA serving (production) ---
const frontendDir = resolve(config.frontendDir);
const hasFrontend = existsSync(join(frontendDir, 'index.html'));

if (hasFrontend) {
  log.info(`Serving frontend from ${frontendDir}`);

  // Cache index.html in memory (avoids readFileSync on every SPA fallback)
  const indexHtml = readFileSync(join(frontendDir, 'index.html'), 'utf-8');

  // Serve static assets
  app.use('/*', serveStatic({ root: frontendDir }));

  // SPA fallback — serve cached index.html for any non-API route
  app.notFound((c) => {
    // If the request looks like an API call, return JSON 404
    if (c.req.path.startsWith('/v1/') || c.req.path.startsWith('/files/') || c.req.path.startsWith('/cover/') || c.req.path === '/health') {
      return c.json({ error_message: 'Not Found' }, 404);
    }
    // Otherwise serve the SPA from memory
    return c.html(indexHtml);
  });
} else {
  log.info('No frontend build found — API-only mode');
  app.notFound((c) => {
    return c.json({ error_message: 'Not Found' }, 404);
  });
}

// --- Scheduler ---

const scheduler = getScheduler();
scheduler.start();

// Start cache cleanup scheduler
startCacheCleanupScheduler();

// --- Serve ---

log.info(`Listening on ${config.host}:${config.port}`);

export default {
  port: config.port,
  hostname: config.host,
  fetch: app.fetch,
};

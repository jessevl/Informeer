/**
 * API integration tests.
 * 
 * These spin up a Hono app with an in-memory SQLite database
 * and test the actual HTTP routes end-to-end.
 */
import { describe, test, expect, beforeAll } from 'bun:test';
import { Hono } from 'hono';
import { setupTestDb } from '../helpers/db.ts';
import { auth } from '../../src/middleware/auth.ts';
import { config } from '../../src/config.ts';

// Route modules
import health from '../../src/routes/health.ts';
import users from '../../src/routes/users.ts';
import categories from '../../src/routes/categories.ts';
import feeds from '../../src/routes/feeds.ts';
import entries from '../../src/routes/entries.ts';
import settingsRoute from '../../src/routes/settings.ts';
import opml from '../../src/routes/opml.ts';

let app: Hono;
// Uses the admin credentials from config (dev defaults: admin/changeme)
const authHeader = 'Basic ' + btoa(`${config.adminUsername}:${config.adminPassword}`);

beforeAll(async () => {
  // Set up in-memory DB with real migrations + seed
  await setupTestDb();

  // Build app
  app = new Hono();
  app.route('', health);
  app.use('/v1/*', auth);
  app.route('', users);
  app.route('', categories);
  app.route('', feeds);
  app.route('', entries);
  app.route('', settingsRoute);
  app.route('', opml);

  app.onError((err, c) => {
    if (err instanceof Error && 'status' in err) {
      const status = (err as any).status || 500;
      return c.json({ error_message: err.message }, status);
    }
    console.error('[test error]', err);
    return c.json({ error_message: 'Internal Server Error' }, 500);
  });

  app.notFound((c) => c.json({ error_message: 'Not Found' }, 404));
});

// ─── Health ───

describe('GET /health', () => {
  test('returns 200 without auth', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe('ok');
  });
});

// ─── Auth ───

describe('Authentication', () => {
  test('rejects unauthenticated request', async () => {
    const res = await app.request('/v1/me');
    expect(res.status).toBe(401);
  });

  test('rejects wrong credentials', async () => {
    const res = await app.request('/v1/me', {
      headers: { Authorization: 'Basic ' + btoa('admin:wrongpass') },
    });
    expect(res.status).toBe(401);
  });

  test('accepts valid credentials', async () => {
    const res = await app.request('/v1/me', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
  });
});

// ─── Users ───

describe('GET /v1/me', () => {
  test('returns user info', async () => {
    const res = await app.request('/v1/me', {
      headers: { Authorization: authHeader },
    });
    const body = await res.json();
    expect(body.username).toBe(config.adminUsername);
    expect(body.is_admin).toBe(true);
    expect(body.theme).toBeString();
  });
});

// ─── Categories ───

describe('Categories CRUD', () => {
  test('GET /v1/categories returns seeded category', async () => {
    const res = await app.request('/v1/categories', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);
    expect(body[0].title).toBe('All');
  });

  test('POST /v1/categories creates a category', async () => {
    const res = await app.request('/v1/categories', {
      method: 'POST',
      headers: {
        Authorization: authHeader,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ title: 'Tech' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.title).toBe('Tech');
    expect(body.id).toBeNumber();
  });

  test('PUT /v1/categories/:id updates a category', async () => {
    // Create first
    const createRes = await app.request('/v1/categories', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'UpdateMe' }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/v1/categories/${created.id}`, {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.title).toBe('Updated');
  });

  test('DELETE /v1/categories/:id removes a category', async () => {
    const createRes = await app.request('/v1/categories', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'DeleteMe' }),
    });
    const created = await createRes.json() as any;

    const res = await app.request(`/v1/categories/${created.id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(204);
  });
});

// ─── Feeds ───

describe('Feeds CRUD', () => {
  let feedId: number;

  test('POST /v1/feeds creates a feed', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'https://example.com/feed.xml',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.feed_id).toBeNumber();
    feedId = body.feed_id;
  });

  test('GET /v1/feeds lists feeds', async () => {
    const res = await app.request('/v1/feeds', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /v1/feeds/:id returns a feed', async () => {
    const res = await app.request(`/v1/feeds/${feedId}`, {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(feedId);
  });

  test('GET /v1/feeds/counters returns counters', async () => {
    const res = await app.request('/v1/feeds/counters', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.reads).toBeDefined();
    expect(body.unreads).toBeDefined();
  });

  test('PUT /v1/feeds/:id updates a feed', async () => {
    const res = await app.request(`/v1/feeds/${feedId}`, {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Updated Feed' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.title).toBe('Updated Feed');
  });
});

// ─── Entries ───

describe('Entries', () => {
  test('GET /v1/entries returns entries list', async () => {
    const res = await app.request('/v1/entries', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBeDefined();
    expect(body.entries).toBeArray();
  });
});

// ─── Settings ───

describe('Settings API', () => {
  test('GET /v1/settings returns nested settings', async () => {
    const res = await app.request('/v1/settings', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scheduler).toBeDefined();
    expect(body.scheduler.interval_minutes).toBe(60);
  });

  test('PUT /v1/settings updates settings', async () => {
    const res = await app.request('/v1/settings', {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ 'scheduler.interval_minutes': 30 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.scheduler.interval_minutes).toBe(30);
  });
});

// ─── OPML ───

describe('OPML', () => {
  test('GET /v1/export returns valid OPML XML', async () => {
    const res = await app.request('/v1/export', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('<?xml');
    expect(text).toContain('<opml');
    expect(text).toContain('</opml>');
  });
});

// ─── 404 ───

describe('Not Found', () => {
  test('returns 404 for unknown routes', async () => {
    const res = await app.request('/v1/nonexistent', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(404);
  });
});

/**
 * Phase 2 + Phase 5 integration tests.
 * 
 * Tests the new functionality added in Phase 2 (feed engine, entry management)
 * and Phase 5 (error handling, SSRF protection, rate limiting).
 */
import { describe, test, expect, beforeAll, beforeEach, afterAll } from 'bun:test';
import { Hono } from 'hono';
import { setupTestDb, getTestDb, teardownTestDb } from '../helpers/db.ts';
import { auth } from '../../src/middleware/auth.ts';
import { config } from '../../src/config.ts';
import { upsertEntries } from '../../src/services/scheduler.ts';
import type { Feed, NewEntry } from '../../src/sources/types.ts';

// Route modules
import health from '../../src/routes/health.ts';
import users from '../../src/routes/users.ts';
import categories from '../../src/routes/categories.ts';
import feeds from '../../src/routes/feeds.ts';
import entries from '../../src/routes/entries.ts';
import settingsRoute from '../../src/routes/settings.ts';

let app: Hono;
const authHeader = 'Basic ' + btoa(`${config.adminUsername}:${config.adminPassword}`);

function makeFeed(overrides: Partial<Feed> = {}): Feed {
  return {
    id: 1,
    user_id: 1,
    category_id: 1,
    source_type: 'rss',
    source_config: '{}',
    feed_url: 'https://example.com/feed.xml',
    site_url: 'https://example.com',
    title: 'Test Feed',
    etag_header: '',
    last_modified_header: '',
    user_agent: '',
    cookie: '',
    username: '',
    password: '',
    crawler: 0,
    scraper_rules: '',
    rewrite_rules: '',
    blocklist_rules: '',
    keeplist_rules: '',
    ignore_http_cache: 0,
    ...overrides,
  };
}

beforeAll(async () => {
  await setupTestDb();

  app = new Hono();
  app.route('', health);
  app.use('/v1/*', auth);
  app.route('', users);
  app.route('', categories);
  app.route('', feeds);
  app.route('', entries);
  app.route('', settingsRoute);

  app.onError((err, c) => {
    if (err instanceof Error && 'status' in err) {
      const status = (err as any).status || 500;
      return c.json({ error_message: err.message }, status);
    }
    return c.json({ error_message: 'Internal Server Error' }, 500);
  });

  app.notFound((c) => c.json({ error_message: 'Not Found' }, 404));
});

afterAll(teardownTestDb);

// ─── Feed CRUD Extended ───

describe('Feed operations', () => {
  let feedId: number;

  test('POST /v1/feeds creates a feed and returns feed_id', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'https://example.com/test-feed.xml',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.feed_id).toBeNumber();
    feedId = body.feed_id;
  });

  test('POST /v1/feeds rejects duplicate feed_url', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'https://example.com/test-feed.xml',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as any;
    expect(body.error_message).toContain('already exists');
  });

  test('POST /v1/feeds with invalid category returns 404', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'https://example.com/another-feed.xml',
        category_id: 9999,
      }),
    });
    expect(res.status).toBe(404);
  });

  test('DELETE /v1/feeds/:id cascades entries and enclosures', async () => {
    // Create a feed
    const createRes = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'https://example.com/delete-me-feed.xml',
        category_id: 1,
      }),
    });
    const { feed_id } = await createRes.json() as any;

    // Insert entries via upsertEntries
    const db = getTestDb();
    const feed = db.query('SELECT * FROM feeds WHERE id = ?').get(feed_id) as Feed;
    upsertEntries(feed, [{
      hash: 'del-hash-1',
      title: 'Delete me entry',
      url: 'https://example.com/del-1',
      author: 'Author',
      content: '<p>Content</p>',
      published_at: '2026-03-14T10:00:00Z',
      enclosures: [{ url: 'https://example.com/audio.mp3', mime_type: 'audio/mpeg', size: 100 }],
    }]);

    // Verify entry exists
    const entryBefore = db.query('SELECT COUNT(*) as count FROM entries WHERE feed_id = ?').get(feed_id) as any;
    expect(entryBefore.count).toBe(1);

    // Delete feed
    const delRes = await app.request(`/v1/feeds/${feed_id}`, {
      method: 'DELETE',
      headers: { Authorization: authHeader },
    });
    expect(delRes.status).toBe(204);

    // Verify entries deleted via cascade
    const entryAfter = db.query('SELECT COUNT(*) as count FROM entries WHERE feed_id = ?').get(feed_id) as any;
    expect(entryAfter.count).toBe(0);
  });

  test('PUT /v1/feeds/:id/mark-all-as-read marks entries', async () => {
    // Create a feed with entries
    const createRes = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'https://example.com/mark-read-feed.xml',
        category_id: 1,
      }),
    });
    const { feed_id } = await createRes.json() as any;

    const db = getTestDb();
    const feed = db.query('SELECT * FROM feeds WHERE id = ?').get(feed_id) as Feed;
    upsertEntries(feed, [
      { hash: 'mr-1', title: 'Entry 1', url: 'https://example.com/mr-1', author: '', content: '<p>Content</p>', published_at: '2026-01-01T00:00:00Z', enclosures: [] },
      { hash: 'mr-2', title: 'Entry 2', url: 'https://example.com/mr-2', author: '', content: '<p>Content</p>', published_at: '2026-01-02T00:00:00Z', enclosures: [] },
    ]);

    // All should be unread
    const unreadBefore = db.query("SELECT COUNT(*) as count FROM entries WHERE feed_id = ? AND status = 'unread'").get(feed_id) as any;
    expect(unreadBefore.count).toBe(2);

    const res = await app.request(`/v1/feeds/${feed_id}/mark-all-as-read`, {
      method: 'PUT',
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(204);

    // All should now be read
    const readAfter = db.query("SELECT COUNT(*) as count FROM entries WHERE feed_id = ? AND status = 'read'").get(feed_id) as any;
    expect(readAfter.count).toBe(2);
  });
});

// ─── Entry operations ───

describe('Entry operations', () => {
  let feedId: number;

  beforeAll(async () => {
    // Ensure we have a feed with entries
    const createRes = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'https://example.com/entries-test-feed.xml',
        category_id: 1,
      }),
    });
    const { feed_id } = await createRes.json() as any;
    feedId = feed_id;

    const db = getTestDb();
    const feed = db.query('SELECT * FROM feeds WHERE id = ?').get(feedId) as Feed;
    upsertEntries(feed, [
      {
        hash: 'entry-ops-1',
        title: 'Test Entry One',
        url: 'https://example.com/entry-1',
        author: 'Alice',
        content: '<p>First entry content with enough words to generate reading time</p>',
        published_at: '2026-03-14T10:00:00Z',
        enclosures: [],
      },
      {
        hash: 'entry-ops-2',
        title: 'Test Entry Two',
        url: 'https://example.com/entry-2',
        author: 'Bob',
        content: '<p>Second entry content</p>',
        published_at: '2026-03-14T11:00:00Z',
        enclosures: [
          { url: 'https://example.com/podcast.mp3', mime_type: 'audio/mpeg', size: 5000 },
        ],
      },
      {
        hash: 'entry-ops-3',
        title: 'Test Entry Three',
        url: 'https://example.com/entry-3',
        author: 'Charlie',
        content: '<p>Third entry</p>',
        published_at: '2026-03-14T12:00:00Z',
        enclosures: [],
      },
    ]);
  });

  test('GET /v1/entries returns entries with total', async () => {
    const res = await app.request('/v1/entries', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.entries).toBeArray();
    expect(body.entries.length).toBeGreaterThanOrEqual(1);
  });

  test('GET /v1/entries supports status filter', async () => {
    const res = await app.request('/v1/entries?status=unread', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    for (const entry of body.entries) {
      expect(entry.status).toBe('unread');
    }
  });

  test('GET /v1/entries supports limit and offset', async () => {
    const res = await app.request('/v1/entries?limit=1&offset=0', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.entries.length).toBeLessThanOrEqual(1);
  });

  test('GET /v1/entries/:id returns a single entry with feed info', async () => {
    const db = getTestDb();
    const entry = db.query("SELECT id FROM entries WHERE hash = 'entry-ops-1'").get() as any;

    const res = await app.request(`/v1/entries/${entry.id}`, {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.id).toBe(entry.id);
    expect(body.title).toBe('Test Entry One');
    expect(body.feed).toBeDefined();
    expect(body.feed.id).toBe(feedId);
  });

  test('GET /v1/entries/:id includes enclosures', async () => {
    const db = getTestDb();
    const entry = db.query("SELECT id FROM entries WHERE hash = 'entry-ops-2'").get() as any;

    const res = await app.request(`/v1/entries/${entry.id}`, {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.enclosures).toBeArray();
    expect(body.enclosures.length).toBe(1);
    expect(body.enclosures[0].mime_type).toBe('audio/mpeg');
  });

  test('GET /v1/entries/:id returns 404 for non-existent entry', async () => {
    const res = await app.request('/v1/entries/999999', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error_message).toBeDefined();
  });

  test('PUT /v1/entries bulk status update', async () => {
    const db = getTestDb();
    const allEntries = db.query(`SELECT id FROM entries WHERE feed_id = ? LIMIT 2`).all(feedId) as any[];
    const entryIds = allEntries.map((e: any) => e.id);

    const res = await app.request('/v1/entries', {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_ids: entryIds, status: 'read' }),
    });
    expect(res.status).toBe(204);

    // Verify
    const readEntries = db.query(
      `SELECT COUNT(*) as count FROM entries WHERE id IN (${entryIds.map(() => '?').join(',')}) AND status = 'read'`
    ).get(...entryIds) as any;
    expect(readEntries.count).toBe(entryIds.length);
  });

  test('PUT /v1/entries rejects invalid status', async () => {
    const res = await app.request('/v1/entries', {
      method: 'PUT',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entry_ids: [1], status: 'invalid' }),
    });
    expect(res.status).toBe(400);
  });

  test('PUT /v1/entries/:id/bookmark toggles starred', async () => {
    const db = getTestDb();
    const entry = db.query("SELECT id, starred FROM entries WHERE hash = 'entry-ops-3'").get() as any;

    // Should be 0 initially
    expect(entry.starred).toBe(0);

    // Toggle on
    const res = await app.request(`/v1/entries/${entry.id}/bookmark`, {
      method: 'PUT',
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(204);

    // Verify toggled
    const after = db.query('SELECT starred FROM entries WHERE id = ?').get(entry.id) as any;
    expect(after.starred).toBe(1);

    // Toggle off
    const res2 = await app.request(`/v1/entries/${entry.id}/bookmark`, {
      method: 'PUT',
      headers: { Authorization: authHeader },
    });
    expect(res2.status).toBe(204);

    const after2 = db.query('SELECT starred FROM entries WHERE id = ?').get(entry.id) as any;
    expect(after2.starred).toBe(0);
  });

  test('GET /v1/feeds/:id/entries returns entries for a specific feed', async () => {
    const res = await app.request(`/v1/feeds/${feedId}/entries`, {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.entries).toBeArray();
  });
});

// ─── Feed counters with real entries ───

describe('Feed counters with entries', () => {
  test('GET /v1/feeds/counters reflects actual read/unread counts', async () => {
    const res = await app.request('/v1/feeds/counters', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.reads).toBeDefined();
    expect(body.unreads).toBeDefined();

    // Should have some data from earlier tests
    const totalReads = Object.values(body.reads).reduce((a: number, b: any) => a + b, 0) as number;
    const totalUnreads = Object.values(body.unreads).reduce((a: number, b: any) => a + b, 0) as number;
    expect(totalReads + totalUnreads).toBeGreaterThan(0);
  });
});

// ─── SSRF Protection ───

describe('SSRF protection', () => {
  test('POST /v1/feeds blocks localhost URLs', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'http://localhost:8080/feed.xml',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error_message).toContain('localhost');
  });

  test('POST /v1/feeds blocks 127.0.0.1', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'http://127.0.0.1/feed.xml',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error_message).toContain('localhost');
  });

  test('POST /v1/feeds blocks private IP 10.x.x.x', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'http://10.0.0.1/feed.xml',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error_message).toContain('private');
  });

  test('POST /v1/feeds blocks private IP 192.168.x.x', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'http://192.168.1.1/feed.xml',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error_message).toContain('private');
  });

  test('POST /v1/feeds blocks file:// scheme', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'file:///etc/passwd',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error_message).toContain('scheme');
  });

  test('POST /v1/feeds blocks cloud metadata endpoint', async () => {
    const res = await app.request('/v1/feeds', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feed_url: 'http://169.254.169.254/latest/meta-data',
        category_id: 1,
      }),
    });
    expect(res.status).toBe(400);
  });

  test('POST /v1/discover blocks localhost URLs', async () => {
    const res = await app.request('/v1/discover', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'http://localhost:3000/feed' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error_message).toContain('localhost');
  });

  test('POST /v1/discover requires url field', async () => {
    const res = await app.request('/v1/discover', {
      method: 'POST',
      headers: { Authorization: authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.error_message).toContain('url');
  });
});

// ─── Error format ───

describe('Error response format', () => {
  test('404 errors return error_message', async () => {
    const res = await app.request('/v1/feeds/999999', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error_message).toBeDefined();
    expect(typeof body.error_message).toBe('string');
  });

  test('401 errors return error_message', async () => {
    const res = await app.request('/v1/me');
    expect(res.status).toBe(401);
    const body = await res.json() as any;
    expect(body.error_message).toBeDefined();
  });

  test('Unknown routes return 404 with error_message', async () => {
    const res = await app.request('/v1/nonexistent', {
      headers: { Authorization: authHeader },
    });
    expect(res.status).toBe(404);
    const body = await res.json() as any;
    expect(body.error_message).toBe('Not Found');
  });
});

// ─── Entry deduplication ───

describe('Entry deduplication', () => {
  test('upsertEntries skips entries with existing hash', () => {
    const db = getTestDb();

    // Create a fresh feed for this test
    db.run(`
      INSERT INTO feeds (user_id, category_id, title, feed_url, source_type)
      VALUES (1, 1, 'Dedup Test Feed', 'https://example.com/dedup-feed.xml', 'rss')
    `);
    const feedRow = db.query("SELECT * FROM feeds WHERE feed_url = 'https://example.com/dedup-feed.xml'").get() as Feed;

    const first: NewEntry[] = [
      { hash: 'dedup-1', title: 'Entry A', url: 'https://example.com/a', author: '', content: '<p>A</p>', published_at: '2026-01-01T00:00:00Z', enclosures: [] },
      { hash: 'dedup-2', title: 'Entry B', url: 'https://example.com/b', author: '', content: '<p>B</p>', published_at: '2026-01-02T00:00:00Z', enclosures: [] },
    ];

    const insertedFirst = upsertEntries(feedRow, first);
    expect(insertedFirst).toBe(2);

    // Second batch with overlapping + new
    const second: NewEntry[] = [
      { hash: 'dedup-1', title: 'Entry A dupe', url: 'https://example.com/a', author: '', content: '<p>A Updated</p>', published_at: '2026-01-01T00:00:00Z', enclosures: [] },
      { hash: 'dedup-3', title: 'Entry C', url: 'https://example.com/c', author: '', content: '<p>C</p>', published_at: '2026-01-03T00:00:00Z', enclosures: [] },
    ];

    const insertedSecond = upsertEntries(feedRow, second);
    expect(insertedSecond).toBe(1); // Only dedup-3 is new

    const count = db.query('SELECT COUNT(*) as count FROM entries WHERE feed_id = ?').get(feedRow.id) as any;
    expect(count.count).toBe(3);
  });

  test('upsertEntries deduplicates within same batch', () => {
    const db = getTestDb();

    db.run(`
      INSERT INTO feeds (user_id, category_id, title, feed_url, source_type)
      VALUES (1, 1, 'Intra-Batch Dedup', 'https://example.com/intra-batch.xml', 'rss')
    `);
    const feedRow = db.query("SELECT * FROM feeds WHERE feed_url = 'https://example.com/intra-batch.xml'").get() as Feed;

    const batch: NewEntry[] = [
      { hash: 'intra-1', title: 'Entry 1', url: 'https://example.com/1', author: '', content: '<p>One</p>', published_at: '2026-01-01T00:00:00Z', enclosures: [] },
      { hash: 'intra-1', title: 'Entry 1 Dupe', url: 'https://example.com/1', author: '', content: '<p>One Dupe</p>', published_at: '2026-01-01T00:00:00Z', enclosures: [] },
      { hash: 'intra-2', title: 'Entry 2', url: 'https://example.com/2', author: '', content: '<p>Two</p>', published_at: '2026-01-02T00:00:00Z', enclosures: [] },
    ];

    const inserted = upsertEntries(feedRow, batch);
    expect(inserted).toBe(2); // intra-1 should only be inserted once

    const count = db.query('SELECT COUNT(*) as count FROM entries WHERE feed_id = ?').get(feedRow.id) as any;
    expect(count.count).toBe(2);
  });
});

// ─── Reading time ───

describe('Reading time on entry insert', () => {
  test('entries get reading_time calculated on upsert', () => {
    const db = getTestDb();

    db.run(`
      INSERT INTO feeds (user_id, category_id, title, feed_url, source_type)
      VALUES (1, 1, 'ReadTime Feed', 'https://example.com/readtime-feed.xml', 'rss')
    `);
    const feedRow = db.query("SELECT * FROM feeds WHERE feed_url = 'https://example.com/readtime-feed.xml'").get() as Feed;

    // About 265 words → ~1 min
    const words = Array(265).fill('word').join(' ');
    const entries: NewEntry[] = [
      {
        hash: 'rt-1',
        title: 'Long Entry',
        url: 'https://example.com/rt-1',
        author: '',
        content: `<p>${words}</p>`,
        published_at: '2026-01-01T00:00:00Z',
        enclosures: [],
      },
    ];

    upsertEntries(feedRow, entries);

    const entry = db.query("SELECT reading_time FROM entries WHERE hash = 'rt-1'").get() as any;
    expect(entry.reading_time).toBeGreaterThanOrEqual(1);
  });
});

// ─── Health endpoint ───

describe('Health endpoint extended', () => {
  test('GET /health returns status and version', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
  });
});

import { describe, expect, test, beforeAll, afterAll } from 'bun:test';
import { setupTestDb, teardownTestDb, getTestDb } from '../helpers/db.ts';
import { upsertEntries } from '../../src/services/scheduler.ts';
import type { Feed, NewEntry } from '../../src/sources/types.ts';

// Minimal feed object for testing
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

describe('upsertEntries', () => {
  beforeAll(async () => {
    await setupTestDb();
    // Create a test feed
    const db = getTestDb();
    db.run(`
      INSERT INTO feeds (id, user_id, category_id, title, feed_url, source_type)
      VALUES (1, 1, 1, 'Test Feed', 'https://example.com/feed.xml', 'rss')
    `);
  });

  afterAll(teardownTestDb);

  test('inserts new entries', () => {
    const entries: NewEntry[] = [
      {
        hash: 'hash-1',
        title: 'First Entry',
        url: 'https://example.com/1',
        author: 'Author A',
        content: '<p>Hello world content here</p>',
        published_at: '2026-03-14T10:00:00Z',
        enclosures: [],
      },
      {
        hash: 'hash-2',
        title: 'Second Entry',
        url: 'https://example.com/2',
        author: 'Author B',
        content: '<p>Second entry content here</p>',
        published_at: '2026-03-14T11:00:00Z',
        enclosures: [
          { url: 'https://example.com/audio.mp3', mime_type: 'audio/mpeg', size: 1234 },
        ],
      },
    ];

    const feed = makeFeed();
    const inserted = upsertEntries(feed, entries);

    expect(inserted).toBe(2);

    // Verify entries in DB
    const db = getTestDb();
    const rows = db.query('SELECT * FROM entries WHERE feed_id = 1 ORDER BY published_at ASC').all() as any[];
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe('First Entry');
    expect(rows[0].hash).toBe('hash-1');
    expect(rows[0].status).toBe('unread');
    expect(rows[0].reading_time).toBeGreaterThanOrEqual(1);
    expect(rows[1].title).toBe('Second Entry');

    // Verify enclosures
    const enclosures = db.query('SELECT * FROM enclosures WHERE entry_id = ?').all(rows[1].id) as any[];
    expect(enclosures).toHaveLength(1);
    expect(enclosures[0].url).toBe('https://example.com/audio.mp3');
    expect(enclosures[0].mime_type).toBe('audio/mpeg');
    expect(enclosures[0].size).toBe(1234);
  });

  test('deduplicates entries by hash', () => {
    const entries: NewEntry[] = [
      {
        hash: 'hash-1', // Same hash as existing entry
        title: 'Duplicate Entry',
        url: 'https://example.com/1',
        author: 'Author A',
        content: '<p>Updated content</p>',
        published_at: '2026-03-14T12:00:00Z',
        enclosures: [],
      },
      {
        hash: 'hash-3', // New entry
        title: 'Third Entry',
        url: 'https://example.com/3',
        author: 'Author C',
        content: '<p>Third entry content here</p>',
        published_at: '2026-03-14T12:00:00Z',
        enclosures: [],
      },
    ];

    const feed = makeFeed();
    const inserted = upsertEntries(feed, entries);

    // Only the new entry should be inserted
    expect(inserted).toBe(1);

    const db = getTestDb();
    const count = db.query('SELECT COUNT(*) as count FROM entries WHERE feed_id = 1').get() as { count: number };
    expect(count.count).toBe(3);
  });

  test('handles empty entries array', () => {
    const feed = makeFeed();
    const inserted = upsertEntries(feed, []);
    expect(inserted).toBe(0);
  });

  test('inserts multiple enclosures per entry', () => {
    const entries: NewEntry[] = [
      {
        hash: 'hash-multi-enc',
        title: 'Multi Enclosure',
        url: 'https://example.com/multi',
        author: '',
        content: '<p>Entry with multiple enclosures</p>',
        published_at: '2026-03-14T13:00:00Z',
        enclosures: [
          { url: 'https://example.com/video.mp4', mime_type: 'video/mp4', size: 5000 },
          { url: 'https://example.com/thumb.jpg', mime_type: 'image/jpeg', size: 200 },
        ],
      },
    ];

    const feed = makeFeed();
    const inserted = upsertEntries(feed, entries);
    expect(inserted).toBe(1);

    const db = getTestDb();
    const entry = db.query("SELECT id FROM entries WHERE hash = 'hash-multi-enc'").get() as { id: number };
    const enclosures = db.query('SELECT * FROM enclosures WHERE entry_id = ?').all(entry.id) as any[];
    expect(enclosures).toHaveLength(2);
  });
});

// Feeds hand us an entry once, so a stored body is otherwise never revisited.
// These cover repairing entries left holding a summary — e.g. The Atlantic,
// whose feed carries the whole article in Atom <content>.
describe('upsertEntries teaser upgrade', () => {
  const FULL = `<p>${'word '.repeat(600)}</p>`;
  const TEASER = '<p>A one-line teaser.</p>';

  beforeAll(async () => {
    await setupTestDb();
    getTestDb().run(`
      INSERT INTO feeds (id, user_id, category_id, title, feed_url, source_type)
      VALUES (1, 1, 1, 'Test Feed', 'https://example.com/feed.xml', 'rss')
    `);
  });

  afterAll(teardownTestDb);

  function makeEntry(hash: string, content: string): NewEntry {
    return {
      hash,
      title: 'Entry',
      url: `https://example.com/${hash}`,
      author: '',
      content,
      published_at: '2026-03-14T10:00:00Z',
      enclosures: [],
    };
  }

  function storedContent(hash: string): string {
    return (getTestDb().query('SELECT content FROM entries WHERE hash = ?').get(hash) as { content: string }).content;
  }

  test('replaces a stored teaser with the feed\'s full article', () => {
    const feed = makeFeed();
    expect(upsertEntries(feed, [makeEntry('upgrade-1', TEASER)])).toBe(1);
    expect(storedContent('upgrade-1')).toBe(TEASER);

    // Re-syncing the same entry, now with full text, counts as no new entry
    expect(upsertEntries(feed, [makeEntry('upgrade-1', FULL)])).toBe(0);
    expect(storedContent('upgrade-1')).toBe(FULL);
  });

  test('recalculates reading time for the upgraded body', () => {
    const feed = makeFeed();
    upsertEntries(feed, [makeEntry('upgrade-2', TEASER)]);
    upsertEntries(feed, [makeEntry('upgrade-2', FULL)]);
    const row = getTestDb().query('SELECT reading_time FROM entries WHERE hash = ?')
      .get('upgrade-2') as { reading_time: number };
    expect(row.reading_time).toBeGreaterThan(1);
  });

  test('never downgrades a full article back to a teaser', () => {
    const feed = makeFeed();
    upsertEntries(feed, [makeEntry('upgrade-3', FULL)]);
    upsertEntries(feed, [makeEntry('upgrade-3', TEASER)]);
    expect(storedContent('upgrade-3')).toBe(FULL);
  });

  test('leaves crawler-extracted content alone', () => {
    const feed = makeFeed();
    upsertEntries(feed, [makeEntry('upgrade-4', TEASER)]);
    getTestDb().run("UPDATE entries SET content_fetched = 1 WHERE hash = 'upgrade-4'");
    upsertEntries(feed, [makeEntry('upgrade-4', FULL)]);
    expect(storedContent('upgrade-4')).toBe(TEASER);
  });
});

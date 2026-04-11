import { describe, test, expect } from 'bun:test';
import { generateOPML, parseOPML } from '../../src/lib/opml.ts';

describe('generateOPML', () => {
  test('generates valid OPML with categories', () => {
    const feeds = [
      { title: 'Feed A', feedUrl: 'https://a.com/rss', siteUrl: 'https://a.com', category: 'Tech' },
      { title: 'Feed B', feedUrl: 'https://b.com/rss', siteUrl: 'https://b.com', category: 'Tech' },
      { title: 'Feed C', feedUrl: 'https://c.com/rss', siteUrl: 'https://c.com', category: 'News' },
    ];
    const xml = generateOPML(feeds);

    expect(xml).toContain('<?xml version="1.0"');
    expect(xml).toContain('<opml version="2.0">');
    expect(xml).toContain('text="Tech"');
    expect(xml).toContain('text="News"');
    expect(xml).toContain('xmlUrl="https://a.com/rss"');
    expect(xml).toContain('xmlUrl="https://c.com/rss"');
    expect(xml).toContain('</opml>');
  });

  test('escapes XML special characters', () => {
    const feeds = [
      { title: 'A & B <test>', feedUrl: 'https://x.com/rss?a=1&b=2', siteUrl: '', category: 'Cat "1"' },
    ];
    const xml = generateOPML(feeds);
    expect(xml).toContain('&amp;');
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&quot;');
  });

  test('puts uncategorized feeds under "Uncategorized"', () => {
    const feeds = [
      { title: 'Orphan', feedUrl: 'https://orphan.com/rss', siteUrl: '', category: '' },
    ];
    const xml = generateOPML(feeds);
    expect(xml).toContain('text="Uncategorized"');
  });
});

describe('parseOPML', () => {
  test('parses categorized feeds', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="Tech" title="Tech">
      <outline type="rss" text="Feed A" title="Feed A" xmlUrl="https://a.com/rss" htmlUrl="https://a.com" />
      <outline type="rss" text="Feed B" title="Feed B" xmlUrl="https://b.com/rss" htmlUrl="https://b.com" />
    </outline>
    <outline text="News" title="News">
      <outline type="rss" text="Feed C" title="Feed C" xmlUrl="https://c.com/rss" htmlUrl="https://c.com" />
    </outline>
  </body>
</opml>`;

    const feeds = parseOPML(xml);
    expect(feeds.length).toBe(3);

    const feedA = feeds.find(f => f.title === 'Feed A');
    expect(feedA).toBeDefined();
    expect(feedA!.feedUrl).toBe('https://a.com/rss');
    expect(feedA!.category).toBe('Tech');

    const feedB = feeds.find(f => f.title === 'Feed B');
    expect(feedB).toBeDefined();
    expect(feedB!.feedUrl).toBe('https://b.com/rss');
    expect(feedB!.category).toBe('Tech');

    const feedC = feeds.find(f => f.title === 'Feed C');
    expect(feedC).toBeDefined();
    expect(feedC!.category).toBe('News');
  });

  test('parses paired <outline>...</outline> tags', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0">
  <head><title>Feed Reader</title></head>
  <body>
    <outline text="Podcasts">
      <outline title="Podcast A" text="Podcast A" xmlUrl="https://a.com/pod" htmlUrl="https://a.com/pod" type="rss"></outline>
      <outline title="Podcast B" text="Podcast B" xmlUrl="https://b.com/pod" htmlUrl="https://b.com/pod" type="rss"></outline>
      <outline title="Podcast C" text="Podcast C" xmlUrl="https://c.com/pod" htmlUrl="https://c.com/pod" type="rss"></outline>
    </outline>
    <outline text="News">
      <outline title="News Feed" text="News Feed" xmlUrl="https://news.com/rss" htmlUrl="https://news.com" description="Latest news" type="rss"></outline>
    </outline>
  </body>
</opml>`;

    const feeds = parseOPML(xml);
    expect(feeds.length).toBe(4);

    const podcasts = feeds.filter(f => f.category === 'Podcasts');
    expect(podcasts.length).toBe(3);
    expect(podcasts.map(p => p.title)).toEqual(['Podcast A', 'Podcast B', 'Podcast C']);

    const news = feeds.filter(f => f.category === 'News');
    expect(news.length).toBe(1);
    expect(news[0].title).toBe('News Feed');
  });

  test('parses top-level feeds without categories', () => {
    const xml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline type="rss" text="Standalone" xmlUrl="https://standalone.com/rss" htmlUrl="https://standalone.com" />
  </body>
</opml>`;

    const feeds = parseOPML(xml);
    expect(feeds.length).toBe(1);
    expect(feeds[0].title).toBe('Standalone');
    expect(feeds[0].category).toBe('');
  });

  test('unescapes XML entities', () => {
    const xml = `<?xml version="1.0"?>
<opml version="2.0">
  <head><title>Test</title></head>
  <body>
    <outline text="A &amp; B" title="A &amp; B">
      <outline type="rss" text="Feed &lt;1&gt;" xmlUrl="https://x.com/rss?a=1&amp;b=2" htmlUrl="" />
    </outline>
  </body>
</opml>`;

    const feeds = parseOPML(xml);
    expect(feeds.length).toBe(1);
    expect(feeds[0].feedUrl).toBe('https://x.com/rss?a=1&b=2');
  });

  test('roundtrip: generate then parse', () => {
    const original = [
      { title: 'Feed X', feedUrl: 'https://x.com/feed', siteUrl: 'https://x.com', category: 'Cat A' },
      { title: 'Feed Y', feedUrl: 'https://y.com/feed', siteUrl: 'https://y.com', category: 'Cat B' },
    ];
    const xml = generateOPML(original);
    const parsed = parseOPML(xml);

    expect(parsed.length).toBe(2);
    for (const orig of original) {
      const found = parsed.find(f => f.feedUrl === orig.feedUrl);
      expect(found).toBeDefined();
      expect(found!.title).toBe(orig.title);
      expect(found!.siteUrl).toBe(orig.siteUrl);
      expect(found!.category).toBe(orig.category);
    }
  });
});

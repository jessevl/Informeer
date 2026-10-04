import { describe, expect, test, afterEach } from 'bun:test';
import { RSSSource } from '../../src/sources/rss.ts';
import type { Feed } from '../../src/sources/types.ts';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** Serve `xml` to the next RSSSource.fetch() call and return the parsed entries. */
async function parseFeed(xml: string) {
  globalThis.fetch = (async () => new Response(xml, {
    status: 200,
    headers: { 'Content-Type': 'application/xml' },
  })) as typeof fetch;

  const feed = { id: 1, feed_url: 'https://example.com/feed', site_url: 'https://example.com' } as Feed;
  const result = await new RSSSource().fetch(feed, new AbortController().signal);
  return result.entries;
}

const atomWithSummaryAndContent = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Example</title>
  <entry>
    <id>tag:example.com,2026:1</id>
    <content type="html">&lt;p&gt;The full article body, with &lt;em&gt;markup&lt;/em&gt; and a &lt;a href="/more"&gt;link&lt;/a&gt;.&lt;/p&gt;</content>
    <title>Full Text Entry</title>
    <published>2026-10-01T12:00:00-04:00</published>
    <summary>A one-line teaser.</summary>
    <link href="https://example.com/full-text" rel="alternate"></link>
  </entry>
</feed>`;

const rssWithContentEncoded = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example</title>
    <item>
      <title>Encoded Entry</title>
      <link>https://example.com/encoded</link>
      <description>Just the teaser.</description>
      <content:encoded><![CDATA[<p>The <strong>full</strong> body.</p>]]></content:encoded>
    </item>
  </channel>
</rss>`;

describe('RSSSource', () => {
  test('has type "rss"', () => {
    const source = new RSSSource();
    expect(source.type).toBe('rss');
  });

  test('implements ContentSource interface', () => {
    const source = new RSSSource();
    expect(typeof source.fetch).toBe('function');
  });
});

// The Atlantic's "Best of" feed syndicates whole articles in Atom <content>
// while <summary> holds a one-line teaser. feed-extractor normalizes to the
// teaser and strips its tags, so these cases guard the full-text path.
describe('RSSSource full-text content', () => {
  test('prefers Atom <content> over the shorter <summary>', async () => {
    const [entry] = await parseFeed(atomWithSummaryAndContent);
    expect(entry.content).toContain('The full article body');
    expect(entry.content).not.toContain('A one-line teaser');
  });

  test('keeps the markup from Atom <content>', async () => {
    const [entry] = await parseFeed(atomWithSummaryAndContent);
    expect(entry.content).toContain('<em>markup</em>');
    // Relative links are resolved against the feed's site_url
    expect(entry.content).toContain('href="https://example.com/more"');
  });

  test('prefers RSS <content:encoded> over <description>', async () => {
    const [entry] = await parseFeed(rssWithContentEncoded);
    expect(entry.content).toContain('<strong>full</strong>');
    expect(entry.content).not.toContain('Just the teaser');
  });

  test('falls back to <description> when nothing richer is offered', async () => {
    const [entry] = await parseFeed(`<?xml version="1.0"?>
      <rss version="2.0"><channel><item>
        <title>Teaser Only</title>
        <link>https://example.com/teaser</link>
        <description>&lt;p&gt;All there is.&lt;/p&gt;</description>
      </item></channel></rss>`);
    expect(entry.content).toContain('All there is.');
  });

  test('ignores <content src="..."> with no inline body', async () => {
    const [entry] = await parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <title>Out of line</title>
        <content src="https://example.com/body.html" type="text/html"></content>
        <summary>Fallback summary.</summary>
        <link href="https://example.com/out-of-line" rel="alternate"></link>
      </entry></feed>`);
    expect(entry.content).toContain('Fallback summary.');
  });

  test('escapes Atom content declared as type="text"', async () => {
    const [entry] = await parseFeed(`<?xml version="1.0"?>
      <feed xmlns="http://www.w3.org/2005/Atom"><entry>
        <title>Plain</title>
        <content type="text">1 &lt; 2 &amp; 3 &gt; 2</content>
        <link href="https://example.com/plain" rel="alternate"></link>
      </entry></feed>`);
    expect(entry.content).toBe('1 &lt; 2 &amp; 3 &gt; 2');
  });

  test('hashes on URL so full-text content does not re-key existing entries', async () => {
    const [withContent] = await parseFeed(atomWithSummaryAndContent);
    const [withoutContent] = await parseFeed(
      atomWithSummaryAndContent.replace(/<content type="html">[\s\S]*?<\/content>/, '')
    );
    expect(withContent.hash).toBe(withoutContent.hash);
  });
});

import { describe, expect, test } from 'bun:test';
import { RSSSource } from '../../src/sources/rss.ts';

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

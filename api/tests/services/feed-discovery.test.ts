import { describe, expect, test } from 'bun:test';

// Test the feed discovery module's helper logic
// The actual network calls are tested via integration tests

describe('feed-discovery', () => {
  test('module can be imported', async () => {
    const mod = await import('../../src/services/feed-discovery.ts');
    expect(typeof mod.discoverFeeds).toBe('function');
  });
});

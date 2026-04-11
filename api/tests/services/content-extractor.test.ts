import { describe, expect, test } from 'bun:test';

describe('content-extractor', () => {
  test('module can be imported', async () => {
    const mod = await import('../../src/services/content-extractor.ts');
    expect(typeof mod.extractContent).toBe('function');
  });
});

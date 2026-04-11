import { describe, test, expect } from 'bun:test';
import { contentHash } from '../../src/lib/hash.ts';

describe('contentHash', () => {
  test('returns a hex SHA-256 hash', () => {
    const hash = contentHash('hello');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('same input produces same hash', () => {
    expect(contentHash('test')).toBe(contentHash('test'));
  });

  test('different inputs produce different hashes', () => {
    expect(contentHash('a')).not.toBe(contentHash('b'));
  });

  test('known SHA-256 value', () => {
    // SHA-256 of empty string
    expect(contentHash('')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });
});

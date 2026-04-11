import { describe, test, expect } from 'bun:test';
import { toISO, now, parseDate } from '../../src/lib/date.ts';

describe('toISO', () => {
  test('formats Date object', () => {
    const d = new Date('2024-01-15T10:30:00Z');
    expect(toISO(d)).toBe('2024-01-15T10:30:00.000Z');
  });

  test('formats string date', () => {
    expect(toISO('2024-06-01')).toMatch(/^2024-06-01T/);
  });

  test('formats timestamp number', () => {
    const ts = new Date('2024-01-01T00:00:00Z').getTime();
    expect(toISO(ts)).toBe('2024-01-01T00:00:00.000Z');
  });
});

describe('now', () => {
  test('returns ISO string close to current time', () => {
    const result = now();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const diff = Math.abs(Date.now() - new Date(result).getTime());
    expect(diff).toBeLessThan(1000);
  });
});

describe('parseDate', () => {
  test('parses valid date string', () => {
    const d = parseDate('2024-01-15T10:30:00Z');
    expect(d).toBeInstanceOf(Date);
    expect(d!.getFullYear()).toBe(2024);
  });

  test('returns null for null/undefined', () => {
    expect(parseDate(null)).toBeNull();
    expect(parseDate(undefined)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(parseDate('')).toBeNull();
  });

  test('returns null for invalid date', () => {
    expect(parseDate('not-a-date')).toBeNull();
  });
});

/**
 * Tests for error utilities and SSRF validation.
 */
import { describe, test, expect } from 'bun:test';
import {
  AppError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  rateLimited,
  internalError,
  validateFeedUrl,
} from '../../src/lib/errors.ts';

describe('AppError', () => {
  test('creates an error with status and message', () => {
    const err = new AppError(400, 'Bad input');
    expect(err).toBeInstanceOf(Error);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Bad input');
  });
});

describe('Error factory functions', () => {
  test('badRequest returns 400', () => {
    const err = badRequest('invalid input');
    expect(err.status).toBe(400);
    expect(err.message).toBe('invalid input');
  });

  test('unauthorized returns 401', () => {
    const err = unauthorized();
    expect(err.status).toBe(401);
    expect(err.message).toBe('Access Unauthorized');
  });

  test('forbidden returns 403', () => {
    const err = forbidden();
    expect(err.status).toBe(403);
    expect(err.message).toBe('Access Forbidden');
  });

  test('notFound returns 404', () => {
    const err = notFound('Resource missing');
    expect(err.status).toBe(404);
    expect(err.message).toBe('Resource missing');
  });

  test('conflict returns 409', () => {
    const err = conflict('Already exists');
    expect(err.status).toBe(409);
    expect(err.message).toBe('Already exists');
  });

  test('validationError returns 422', () => {
    const err = validationError('Field required');
    expect(err.status).toBe(422);
    expect(err.message).toBe('Field required');
  });

  test('rateLimited returns 429', () => {
    const err = rateLimited();
    expect(err.status).toBe(429);
  });

  test('internalError returns 500', () => {
    const err = internalError();
    expect(err.status).toBe(500);
  });
});

describe('validateFeedUrl', () => {
  test('allows valid HTTP URLs', () => {
    expect(() => validateFeedUrl('https://example.com/feed.xml')).not.toThrow();
    expect(() => validateFeedUrl('http://blog.example.org/rss')).not.toThrow();
    expect(() => validateFeedUrl('https://feeds.feedburner.com/test')).not.toThrow();
  });

  test('allows empty URL', () => {
    expect(() => validateFeedUrl('')).not.toThrow();
  });

  test('blocks file:// scheme', () => {
    expect(() => validateFeedUrl('file:///etc/passwd')).toThrow();
  });

  test('blocks ftp:// scheme', () => {
    expect(() => validateFeedUrl('ftp://example.com/feed')).toThrow();
  });

  test('blocks javascript: scheme', () => {
    expect(() => validateFeedUrl('javascript:alert(1)')).toThrow();
  });

  test('blocks localhost', () => {
    expect(() => validateFeedUrl('http://localhost/feed')).toThrow();
    expect(() => validateFeedUrl('http://localhost:3000/feed')).toThrow();
  });

  test('blocks 127.0.0.1', () => {
    expect(() => validateFeedUrl('http://127.0.0.1/feed')).toThrow();
  });

  test('blocks ::1 (IPv6 loopback)', () => {
    expect(() => validateFeedUrl('http://[::1]/feed')).toThrow();
  });

  test('blocks 0.0.0.0', () => {
    expect(() => validateFeedUrl('http://0.0.0.0/feed')).toThrow();
  });

  test('blocks .local domains', () => {
    expect(() => validateFeedUrl('http://myhost.local/feed')).toThrow();
  });

  test('blocks 10.x.x.x private range', () => {
    expect(() => validateFeedUrl('http://10.0.0.1/feed')).toThrow();
    expect(() => validateFeedUrl('http://10.255.255.255/feed')).toThrow();
  });

  test('blocks 172.16-31.x.x private range', () => {
    expect(() => validateFeedUrl('http://172.16.0.1/feed')).toThrow();
    expect(() => validateFeedUrl('http://172.31.255.255/feed')).toThrow();
  });

  test('allows 172.32.x.x (not private)', () => {
    expect(() => validateFeedUrl('http://172.32.0.1/feed')).not.toThrow();
  });

  test('blocks 192.168.x.x private range', () => {
    expect(() => validateFeedUrl('http://192.168.1.1/feed')).toThrow();
    expect(() => validateFeedUrl('http://192.168.0.100/feed')).toThrow();
  });

  test('blocks 169.254.x.x link-local range', () => {
    expect(() => validateFeedUrl('http://169.254.1.1/feed')).toThrow();
  });

  test('blocks cloud metadata endpoint IP', () => {
    expect(() => validateFeedUrl('http://169.254.169.254/latest/meta-data')).toThrow();
  });

  test('blocks Google metadata hostname', () => {
    expect(() => validateFeedUrl('http://metadata.google.internal/computeMetadata')).toThrow();
  });

  test('throws on invalid URL', () => {
    expect(() => validateFeedUrl('not-a-url')).toThrow();
  });
});

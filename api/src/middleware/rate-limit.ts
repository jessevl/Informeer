import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

/**
 * In-memory rate limiter. Uses a sliding window per IP.
 * Entries are lazily cleaned up when accessed.
 */
class RateLimiter {
  private buckets = new Map<string, RateLimitEntry>();
  private cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Periodic cleanup of expired entries (every 5 minutes)
    this.cleanupTimer = setInterval(() => this.cleanup(), 5 * 60 * 1000);
  }

  /**
   * Check if a request is allowed.
   * Returns { allowed: true, remaining } or { allowed: false, retryAfter }.
   */
  check(key: string, maxRequests: number, windowMs: number): {
    allowed: boolean;
    remaining: number;
    retryAfterMs: number;
  } {
    const now = Date.now();
    const entry = this.buckets.get(key);

    if (!entry || now >= entry.resetAt) {
      // New window
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return { allowed: true, remaining: maxRequests - 1, retryAfterMs: 0 };
    }

    if (entry.count < maxRequests) {
      entry.count++;
      return { allowed: true, remaining: maxRequests - entry.count, retryAfterMs: 0 };
    }

    // Rate limited
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: entry.resetAt - now,
    };
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.buckets) {
      if (now >= entry.resetAt) {
        this.buckets.delete(key);
      }
    }
  }
}

const limiter = new RateLimiter();

function getClientIp(c: any): string {
  return (
    c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
    c.req.header('X-Real-IP') ||
    c.env?.remoteAddress ||
    'unknown'
  );
}

/**
 * Rate limiting middleware factory.
 *
 * @param maxRequests - Maximum requests per window
 * @param windowMs - Window duration in milliseconds
 * @param prefix - Bucket prefix to separate different rate limits
 */
export function rateLimit(maxRequests: number, windowMs: number, prefix = 'global') {
  return createMiddleware(async (c, next) => {
    const ip = getClientIp(c);
    const key = `${prefix}:${ip}`;

    const result = limiter.check(key, maxRequests, windowMs);

    // Always set rate limit headers
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', String(result.remaining));

    if (!result.allowed) {
      const retryAfterSec = Math.ceil(result.retryAfterMs / 1000);
      c.header('Retry-After', String(retryAfterSec));
      throw new HTTPException(429, {
        message: 'Too many requests. Please try again later.',
      });
    }

    await next();
  });
}

/**
 * Pre-configured rate limits:
 * - auth: 20 attempts per minute (brute force protection)
 * - api: 2000 requests per minute (general API — single-user personal app)
 * - upload: 10 uploads per minute
 */
export const authRateLimit = rateLimit(20, 60_000, 'auth');
export const apiRateLimit = rateLimit(2000, 60_000, 'api');
export const uploadRateLimit = rateLimit(10, 60_000, 'upload');

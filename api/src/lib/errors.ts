import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/**
 * Application error with HTTP status code.
 * All errors thrown through this class produce JSON responses:
 *   { "error_message": "..." }
 */
export class AppError extends HTTPException {
  constructor(status: ContentfulStatusCode, message: string) {
    super(status, { message });
  }
}

/** 400 Bad Request */
export function badRequest(message: string): AppError {
  return new AppError(400, message);
}

/** 401 Unauthorized */
export function unauthorized(message = 'Access Unauthorized'): AppError {
  return new AppError(401, message);
}

/** 403 Forbidden */
export function forbidden(message = 'Access Forbidden'): AppError {
  return new AppError(403, message);
}

/** 404 Not Found */
export function notFound(message: string): AppError {
  return new AppError(404, message);
}

/** 409 Conflict (duplicate) */
export function conflict(message: string): AppError {
  return new AppError(409, message);
}

/** 422 Unprocessable Entity (validation) */
export function validationError(message: string): AppError {
  return new AppError(422, message);
}

/** 429 Too Many Requests */
export function rateLimited(message = 'Too many requests. Please try again later.'): AppError {
  return new AppError(429, message);
}

/** 500 Internal Server Error */
export function internalError(message = 'Internal Server Error'): AppError {
  return new AppError(500, message);
}

/**
 * Validate a URL is safe to fetch (SSRF protection).
 * Blocks private IPs, localhost, file:// etc.
 */
export function validateFeedUrl(url: string): void {
  if (!url) return;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw badRequest(`Invalid URL: ${url}`);
  }

  // Block non-HTTP(S) schemes
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw badRequest(`Unsupported URL scheme: ${parsed.protocol}`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Strip IPv6 brackets for comparison
  const rawHost = hostname.replace(/^\[|\]$/g, '');

  // Block localhost and loopback
  if (
    rawHost === 'localhost' ||
    rawHost === '127.0.0.1' ||
    rawHost === '::1' ||
    rawHost === '0.0.0.0' ||
    rawHost.endsWith('.local')
  ) {
    throw badRequest('Feed URLs pointing to localhost are not allowed');
  }

  // Block private IP ranges
  const parts = rawHost.split('.');
  if (parts.length === 4 && parts.every(p => /^\d+$/.test(p))) {
    const [a, b] = parts.map(Number);
    if (
      a === 10 ||                           // 10.0.0.0/8
      (a === 172 && b >= 16 && b <= 31) ||  // 172.16.0.0/12
      (a === 192 && b === 168) ||           // 192.168.0.0/16
      (a === 169 && b === 254)              // 169.254.0.0/16
    ) {
      throw badRequest('Feed URLs pointing to private networks are not allowed');
    }
  }

  // Block metadata endpoints (cloud)
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') {
    throw badRequest('Feed URLs pointing to metadata endpoints are not allowed');
  }
}

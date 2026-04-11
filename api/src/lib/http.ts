/**
 * Shared HTTP client utilities.
 * Centralizes User-Agent, default headers, timeouts, and per-domain
 * rate limiting so we never hammer a site with too many requests.
 */

import { log } from './logger.ts';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

export const BOT_USER_AGENT =
  'Informeer/1.0 (+https://github.com/informeer)';

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Maximum response body size for fetch (15 MiB). */
export const MAX_RESPONSE_BYTES = 15 * 1024 * 1024;

export const FEED_ACCEPT =
  'application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, */*';

export const HTML_ACCEPT =
  'text/html, application/xhtml+xml, application/xml;q=0.9, */*;q=0.8';

// ---------------------------------------------------------------------------
// Per-domain rate limiter — prevents hammering any single host
// ---------------------------------------------------------------------------

interface DomainSlot {
  /** Timestamp (ms) when the next request to this domain is allowed */
  nextAllowedAt: number;
  /** Number of requests made in the current window */
  inflight: number;
}

const domainSlots = new Map<string, DomainSlot>();

// Cleanup stale entries every 10 minutes
setInterval(() => {
  const cutoff = Date.now() - 10 * 60_000;
  for (const [domain, slot] of domainSlots) {
    if (slot.nextAllowedAt < cutoff && slot.inflight === 0) {
      domainSlots.delete(domain);
    }
  }
}, 10 * 60_000);

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'unknown';
  }
}

/**
 * Wait until we're allowed to make a request to this domain.
 * Enforces a minimum gap between requests to the same domain
 * (default 500ms) and a max concurrency per domain (default 2).
 */
async function waitForDomainSlot(
  url: string,
  delayMs: number,
  maxConcurrent: number,
): Promise<() => void> {
  const domain = getDomain(url);
  let slot = domainSlots.get(domain);
  if (!slot) {
    slot = { nextAllowedAt: 0, inflight: 0 };
    domainSlots.set(domain, slot);
  }

  // Wait for concurrency to drop
  while (slot.inflight >= maxConcurrent) {
    await new Promise(r => setTimeout(r, 100));
  }

  // Wait for the rate-limit gap
  const now = Date.now();
  if (slot.nextAllowedAt > now) {
    await new Promise(r => setTimeout(r, slot.nextAllowedAt - now));
  }

  slot.inflight++;
  slot.nextAllowedAt = Date.now() + delayMs;

  // Return release function
  return () => { slot!.inflight--; };
}

// ---------------------------------------------------------------------------
// Rate-limited fetch wrapper
// ---------------------------------------------------------------------------

export interface ThrottledFetchOptions extends RequestInit {
  /** Timeout in ms (default: 15 000) */
  timeoutMs?: number;
  /** Minimum gap between requests to the same domain in ms (default: 500) */
  domainDelayMs?: number;
  /** Max concurrent requests to the same domain (default: 2) */
  domainConcurrency?: number;
  /** Skip domain throttling (for trusted/local URLs) */
  skipThrottle?: boolean;
}

/**
 * fetch() wrapper that enforces:
 * - Per-domain rate limiting (configurable gap + concurrency cap)
 * - Request timeout via AbortSignal
 * - Sensible defaults for Accept and User-Agent
 *
 * Use this for ALL outbound HTTP requests to external sites.
 */
export async function throttledFetch(
  url: string,
  opts: ThrottledFetchOptions = {},
): Promise<Response> {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    domainDelayMs = 500,
    domainConcurrency = 2,
    skipThrottle = false,
    signal: externalSignal,
    ...fetchOpts
  } = opts;

  // Merge abort signals (external + timeout)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Forward external signal to our controller (AbortSignal.any fallback)
  const onExternalAbort = () => controller.abort();
  if (externalSignal) {
    if (externalSignal.aborted) { controller.abort(); }
    else { externalSignal.addEventListener('abort', onExternalAbort, { once: true }); }
  }

  let release: (() => void) | undefined;
  try {
    if (!skipThrottle) {
      release = await waitForDomainSlot(url, domainDelayMs, domainConcurrency);
    }
    const response = await fetch(url, { ...fetchOpts, signal: controller.signal });
    return response;
  } catch (err: any) {
    // Wrap network-level errors (socket reset, DNS failure, TLS errors)
    // into a clean Error instead of letting Bun's native errors propagate
    // as uncatchable signals. This prevents SIGSEGV crashes.
    const msg = err?.message || String(err);
    if (
      msg.includes('socket') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('EPIPE') ||
      msg.includes('UND_ERR') ||
      msg.includes('TLS') ||
      msg.includes('closed unexpectedly') ||
      msg.includes('aborted')
    ) {
      throw new Error(`Network error fetching ${getDomain(url)}: ${msg}`);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
    externalSignal?.removeEventListener('abort', onExternalAbort);
    release?.();
  }
}

// ---------------------------------------------------------------------------
// Convenience builders for common header sets
// ---------------------------------------------------------------------------

export function feedFetchHeaders(feed?: {
  etag_header?: string;
  last_modified_header?: string;
  ignore_http_cache?: number | boolean;
  user_agent?: string;
  cookie?: string;
  username?: string;
  password?: string;
}): Record<string, string> {
  const h: Record<string, string> = {
    Accept: FEED_ACCEPT,
    'Accept-Encoding': 'gzip, deflate',
    'User-Agent': feed?.user_agent || BROWSER_USER_AGENT,
  };

  if (feed && !feed.ignore_http_cache) {
    if (feed.etag_header) h['If-None-Match'] = feed.etag_header;
    if (feed.last_modified_header) h['If-Modified-Since'] = feed.last_modified_header;
  }

  if (feed?.username && feed?.password) {
    h['Authorization'] = `Basic ${btoa(`${feed.username}:${feed.password}`)}`;
  }
  if (feed?.cookie) h['Cookie'] = feed.cookie;

  return h;
}

export function htmlFetchHeaders(overrides?: {
  userAgent?: string;
  cookie?: string;
  referer?: string;
}): Record<string, string> {
  const h: Record<string, string> = {
    Accept: HTML_ACCEPT,
    'Accept-Language': 'en-US,en;q=0.9,nl;q=0.8',
    'User-Agent': overrides?.userAgent || BROWSER_USER_AGENT,
    'Cache-Control': 'no-cache',
    Pragma: 'no-cache',
    // Close the connection after each request.
    // Prevents keep-alive socket-reuse issues that cause SIGSEGV
    // in Bun when servers (e.g. tweakers.net) close connections early.
    Connection: 'close',
  };
  if (overrides?.cookie) h['Cookie'] = overrides.cookie;
  if (overrides?.referer) h['Referer'] = overrides.referer;
  return h;
}

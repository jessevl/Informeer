import { createMiddleware } from 'hono/factory';
import { log } from '../lib/logger.ts';

let requestCounter = 0;

/** Structured request logger middleware */
export const logger = createMiddleware(async (c, next) => {
  const requestId = `req-${++requestCounter}`;
  const start = performance.now();

  // Attach request ID to response headers
  c.header('X-Request-ID', requestId);

  await next();

  const ms = (performance.now() - start).toFixed(1);
  const status = c.res.status;
  const method = c.req.method;
  const path = c.req.path;

  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
  log[level](`${method} ${path} → ${status}`, {
    request_id: requestId,
    method,
    path,
    status,
    duration_ms: parseFloat(ms),
  });
});

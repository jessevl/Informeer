import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { getDb } from '../db/connection.ts';
import { verifyPassword } from '../lib/crypto.ts';

export interface AuthUser {
  id: number;
  username: string;
  is_admin: boolean;
}

// Throttle last_login_at updates: once per user per 5 minutes
const lastLoginUpdated = new Map<number, number>();
const LOGIN_UPDATE_INTERVAL_MS = 5 * 60_000;

/** HTTP Basic Auth middleware. Validates against users table. */
export const auth = createMiddleware<{ Variables: { user: AuthUser } }>(async (c, next) => {
  const header = c.req.header('Authorization');
  if (!header?.startsWith('Basic ')) {
    throw new HTTPException(401, {
      message: 'Access Unauthorized',
      res: new Response('Access Unauthorized', {
        status: 401,
        headers: { 'WWW-Authenticate': 'Basic realm="Informeer"' },
      }),
    });
  }

  const decoded = atob(header.slice(6));
  const colonIdx = decoded.indexOf(':');
  if (colonIdx === -1) {
    throw new HTTPException(401, { message: 'Invalid credentials' });
  }

  const username = decoded.slice(0, colonIdx);
  const password = decoded.slice(colonIdx + 1);

  const db = getDb();
  const row = db.query(
    'SELECT id, username, password_hash, is_admin FROM users WHERE username = ?'
  ).get(username) as { id: number; username: string; password_hash: string; is_admin: number } | null;

  if (!row) {
    throw new HTTPException(401, { message: 'Invalid credentials' });
  }

  const valid = await verifyPassword(password, row.password_hash);
  if (!valid) {
    throw new HTTPException(401, { message: 'Invalid credentials' });
  }

  // Throttled last_login_at — once per 5 minutes per user (avoids a write on every request)
  const now = Date.now();
  const lastUpdate = lastLoginUpdated.get(row.id) ?? 0;
  if (now - lastUpdate > LOGIN_UPDATE_INTERVAL_MS) {
    db.run('UPDATE users SET last_login_at = datetime(\'now\') WHERE id = ?', [row.id]);
    lastLoginUpdated.set(row.id, now);
  }

  c.set('user', {
    id: row.id,
    username: row.username,
    is_admin: !!row.is_admin,
  });

  await next();
});

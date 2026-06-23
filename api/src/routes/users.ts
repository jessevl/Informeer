import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';
import { getDb } from '../db/connection.ts';
import { hashPassword, verifyPassword } from '../lib/crypto.ts';
import { badRequest, unauthorized } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';

const users = new Hono<{ Variables: { user: AuthUser } }>();

// GET /v1/me — current user info
users.get('/v1/me', (c) => {
  const user = c.get('user');
  return c.json({
    id: user.id,
    username: user.username,
    is_admin: user.is_admin,
    theme: 'system_serif',
    language: 'en_US',
    timezone: 'Europe/Amsterdam',
    entry_sorting_direction: 'desc',
    entry_sorting_order: 'published_at',
    stylesheet: '',
    google_id: '',
    openid_connect_id: '',
    entries_per_page: 100,
    keyboard_shortcuts: true,
    show_reading_time: true,
    categories_sorting_order: 'title',
    mark_read_on_view: false,
    media_playback_rate: 1,
  });
});

// PUT /v1/me/password — change the current user's password.
// Requires the current password to verify, then hashes & stores the new one.
// ADMIN_PASSWORD in the environment is only used to seed the first admin user
// on an empty database; afterwards the hash lives in the DB and must be
// updated through this route (or via a manual SQL update).
users.put('/v1/me/password', async (c) => {
  const user = c.get('user');

  let body: { current_password?: unknown; new_password?: unknown };
  try {
    body = await c.req.json();
  } catch {
    throw badRequest('Invalid JSON body');
  }

  const currentPassword = typeof body.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body.new_password === 'string' ? body.new_password : '';

  if (!currentPassword || !newPassword) {
    throw badRequest('current_password and new_password are required');
  }
  if (newPassword.length < 8) {
    throw badRequest('New password must be at least 8 characters');
  }

  const db = getDb();
  const row = db.query('SELECT password_hash FROM users WHERE id = ?')
    .get(user.id) as { password_hash: string } | null;
  if (!row) throw unauthorized('User no longer exists');

  const valid = await verifyPassword(currentPassword, row.password_hash);
  if (!valid) throw unauthorized('Current password is incorrect');

  const newHash = await hashPassword(newPassword);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, user.id]);
  log.info(`Password changed for user: ${user.username}`);

  return c.json({ ok: true });
});

export default users;

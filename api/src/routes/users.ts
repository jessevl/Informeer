import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';

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

export default users;

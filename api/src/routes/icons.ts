import { Hono } from 'hono';
import { getDb } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { notFound } from '../lib/errors.ts';

const icons = new Hono<{ Variables: { user: AuthUser } }>();

// GET /v1/icons/:id
icons.get('/v1/icons/:id', (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const db = getDb();

  const row = db.query('SELECT * FROM icons WHERE id = ?').get(id) as any;

  if (!row) {
    throw notFound('Icon not found');
  }

  return c.json({
    id: row.id,
    data: row.data,
    mime_type: row.mime_type,
  });
});

export default icons;

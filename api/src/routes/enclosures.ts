import { Hono } from 'hono';
import { getDb } from '../db/connection.ts';
import type { AuthUser } from '../middleware/auth.ts';
import { badRequest, notFound } from '../lib/errors.ts';

const enclosures = new Hono<{ Variables: { user: AuthUser } }>();

// PUT /v1/enclosures/:id — update media_progression
enclosures.put('/v1/enclosures/:id', async (c) => {
  const user = c.get('user');
  const id = parseInt(c.req.param('id'), 10);
  const body = await c.req.json<{ media_progression: number }>();

  if (body?.media_progression === undefined) {
    throw badRequest('media_progression is required');
  }

  const db = getDb();
  const existing = db.query(
    'SELECT id FROM enclosures WHERE id = ? AND user_id = ?'
  ).get(id, user.id);

  if (!existing) {
    throw notFound('Enclosure not found');
  }

  db.run(
    'UPDATE enclosures SET media_progression = ? WHERE id = ?',
    [body.media_progression, id]
  );

  return c.body(null, 204);
});

export default enclosures;

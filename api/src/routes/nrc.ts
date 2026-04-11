/**
 * NRC Routes
 *
 * On-demand PDF route for NRC newspapers (lazy PDF mode).
 * When `modules.nrc.pre_cache_pdfs` is false, PDFs are not downloaded
 * during feed fetching — they are resolved and cached on first access.
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';
import { isModuleEnabled } from '../services/settings.ts';
import { getNrcPdf, getNrcCover } from '../sources/nrc.ts';
import { forbidden, notFound } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';

const nrc = new Hono<{ Variables: { user: AuthUser } }>();

// Public cover route — registered BEFORE auth middleware in index.ts
// because <img> tags cannot send auth headers.
export const nrcCover = new Hono();
nrcCover.get('/cover/nrc/:dateId', async (c) => {
  const { dateId } = c.req.param();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
    return c.json({ error: 'Not Found' }, 404);
  }
  try {
    const filePath = await getNrcCover(dateId);
    return new Response(Bun.file(filePath), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err: any) {
    log.debug('[nrc] Cover proxy error', { dateId, error: err.message });
    return c.json({ error: 'Cover not found' }, 404);
  }
});

// GET /v1/nrc/pdf/:dateId — on-demand PDF resolution & streaming
nrc.get('/v1/nrc/pdf/:dateId', async (c) => {
  if (!isModuleEnabled('nrc')) {
    throw forbidden('NRC module is not enabled');
  }

  const { dateId } = c.req.param();

  // Validate dateId format (YYYY-MM-DD)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateId)) {
    throw notFound('Invalid date format');
  }

  try {
    const filePath = await getNrcPdf(dateId);
    const safeName = `NRC-${dateId}`;

    return new Response(Bun.file(filePath), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="${safeName}.pdf"`,
        'Cache-Control': 'public, max-age=604800', // 7 days
      },
    });
  } catch (err: any) {
    log.warn('[nrc] On-demand PDF error', { dateId, error: err.message });
    throw notFound('PDF not found or unavailable');
  }
});

export default nrc;

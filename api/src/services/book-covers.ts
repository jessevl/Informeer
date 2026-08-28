/**
 * One-time backfill of embedded EPUB cover images.
 *
 * Covers used to be fetched from an external source because the EPUB parser
 * that should have supplied them was broken — `xmlAttr` matched the
 * `<rootfiles>` wrapper instead of the `<rootfile>` element inside it, so
 * every parse threw on container.xml and the embedded cover was never
 * reached. Existing library rows therefore hold either a low-resolution
 * external thumbnail or no cover at all.
 *
 * Parsing works now, so re-extract from the EPUBs already on disk. Guarded by
 * a settings flag so this runs once rather than on every boot, and a cover is
 * only replaced when the freshly extracted one is genuinely larger.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { getDb } from '../db/connection.ts';
import { getSetting, updateSettings } from './settings.ts';
import { parseEpub, saveCoverImage } from './epub-parser.ts';
import { config } from '../config.ts';
import { log } from '../lib/logger.ts';

const BACKFILL_FLAG = 'books.covers_backfilled_v1';

interface BookRow {
  id: number;
  user_id: number;
  title: string;
  cover_path: string;
  epub_path: string;
}

/** Pixel area of an image buffer, or 0 if it can't be read. */
async function pixelArea(buf: Buffer): Promise<number> {
  try {
    const meta = await sharp(buf).metadata();
    return (meta.width ?? 0) * (meta.height ?? 0);
  } catch {
    return 0;
  }
}

export async function backfillBookCovers(): Promise<void> {
  if (getSetting<boolean>(BACKFILL_FLAG) === true) return;

  const db = getDb();
  const books = db.query(
    'SELECT id, user_id, title, cover_path, epub_path FROM books'
  ).all() as BookRow[];

  if (books.length === 0) {
    updateSettings({ [BACKFILL_FLAG]: true });
    return;
  }

  log.info(`[book-covers] Backfilling embedded covers for ${books.length} book(s)...`);
  let upgraded = 0;

  for (const book of books) {
    const epubPath = book.epub_path
      || join(config.dataDir, 'books', String(book.user_id), `${book.id}.epub`);
    if (!existsSync(epubPath)) {
      log.debug(`[book-covers] Book ${book.id}: EPUB missing at ${epubPath}`);
      continue;
    }

    try {
      const { coverImageData, coverMimeType } = await parseEpub(epubPath);
      if (!coverImageData) continue;

      // Never downgrade — keep what's on disk if it's already the larger image.
      const existing = book.cover_path && existsSync(book.cover_path)
        ? await pixelArea(readFileSync(book.cover_path))
        : 0;
      if (await pixelArea(coverImageData) <= existing) continue;

      const coversDir = join(config.dataDir, 'books', String(book.user_id), 'covers');
      const coverPath = await saveCoverImage(coverImageData, coverMimeType, coversDir, book.id);
      db.run('UPDATE books SET cover_path = ? WHERE id = ?', [coverPath, book.id]);
      upgraded++;
      log.debug(`[book-covers] Upgraded cover for book ${book.id} ("${book.title.slice(0, 40)}")`);
    } catch (err: any) {
      log.debug(`[book-covers] Book ${book.id} failed: ${err.message}`);
    }
  }

  updateSettings({ [BACKFILL_FLAG]: true });
  log.info(`[book-covers] Backfill complete — ${upgraded} cover(s) upgraded`);
}

/**
 * Books Routes
 *
 * CRUD for EPUB books, reading progress, highlights, and LibGen search/download.
 * All routes under `/v1/books/*` — require auth + books module enabled.
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';
import { getDb } from '../db/connection.ts';
import { isModuleEnabled, getSetting } from '../services/settings.ts';
import { parseEpub, saveCoverImage } from '../services/epub-parser.ts';
import { searchZLib, downloadFromZLib, getDownloadStatus, getZLibMirrors } from '../services/zlib.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { log } from '../lib/logger.ts';
import { config } from '../config.ts';
import { existsSync, mkdirSync, unlinkSync, statSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

const books = new Hono<{ Variables: { user: AuthUser } }>();

/** Guard: require books module enabled */
function requireModule() {
  if (!isModuleEnabled('books')) {
    throw forbidden('Books module is not enabled');
  }
}

// ---------------------------------------------------------------------------
// Helper: book directory paths
// ---------------------------------------------------------------------------

function bookDir(userId: number): string {
  return join(config.dataDir, 'books', String(userId));
}

function bookEpubPath(userId: number, bookId: number): string {
  return join(bookDir(userId), `${bookId}.epub`);
}

function bookCoverDir(userId: number): string {
  return join(bookDir(userId), 'covers');
}

// ---------------------------------------------------------------------------
// Format helpers
// ---------------------------------------------------------------------------

interface BookRow {
  id: number;
  user_id: number;
  title: string;
  author: string;
  publisher: string;
  language: string;
  description: string;
  cover_path: string;
  epub_path: string;
  file_size: number;
  isbn: string;
  tags: string;
  metadata: string;
  created_at: string;
  updated_at: string;
}

function formatBook(row: BookRow) {
  return {
    id: row.id,
    user_id: row.user_id,
    title: row.title,
    author: row.author,
    publisher: row.publisher,
    language: row.language,
    description: row.description,
    cover_path: row.cover_path,
    epub_path: row.epub_path,
    file_size: row.file_size,
    isbn: row.isbn,
    tags: JSON.parse(row.tags || '[]'),
    metadata: JSON.parse(row.metadata || '{}'),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

// ===========================================================================
// Book CRUD
// ===========================================================================

// GET /v1/books — List books (with pagination and search)
books.get('/v1/books', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();

  const search = c.req.query('search');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 200);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  let query: string;
  let params: any[];

  if (search) {
    query = `
      SELECT * FROM books
      WHERE user_id = ? AND (title LIKE ? OR author LIKE ?)
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;
    const like = `%${search}%`;
    params = [user.id, like, like, limit, offset];
  } else {
    query = `
      SELECT * FROM books
      WHERE user_id = ?
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `;
    params = [user.id, limit, offset];
  }

  const rows = db.query(query).all(...params) as BookRow[];
  const total = db.query(
    'SELECT COUNT(*) as count FROM books WHERE user_id = ?'
  ).get(user.id) as { count: number };

  return c.json({
    total: total.count,
    books: rows.map(formatBook),
  });
});

// GET /v1/books/:id — Get single book metadata
books.get('/v1/books/:id', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  const row = db.query(
    'SELECT * FROM books WHERE id = ? AND user_id = ?'
  ).get(bookId, user.id) as BookRow | null;

  if (!row) throw notFound('Book not found');
  return c.json(formatBook(row));
});

// POST /v1/books — Upload EPUB (multipart/form-data)
books.post('/v1/books', async (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();

  const contentType = c.req.header('content-type') || '';

  if (contentType.startsWith('multipart/form-data')) {
    // File upload
    const formData = await c.req.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      throw badRequest('Missing file in form data');
    }

    // Validate file type
    if (!file.name.endsWith('.epub')) {
      throw badRequest('Only EPUB files are supported');
    }

    // Validate file size (100MB max)
    if (file.size > 100 * 1024 * 1024) {
      throw badRequest('File too large (max 100MB)');
    }

    const fileData = Buffer.from(await file.arrayBuffer());

    return await processAndStoreEpub(db, user, fileData, file.name, c);
  } else {
    // JSON body (for LibGen downloads — book data already available)
    throw badRequest('Expected multipart/form-data with an EPUB file');
  }
});

// PUT /v1/books/:id — Update book metadata (title, author)
books.put('/v1/books/:id', async (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  const row = db.query(
    'SELECT * FROM books WHERE id = ? AND user_id = ?'
  ).get(bookId, user.id) as BookRow | null;

  if (!row) throw notFound('Book not found');

  const body = await c.req.json<{ title?: string; author?: string }>();

  const updates: string[] = [];
  const values: (string | number)[] = [];

  if (body.title !== undefined && body.title.trim()) {
    updates.push('title = ?');
    values.push(body.title.trim());
  }
  if (body.author !== undefined) {
    updates.push('author = ?');
    values.push(body.author.trim());
  }

  if (updates.length === 0) {
    throw badRequest('No fields to update');
  }

  updates.push("updated_at = datetime('now')");
  values.push(bookId, user.id);

  db.run(
    `UPDATE books SET ${updates.join(', ')} WHERE id = ? AND user_id = ?`,
    values,
  );

  const updated = db.query('SELECT * FROM books WHERE id = ?').get(bookId) as BookRow;
  return c.json(formatBook(updated));
});

// DELETE /v1/books/:id — Delete book + files
books.delete('/v1/books/:id', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  const row = db.query(
    'SELECT * FROM books WHERE id = ? AND user_id = ?'
  ).get(bookId, user.id) as BookRow | null;

  if (!row) throw notFound('Book not found');

  // Delete files
  const epubPath = bookEpubPath(user.id, bookId);
  if (existsSync(epubPath)) {
    try { unlinkSync(epubPath); } catch { /* ignore */ }
  }
  if (row.cover_path && existsSync(row.cover_path)) {
    try { unlinkSync(row.cover_path); } catch { /* ignore */ }
  }

  // Delete DB records (cascades to progress + highlights)
  db.run('DELETE FROM book_highlights WHERE book_id = ? AND user_id = ?', [bookId, user.id]);
  db.run('DELETE FROM book_progress WHERE book_id = ? AND user_id = ?', [bookId, user.id]);
  db.run('DELETE FROM books WHERE id = ? AND user_id = ?', [bookId, user.id]);

  return c.json({ ok: true });
});

// GET /v1/books/:id/file — Stream EPUB file
books.get('/v1/books/:id/file', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  const row = db.query(
    'SELECT id, user_id, title FROM books WHERE id = ? AND user_id = ?'
  ).get(bookId, user.id) as { id: number; user_id: number; title: string } | null;

  if (!row) throw notFound('Book not found');

  const epubPath = bookEpubPath(user.id, bookId);
  if (!existsSync(epubPath)) throw notFound('EPUB file not found');

  const safeName = row.title.replace(/[^\x20-\x7E]/g, '-').replace(/["/\\:*?<>|]/g, '-');

  return new Response(Bun.file(epubPath), {
    headers: {
      'Content-Type': 'application/epub+zip',
      'Content-Disposition': `inline; filename="${safeName}.epub"`,
      'Cache-Control': 'private, max-age=86400',
    },
  });
});

// GET /v1/books/:id/cover — Cover image
books.get('/v1/books/:id/cover', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  const row = db.query(
    'SELECT cover_path FROM books WHERE id = ? AND user_id = ?'
  ).get(bookId, user.id) as { cover_path: string } | null;

  if (!row?.cover_path || !existsSync(row.cover_path)) {
    throw notFound('Cover not found');
  }

  const mime = row.cover_path.endsWith('.png') ? 'image/png' : 'image/jpeg';

  return new Response(Bun.file(row.cover_path), {
    headers: {
      'Content-Type': mime,
      'Cache-Control': 'no-cache',
    },
  });
});

// ===========================================================================
// Reading Progress
// ===========================================================================

// GET /v1/books/:id/progress
books.get('/v1/books/:id/progress', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  // Verify book ownership
  const book = db.query('SELECT id FROM books WHERE id = ? AND user_id = ?').get(bookId, user.id);
  if (!book) throw notFound('Book not found');

  const progress = db.query(
    'SELECT * FROM book_progress WHERE user_id = ? AND book_id = ?'
  ).get(user.id, bookId) as any;

  if (!progress) {
    return c.json({ cfi: '', percentage: 0, chapter: '', updated_at: null });
  }

  return c.json({
    cfi: progress.cfi,
    percentage: progress.percentage,
    chapter: progress.chapter,
    updated_at: progress.updated_at,
  });
});

// PUT /v1/books/:id/progress
books.put('/v1/books/:id/progress', async (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  // Verify book ownership
  const book = db.query('SELECT id FROM books WHERE id = ? AND user_id = ?').get(bookId, user.id);
  if (!book) throw notFound('Book not found');

  const body = await c.req.json<{
    cfi?: string;
    percentage?: number;
    chapter?: string;
  }>();

  const existing = db.query(
    'SELECT cfi, percentage, chapter FROM book_progress WHERE user_id = ? AND book_id = ?'
  ).get(user.id, bookId) as { cfi: string; percentage: number; chapter: string } | undefined;

  const normalizedPercentage = typeof body.percentage === 'number'
    ? Math.min(Math.max(body.percentage, 0), 1) >= 0.995
      ? 1
      : Math.min(Math.max(body.percentage, 0), 1)
    : undefined;

  const nextCfi = body.cfi ?? existing?.cfi ?? '';
  const nextPercentage = normalizedPercentage ?? existing?.percentage ?? 0;
  const nextChapter = body.chapter ?? existing?.chapter ?? '';

  db.run(`
    INSERT INTO book_progress (user_id, book_id, cfi, percentage, chapter, updated_at)
    VALUES (?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      cfi = excluded.cfi,
      percentage = excluded.percentage,
      chapter = excluded.chapter,
      updated_at = datetime('now')
  `, [user.id, bookId, nextCfi, nextPercentage, nextChapter]);

  // Update book's updated_at timestamp
  db.run("UPDATE books SET updated_at = datetime('now') WHERE id = ?", [bookId]);

  return c.json({ ok: true });
});

// ===========================================================================
// Highlights
// ===========================================================================

// GET /v1/books/:id/highlights
books.get('/v1/books/:id/highlights', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  const book = db.query('SELECT id FROM books WHERE id = ? AND user_id = ?').get(bookId, user.id);
  if (!book) throw notFound('Book not found');

  const rows = db.query(
    'SELECT * FROM book_highlights WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC'
  ).all(user.id, bookId) as any[];

  return c.json(rows.map(r => ({
    id: r.id,
    book_id: r.book_id,
    cfi_range: r.cfi_range,
    text: r.text,
    note: r.note,
    color: r.color,
    created_at: r.created_at,
  })));
});

// POST /v1/books/:id/highlights
books.post('/v1/books/:id/highlights', async (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);

  const book = db.query('SELECT id FROM books WHERE id = ? AND user_id = ?').get(bookId, user.id);
  if (!book) throw notFound('Book not found');

  const body = await c.req.json<{
    cfi_range: string;
    text: string;
    note?: string;
    color?: string;
  }>();

  if (!body.cfi_range || !body.text) {
    throw badRequest('cfi_range and text are required');
  }

  db.run(`
    INSERT INTO book_highlights (user_id, book_id, cfi_range, text, note, color)
    VALUES (?, ?, ?, ?, ?, ?)
  `, [user.id, bookId, body.cfi_range, body.text, body.note || '', body.color || 'yellow']);

  const highlight = db.query(
    'SELECT * FROM book_highlights WHERE user_id = ? AND book_id = ? ORDER BY id DESC LIMIT 1'
  ).get(user.id, bookId) as any;

  return c.json({
    id: highlight.id,
    book_id: highlight.book_id,
    cfi_range: highlight.cfi_range,
    text: highlight.text,
    note: highlight.note,
    color: highlight.color,
    created_at: highlight.created_at,
  }, 201);
});

// PUT /v1/books/:id/highlights/:hid
books.put('/v1/books/:id/highlights/:hid', async (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);
  const hid = parseInt(c.req.param('hid'), 10);

  const existing = db.query(
    'SELECT id FROM book_highlights WHERE id = ? AND user_id = ? AND book_id = ?'
  ).get(hid, user.id, bookId);

  if (!existing) throw notFound('Highlight not found');

  const body = await c.req.json<{
    note?: string;
    color?: string;
  }>();

  if (body.note !== undefined) {
    db.run('UPDATE book_highlights SET note = ? WHERE id = ?', [body.note, hid]);
  }
  if (body.color !== undefined) {
    db.run('UPDATE book_highlights SET color = ? WHERE id = ?', [body.color, hid]);
  }

  const updated = db.query('SELECT * FROM book_highlights WHERE id = ?').get(hid) as any;
  return c.json({
    id: updated.id,
    book_id: updated.book_id,
    cfi_range: updated.cfi_range,
    text: updated.text,
    note: updated.note,
    color: updated.color,
    created_at: updated.created_at,
  });
});

// DELETE /v1/books/:id/highlights/:hid
books.delete('/v1/books/:id/highlights/:hid', (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();
  const bookId = parseInt(c.req.param('id'), 10);
  const hid = parseInt(c.req.param('hid'), 10);

  const existing = db.query(
    'SELECT id FROM book_highlights WHERE id = ? AND user_id = ? AND book_id = ?'
  ).get(hid, user.id, bookId);

  if (!existing) throw notFound('Highlight not found');

  db.run('DELETE FROM book_highlights WHERE id = ?', [hid]);
  return c.json({ ok: true });
});

// Z-Library cover proxy moved to public endpoint — see index.ts /cover-proxy

// ===========================================================================
// Z-Library Search & Download
// ===========================================================================

// GET /v1/books/zlib/search?q=...&page=1
books.get('/v1/books/zlib/search', async (c) => {
  requireModule();

  const zlibEnabled = getSetting<boolean>('modules.books.zlib_enabled') !== false;
  if (!zlibEnabled) {
    throw forbidden('Z-Library search is not enabled');
  }

  const query = c.req.query('q');
  const page = parseInt(c.req.query('page') || '1', 10);

  if (!query) {
    throw badRequest('Missing query parameter: q');
  }

  const results = await searchZLib(query, page);
  return c.json(results);
});

// GET /v1/books/zlib/status — Download limit status
books.get('/v1/books/zlib/status', (c) => {
  requireModule();
  const status = getDownloadStatus();
  return c.json(status);
});

// GET /v1/books/zlib/mirrors — Available mirror list
books.get('/v1/books/zlib/mirrors', (c) => {
  requireModule();
  return c.json({ mirrors: getZLibMirrors() });
});

// POST /v1/books/zlib/download — Download a book from Z-Library and add to library
books.post('/v1/books/zlib/download', async (c) => {
  requireModule();
  const user = c.get('user');
  const db = getDb();

  const zlibEnabled = getSetting<boolean>('modules.books.zlib_enabled') !== false;
  if (!zlibEnabled) {
    throw forbidden('Z-Library search is not enabled');
  }

  const body = await c.req.json<{
    bookId: string;
    downloadUrl: string;
    title?: string;
    author?: string;
    coverUrl?: string;
  }>();

  if (!body.bookId || !body.downloadUrl) {
    throw badRequest('bookId and downloadUrl are required');
  }

  log.info(`[books] Z-Library download requested`, { bookId: body.bookId, title: body.title });

  // Download from Z-Library
  const { data, filename } = await downloadFromZLib(
    body.bookId,
    body.downloadUrl,
    body.title || 'Unknown',
  );

  try {
    return await processAndStoreEpub(db, user, data, filename, c, {
      title: body.title,
      author: body.author,
      coverUrl: body.coverUrl,
    });
  } catch (err) {
    throw err;
  }
});

// ===========================================================================
// Shared: process & store EPUB
// ===========================================================================

async function processAndStoreEpub(
  db: ReturnType<typeof getDb>,
  user: AuthUser,
  fileData: Buffer,
  filename: string,
  c: any,
  overrides?: { title?: string; author?: string; coverUrl?: string },
) {
  // Save EPUB to temp location first for parsing
  const tempDir = join(config.dataDir, 'books', 'tmp');
  mkdirSync(tempDir, { recursive: true });
  const tempPath = join(tempDir, `${Date.now()}.epub`);
  writeFileSync(tempPath, fileData);

  let metadata;
  let coverData: Buffer | null = null;
  let coverMimeType = '';

  try {
    const parsed = await parseEpub(tempPath);
    metadata = parsed.metadata;
    coverData = parsed.coverImageData;
    coverMimeType = parsed.coverMimeType;
  } catch (err: any) {
    log.warn(`[books] Failed to parse EPUB metadata: ${err.message}`);
    // Use filename as title fallback
    metadata = {
      title: overrides?.title || filename.replace(/\.epub$/i, ''),
      author: overrides?.author || '',
      publisher: '',
      language: '',
      description: '',
      isbn: '',
      tags: [],
      extra: {},
    };
  }

  // Apply overrides (from Z-Library metadata which may be better)
  if (overrides?.title) metadata.title = overrides.title;
  if (overrides?.author) metadata.author = overrides.author;

  // If no cover was extracted from the EPUB, try downloading from the provided URL (e.g. Z-Library)
  // Also prefer Z-Library covers when available — EPUB-embedded covers are often tiny thumbnails
  if (overrides?.coverUrl) {
    try {
      log.debug(`[books] Downloading cover from: ${overrides.coverUrl}`);
      const coverResponse = await fetch(overrides.coverUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(15_000),
      });
      if (coverResponse.ok) {
        const ab = await coverResponse.arrayBuffer();
        const externalCover = Buffer.from(ab);
        const ct = coverResponse.headers.get('content-type') || '';
        const externalMime = ct.includes('png') ? 'image/png'
          : ct.includes('webp') ? 'image/webp'
          : 'image/jpeg';
        // Use external cover if it's larger than the embedded one (or if there's no embedded one)
        if (!coverData || externalCover.length > coverData.length) {
          coverData = externalCover;
          coverMimeType = externalMime;
          log.debug(`[books] Using external cover (${externalCover.length} bytes) over embedded (${coverData ? coverData.length : 0} bytes)`);
        }
      }
    } catch (err: any) {
      log.debug(`[books] Failed to download cover: ${err.message}`);
    }
  }

  // Insert book record
  db.run(`
    INSERT INTO books (user_id, title, author, publisher, language, description, isbn, tags, metadata, file_size, epub_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `, [
    user.id,
    metadata.title,
    metadata.author,
    metadata.publisher,
    metadata.language,
    metadata.description,
    metadata.isbn,
    JSON.stringify(metadata.tags),
    JSON.stringify(metadata.extra),
    fileData.length,
  ]);

  const book = db.query(
    'SELECT * FROM books WHERE user_id = ? ORDER BY id DESC LIMIT 1'
  ).get(user.id) as BookRow;

  // Move EPUB to permanent location
  const userDir = bookDir(user.id);
  mkdirSync(userDir, { recursive: true });
  const epubPath = bookEpubPath(user.id, book.id);
  writeFileSync(epubPath, fileData);
  db.run('UPDATE books SET epub_path = ? WHERE id = ?', [epubPath, book.id]);

  // Save cover image
  let coverPath = '';
  if (coverData) {
    const coversDir = bookCoverDir(user.id);
    coverPath = await saveCoverImage(coverData, coverMimeType, coversDir, book.id);
    db.run('UPDATE books SET cover_path = ? WHERE id = ?', [coverPath, book.id]);
  }

  // Clean up temp
  if (existsSync(tempPath)) {
    try { unlinkSync(tempPath); } catch { /* ignore */ }
  }

  // Fetch the final book record
  const finalBook = db.query('SELECT * FROM books WHERE id = ?').get(book.id) as BookRow;

  return c.json(formatBook(finalBook), 201);
}

export default books;

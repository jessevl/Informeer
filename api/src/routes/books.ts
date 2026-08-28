/**
 * Books Routes
 *
 * CRUD for EPUB books, reading progress, and highlights.
 * All routes under `/v1/books/*` — require auth + books module enabled.
 */

import { Hono } from 'hono';
import type { AuthUser } from '../middleware/auth.ts';
import { getDb } from '../db/connection.ts';
import { isModuleEnabled } from '../services/settings.ts';
import { parseEpub, saveCoverImage } from '../services/epub-parser.ts';
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
  // Only present when the row came from a query joined against book_progress
  progress_cfi?: string | null;
  progress_percentage?: number | null;
  progress_chapter?: string | null;
  progress_updated_at?: string | null;
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
    // Included so a fresh device/browser knows a book's progress (and
    // whether it's finished) without first having to open it in the
    // reader — the reader's own progress endpoint remains the source of
    // truth for the CFI while actively reading.
    reading_progress: row.progress_updated_at != null ? {
      cfi: row.progress_cfi || '',
      percentage: row.progress_percentage || 0,
      chapter: row.progress_chapter || '',
      updated_at: row.progress_updated_at,
    } : null,
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

  const progressJoin = `
    LEFT JOIN book_progress
      ON book_progress.book_id = books.id AND book_progress.user_id = books.user_id
  `;
  const progressColumns = `
    books.*,
    book_progress.cfi AS progress_cfi,
    book_progress.percentage AS progress_percentage,
    book_progress.chapter AS progress_chapter,
    book_progress.updated_at AS progress_updated_at
  `;

  if (search) {
    query = `
      SELECT ${progressColumns} FROM books
      ${progressJoin}
      WHERE books.user_id = ? AND (books.title LIKE ? OR books.author LIKE ?)
      ORDER BY books.updated_at DESC
      LIMIT ? OFFSET ?
    `;
    const like = `%${search}%`;
    params = [user.id, like, like, limit, offset];
  } else {
    query = `
      SELECT ${progressColumns} FROM books
      ${progressJoin}
      WHERE books.user_id = ?
      ORDER BY books.updated_at DESC
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

  // Covers are normally re-encoded to JPEG on save, but the fallback path
  // keeps the original format when re-encoding fails.
  const ext = row.cover_path.slice(row.cover_path.lastIndexOf('.') + 1).toLowerCase();
  const mime = ext === 'png' ? 'image/png'
    : ext === 'gif' ? 'image/gif'
    : ext === 'webp' ? 'image/webp'
    : 'image/jpeg';

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

// ===========================================================================
// Shared: process & store EPUB
// ===========================================================================

async function processAndStoreEpub(
  db: ReturnType<typeof getDb>,
  user: AuthUser,
  fileData: Buffer,
  filename: string,
  c: any,
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
    // Fall back to the filename so a malformed EPUB still lands in the library
    metadata = {
      title: filename.replace(/\.epub$/i, ''),
      author: '',
      publisher: '',
      language: '',
      description: '',
      isbn: '',
      tags: [],
      extra: {},
    };
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

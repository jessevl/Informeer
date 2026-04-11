/**
 * NRC Content Source
 *
 * Authenticates with NRC.nl, scrapes the daily newspaper, downloads
 * and caches PDFs & covers, then returns NewEntry[] directly.
 * No RSS proxy indirection — writes entries to the DB like any other source.
 *
 * Two-step approach:
 * 1. Fetch /krant/{YYYY}/{MM}/{DD}/downloads/ → extract data-de-package-url + cover
 * 2. Fetch JSON package API → get PDF download URL
 */

import { parseHTML } from 'linkedom';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { config } from '../config.ts';
import { getSetting } from '../services/settings.ts';
import { encrypt, decrypt } from '../lib/crypto.ts';
import { throttledFetch, BROWSER_USER_AGENT } from '../lib/http.ts';
import { getDb } from '../db/connection.ts';
import { log } from '../lib/logger.ts';
import type { ContentSource, Feed, FetchResult, NewEntry } from './types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NRC_BASE = 'https://www.nrc.nl';
const SESSION_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// In-memory cache of original PDF URLs for on-demand resolution
const pdfUrlCache = new Map<string, string>();

const DUTCH_MONTHS = [
  'januari', 'februari', 'maart', 'april', 'mei', 'juni',
  'juli', 'augustus', 'september', 'oktober', 'november', 'december',
];

// ---------------------------------------------------------------------------
// Session management
// ---------------------------------------------------------------------------

interface NrcSession {
  cookies: string;
  obtainedAt: number;
  email: string;
}

let currentSession: NrcSession | null = null;

/** Merge Set-Cookie headers into existing cookie jar */
function mergeSetCookies(existing: string, response: Response): string {
  const map = new Map<string, string>();
  for (const pair of existing.split(';')) {
    const [key, ...rest] = pair.split('=');
    if (key?.trim()) map.set(key.trim(), rest.join('=').trim());
  }
  const raw = response.headers.getSetCookie?.() ?? [];
  for (const header of raw) {
    const cookie = header.split(';')[0];
    const [key, ...rest] = cookie.split('=');
    if (key?.trim()) map.set(key.trim(), rest.join('=').trim());
  }
  return Array.from(map.entries())
    .map(([k, v]) => (v ? `${k}=${v}` : k))
    .join('; ');
}

/** Perform full CAS login and return session cookies */
async function performLogin(email: string, password: string): Promise<string> {
  const serviceUrl = 'https://www.nrc.nl/login/subscriber/';
  const loginPageUrl = `https://login.nrc.nl/login?service=${encodeURIComponent(serviceUrl)}`;

  log.debug('[nrc] Fetching login page...');
  const loginPageRes = await fetch(loginPageUrl, {
    headers: { 'User-Agent': BROWSER_USER_AGENT },
    redirect: 'manual',
  });

  let cookies = mergeSetCookies('', loginPageRes);
  const html = await loginPageRes.text();
  const { document } = parseHTML(html);

  // Extract form action and hidden fields
  const form = document.querySelector('form');
  const rawAction = form?.getAttribute('action') || loginPageUrl;
  const loginPageQuery = new URL(loginPageUrl).search;
  const actionBase = rawAction.startsWith('http') ? rawAction : `https://login.nrc.nl${rawAction}`;
  const actionUrl = actionBase.includes('?') ? actionBase : `${actionBase}${loginPageQuery}`;

  const hiddenFields: Record<string, string> = {};
  document.querySelectorAll('input[type="hidden"]').forEach((el: any) => {
    const name = el.getAttribute('name');
    const value = el.getAttribute('value') || '';
    if (name) hiddenFields[name] = value;
  });

  const emailField =
    document.querySelector('input[type="email"]')?.getAttribute('name') ||
    document.querySelector('input[name="email"]')?.getAttribute('name') ||
    document.querySelector('input[name="username"]')?.getAttribute('name') ||
    'username';
  const passwordField =
    document.querySelector('input[type="password"]')?.getAttribute('name') || 'password';

  log.debug('[nrc] Submitting credentials...');
  const body = new URLSearchParams({ ...hiddenFields, [emailField]: email, [passwordField]: password });

  let response = await fetch(actionUrl, {
    method: 'POST',
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cookie': cookies,
      'Referer': loginPageUrl,
    },
    body,
    redirect: 'manual',
  });
  cookies = mergeSetCookies(cookies, response);

  // Follow redirect chain (subscriber flow has ~4 hops)
  let redirects = 0;
  while (response.status >= 300 && response.status < 400 && redirects < 15) {
    const location = response.headers.get('location');
    if (!location) break;
    const nextUrl = location.startsWith('http')
      ? location
      : new URL(location, response.url || actionUrl).href;

    log.debug(`[nrc] Following redirect (${response.status})`, { url: nextUrl.substring(0, 80) });
    response = await fetch(nextUrl, {
      headers: { 'User-Agent': BROWSER_USER_AGENT, 'Cookie': cookies },
      redirect: 'manual',
    });
    cookies = mergeSetCookies(cookies, response);
    redirects++;
  }

  if (!cookies.includes('nrcnl_session_id')) {
    log.warn('[nrc] nrcnl_session_id cookie not found — PDF downloads may fail');
  }

  log.info('[nrc] Login complete', { has_session_id: cookies.includes('nrcnl_session_id') });
  return cookies;
}

/** Get valid session, logging in if necessary */
async function getSession(): Promise<NrcSession> {
  const email = getSetting<string>('modules.nrc.email');
  const rawPassword = getSetting<string>('modules.nrc.password');

  if (!email || !rawPassword) {
    throw new Error('NRC email and password must be configured in settings');
  }

  if (currentSession && currentSession.email === email && Date.now() - currentSession.obtainedAt < SESSION_TTL_MS) {
    return currentSession;
  }

  log.info('[nrc] Session expired or missing, logging in...');
  const cookies = await performLogin(email, rawPassword);
  currentSession = { cookies, obtainedAt: Date.now(), email };
  return currentSession;
}

function invalidateSession(): void {
  currentSession = null;
}

/** Authenticated fetch with auto-retry on 401/403 */
async function authenticatedFetch(url: string, retried = false): Promise<Response> {
  const session = await getSession();
  const response = await throttledFetch(url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, 'Cookie': session.cookies },
  });
  if ((response.status === 401 || response.status === 403) && !retried) {
    log.info('[nrc] Auth failed, refreshing session...');
    invalidateSession();
    return authenticatedFetch(url, true);
  }
  return response;
}

// ---------------------------------------------------------------------------
// Scraper
// ---------------------------------------------------------------------------

function formatDateId(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatTitle(date: Date): string {
  return `NRC – ${date.getDate()} ${DUTCH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function getDownloadPageUrl(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${NRC_BASE}/krant/${y}/${m}/${d}/downloads/`;
}

interface NrcPackage {
  download?: { pdf_full?: string };
  assets?: { pdf_full?: string };
  pages?: Array<{
    number: number;
    image_url?: string;
    fullscreen_url?: string;
    image_variations?: Record<string, { url?: string }>;
  }>;
  cover_url?: string;
  thumbnail_url?: string;
}

async function fetchIssueForDate(date: Date): Promise<NewEntry | null> {
  const dateId = formatDateId(date);
  const pageUrl = getDownloadPageUrl(date);

  log.debug('[nrc] Fetching downloads page', { date: dateId });
  const pageRes = await authenticatedFetch(pageUrl);
  if (!pageRes.ok) {
    throw new Error(`NRC downloads page returned ${pageRes.status}`);
  }

  const html = await pageRes.text();
  const { document } = parseHTML(html);

  // Extract package URL
  let packageUrl: string | null = null;
  const els = document.querySelectorAll('[data-de-package-url]');
  for (const el of els) {
    const val = (el as any).getAttribute('data-de-package-url');
    if (val) { packageUrl = val; break; }
  }
  if (!packageUrl) {
    log.warn('[nrc] No data-de-package-url found', { date: dateId });
    return null;
  }

  // Fetch JSON package API
  const apiUrl = packageUrl.startsWith('http') ? packageUrl : `${NRC_BASE}${packageUrl}`;
  const apiRes = await authenticatedFetch(apiUrl);
  if (!apiRes.ok) {
    throw new Error(`NRC package API returned ${apiRes.status}`);
  }
  const pkg = await apiRes.json() as NrcPackage;

  const pdfPath = pkg.download?.pdf_full || pkg.assets?.pdf_full;
  if (!pdfPath) {
    log.warn('[nrc] No PDF found in package', { date: dateId });
    return null;
  }

  const originalPdfUrl = pdfPath.startsWith('http') ? pdfPath : `${NRC_BASE}${pdfPath}`;

  // Cache the original PDF URL for on-demand resolution
  pdfUrlCache.set(dateId, originalPdfUrl);

  // Check if PDFs should be eagerly cached or lazy (on-demand)
  const preCachePdfs = getSetting<boolean>('modules.nrc.pre_cache_pdfs') !== false;

  // Resolve cover — prefer front page image variations over og:image
  const frontPage = pkg.pages?.find(p => p.number === 1) || pkg.pages?.[0];
  const variations = frontPage?.image_variations;
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
  const originalCoverUrl =
    variations?.large?.url ||
    variations?.xlarge?.url ||
    variations?.medium?.url ||
    frontPage?.fullscreen_url ||
    frontPage?.image_url ||
    pkg.cover_url ||
    pkg.thumbnail_url ||
    ogImage;

  // Download and cache PDF + cover
  const cacheDir = join(config.dataDir, 'cache');
  const pdfDir = join(cacheDir, 'pdfs');
  const coverDir = join(cacheDir, 'covers');

  const pdfPath_ = join(pdfDir, `nrc-${dateId}.pdf`);
  const coverPath = join(coverDir, `nrc-${dateId}.jpg`);

  if (preCachePdfs && !existsSync(pdfPath_)) {
    log.debug('[nrc] Downloading PDF', { date: dateId });
    const pdfRes = await authenticatedFetch(originalPdfUrl);
    if (!pdfRes.ok) throw new Error(`Failed to download NRC PDF: ${pdfRes.status}`);
    const buffer = Buffer.from(await pdfRes.arrayBuffer());
    if (buffer.length > 4) {
      const header = buffer.subarray(0, 5).toString('ascii');
      if (!header.startsWith('%PDF')) {
        throw new Error('Downloaded file is not a PDF');
      }
    }
    writeFileSync(pdfPath_, buffer);
    log.info('[nrc] Cached PDF', { date: dateId, size_mb: (buffer.length / 1024 / 1024).toFixed(1) });
  }

  if (originalCoverUrl && !existsSync(coverPath)) {
    try {
      const coverRes = await authenticatedFetch(originalCoverUrl);
      if (coverRes.ok) {
        writeFileSync(coverPath, Buffer.from(await coverRes.arrayBuffer()));
        log.debug('[nrc] Cached cover', { date: dateId });
      }
    } catch (err: any) {
      log.warn('[nrc] Failed to cache cover', { date: dateId, error: err.message });
    }
  }

  // Build entry — always use on-demand API routes so entries survive cache wipes
  const title = formatTitle(date);
  const coverHtml = `<img src="/cover/nrc/${dateId}" alt="${title}" data-magazine-cover="true" style="max-width:100%;border-radius:8px;" />`;

  const pdfUrl = `/v1/nrc/pdf/${dateId}`;

  const content = [
    '<div class="magazine-entry">',
    coverHtml,
    `<p>Volledige krant</p>`,
    `<p><a href="${pdfUrl}" data-magazine-pdf="true" type="application/pdf">📥 Download PDF</a></p>`,
    `<p><small>Source: <a href="${pageUrl}">${pageUrl}</a></small></p>`,
    '</div>',
  ].join('\n');

  return {
    hash: `nrc-${dateId}`,
    title,
    url: pageUrl,
    author: 'NRC',
    content,
    published_at: date.toISOString(),
    image_url: `/cover/nrc/${dateId}`,
    enclosures: [{
      url: pdfUrl,
      mime_type: 'application/pdf',
      size: 0,
    }],
  };
}

// ---------------------------------------------------------------------------
// ContentSource implementation
// ---------------------------------------------------------------------------

export class NRCSource implements ContentSource {
  readonly type = 'nrc';

  async fetch(feed: Feed, signal: AbortSignal): Promise<FetchResult> {
    const feedDays = getSetting<number>('modules.nrc.feed_days') ?? 14;
    const entries: NewEntry[] = [];
    const today = new Date();

    // Pre-fetch existing complete entries to avoid expensive HTTP requests
    // An entry is "complete" when it exists in DB with a cover image AND
    // (if pre_cache_pdfs is on) the PDF is cached on disk
    const preCachePdfs = getSetting<boolean>('modules.nrc.pre_cache_pdfs') !== false;
    const db = getDb();
    const existingRows = db.query(
      `SELECT hash, image_url FROM entries WHERE feed_id = ? AND hash LIKE 'nrc-%'`
    ).all(feed.id) as Array<{ hash: string; image_url: string }>;

    const pdfDir = join(config.dataDir, 'cache', 'pdfs');
    const coverDir = join(config.dataDir, 'cache', 'covers');
    const completeHashes = new Set<string>();
    for (const row of existingRows) {
      const dateId = row.hash.replace('nrc-', '');
      // Verify BOTH files actually exist on disk (not just DB references)
      const hasCover = existsSync(join(coverDir, `nrc-${dateId}.jpg`));
      // When pre_cache_pdfs is off, we don't require the PDF to be on disk
      const hasPdf = !preCachePdfs || existsSync(join(pdfDir, `nrc-${dateId}.pdf`));
      if (hasCover && hasPdf) {
        completeHashes.add(row.hash);
      }
    }

    let skipped = 0;
    for (let i = 0; i < feedDays; i++) {
      if (signal.aborted) break;

      const date = new Date(today);
      date.setDate(today.getDate() - i);

      // Skip Sundays (NRC has no Sunday edition)
      if (date.getDay() === 0) continue;

      const hash = `nrc-${formatDateId(date)}`;

      // Skip dates where we already have complete data (cover + PDF)
      if (completeHashes.has(hash)) {
        skipped++;
        continue;
      }

      try {
        const entry = await fetchIssueForDate(date);
        if (entry) entries.push(entry);
      } catch (err: any) {
        log.warn('[nrc] Failed to fetch issue', { date: formatDateId(date), error: err.message });
      }
    }

    if (skipped > 0) {
      log.info('[nrc] Skipped already-complete issues', { skipped, total: feedDays });
    }

    // Repair existing entries that are missing their cover image.
    // This handles: cover not available on first fetch, cover file deleted,
    // or cover download failed. Actually re-fetches from NRC if needed.
    await this.repairMissingCovers(feed);

    // Clean up entries + cache files beyond the feed_days limit
    this.cleanupOldIssues(feed, feedDays);

    return { entries };
  }

  /** Re-attempt cover download for entries that were stored without one, and migrate stale URLs. */
  private async repairMissingCovers(feed: Feed): Promise<void> {
    const db = getDb();
    const coverDir = join(config.dataDir, 'cache', 'covers');

    // Find NRC entries that need repair:
    //  - No image_url in DB
    //  - image_url set but file missing from disk (stale ref after cache cleanup)
    //  - Content was corrupted (e.g. overwritten by readability — lacks magazine-entry wrapper)
    //  - Content still uses stale /files/cache/ static paths instead of on-demand routes
    const allNrcRows = db.query(
      `SELECT id, hash, image_url, content FROM entries
       WHERE feed_id = ? AND hash LIKE 'nrc-%'
       ORDER BY published_at DESC LIMIT 30`
    ).all(feed.id) as Array<{ id: number; hash: string; image_url: string; content: string }>;

    const rows = allNrcRows.filter(row => {
      const dateId = row.hash.replace('nrc-', '');
      if (!row.image_url) return true; // no cover in DB
      if (!existsSync(join(coverDir, `nrc-${dateId}.jpg`))) return true; // file missing from disk
      if (!row.content?.includes('<div class="magazine-entry">')) return true; // corrupted content
      if (row.content?.includes('/files/cache/')) return true; // stale static file paths
      return false;
    }).slice(0, 5);

    for (const row of rows) {
      const dateId = row.hash.replace('nrc-', '');
      const coverPath = join(coverDir, `nrc-${dateId}.jpg`);

      // If file not on disk, try to fetch it from NRC
      if (!existsSync(coverPath)) {
        try {
          const coverUrl = await this.resolveCoverUrl(dateId);
          if (coverUrl) {
            const coverRes = await authenticatedFetch(coverUrl);
            if (coverRes.ok) {
              const buf = Buffer.from(await coverRes.arrayBuffer());
              if (buf.length > 100) {
                writeFileSync(coverPath, buf);
                log.info('[nrc] Re-fetched cover for entry', { entry_id: row.id, date: dateId });
              }
            }
          }
        } catch (err: any) {
          log.debug('[nrc] Failed to re-fetch cover', { date: dateId, error: err.message });
        }
      }

      // Always rebuild content with on-demand routes so entries survive cache wipes
      const [y, m, d] = dateId.split('-');
      const dateObj = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      const title = formatTitle(dateObj);
      const pageUrl = getDownloadPageUrl(dateObj);
      const pdfUrl = `/v1/nrc/pdf/${dateId}`;

      const coverHtml = `<img src="/cover/nrc/${dateId}" alt="${title}" data-magazine-cover="true" style="max-width:100%;border-radius:8px;" />`;
      const content = [
        '<div class="magazine-entry">',
        coverHtml,
        `<p>Volledige krant</p>`,
        `<p><a href="${pdfUrl}" data-magazine-pdf="true" type="application/pdf">📥 Download PDF</a></p>`,
        `<p><small>Source: <a href="${pageUrl}">${pageUrl}</a></small></p>`,
        '</div>',
      ].join('\n');

      db.run(
        `UPDATE entries SET image_url = ?, content = ?, content_fetched = 1, changed_at = datetime('now') WHERE id = ?`,
        [`/cover/nrc/${dateId}`, content, row.id]
      );

      // Also fix enclosure URLs
      db.run(
        `UPDATE enclosures SET url = ? WHERE entry_id = ? AND mime_type = 'application/pdf'`,
        [pdfUrl, row.id]
      );

      log.info('[nrc] Repaired entry (cover + content rebuilt)', { entry_id: row.id, date: dateId });
    }
  }

  /**
   * Remove entries and associated cache files that exceed the feed_days limit.
   * Keeps the newest `maxDays` entries per feed, deletes the rest.
   */
  private cleanupOldIssues(feed: Feed, maxDays: number): void {
    const db = getDb();

    // Find entries beyond the limit (oldest first), excluding starred
    const oldEntries = db.query(
      `SELECT id, hash FROM entries
       WHERE feed_id = ? AND hash LIKE 'nrc-%' AND starred = 0
       ORDER BY published_at DESC
       LIMIT -1 OFFSET ?`
    ).all(feed.id, maxDays) as Array<{ id: number; hash: string }>;

    if (oldEntries.length === 0) return;

    log.info('[nrc] Cleaning up old issues', { feed_id: feed.id, count: oldEntries.length });

    const coverDir = join(config.dataDir, 'cache', 'covers');
    const pdfDir = join(config.dataDir, 'cache', 'pdfs');

    for (const entry of oldEntries) {
      const dateId = entry.hash.replace('nrc-', '');

      // Remove cached cover
      const coverPath = join(coverDir, `nrc-${dateId}.jpg`);
      if (existsSync(coverPath)) {
        try { unlinkSync(coverPath); } catch { /* ignore */ }
      }

      // Remove cached PDF
      const pdfPath = join(pdfDir, `nrc-${dateId}.pdf`);
      if (existsSync(pdfPath)) {
        try { unlinkSync(pdfPath); } catch { /* ignore */ }
      }

      // Delete the DB entry
      db.run('DELETE FROM entries WHERE id = ?', [entry.id]);
    }

    log.info('[nrc] Cleaned up old issues', { deleted: oldEntries.length });
  }

  /** Resolve cover URL for a given NRC date by scraping the page + API. */
  private async resolveCoverUrl(dateId: string): Promise<string | null> {
    try {
      const [y, m, d] = dateId.split('-');
      const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
      const pageUrl = getDownloadPageUrl(date);

      const pageRes = await authenticatedFetch(pageUrl);
      if (!pageRes.ok) return null;

      const html = await pageRes.text();
      const { document } = parseHTML(html);

      // Try og:image from HTML first (fast path)
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';

      // Try the package API for higher-quality cover
      let packageUrl: string | null = null;
      const els = document.querySelectorAll('[data-de-package-url]');
      for (const el of els) {
        const val = (el as any).getAttribute('data-de-package-url');
        if (val) { packageUrl = val; break; }
      }

      if (packageUrl) {
        const apiUrl = packageUrl.startsWith('http') ? packageUrl : `${NRC_BASE}${packageUrl}`;
        try {
          const apiRes = await authenticatedFetch(apiUrl);
          if (apiRes.ok) {
            const pkg = await apiRes.json() as NrcPackage;
            const frontPage = pkg.pages?.find(p => p.number === 1) || pkg.pages?.[0];
            const variations = frontPage?.image_variations;
            const coverUrl =
              variations?.large?.url ||
              variations?.xlarge?.url ||
              variations?.medium?.url ||
              frontPage?.fullscreen_url ||
              frontPage?.image_url ||
              pkg.cover_url ||
              pkg.thumbnail_url;
            if (coverUrl) return coverUrl;
          }
        } catch { /* fall through to ogImage */ }
      }

      // Also try scanning for cover images in HTML (backup approach)
      const coverImg = document.querySelector('img[src*="front"], img[class*="cover"], img[alt*="voorpagina"]');
      const htmlCover = coverImg?.getAttribute('src') || '';
      if (htmlCover) return htmlCover.startsWith('http') ? htmlCover : `${NRC_BASE}${htmlCover}`;

      return ogImage || null;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// On-demand PDF resolution (lazy mode)
// ---------------------------------------------------------------------------

/**
 * Get or download an NRC PDF for the given date.
 * Called from the on-demand PDF route (`/v1/nrc/pdf/:dateId`).
 * Returns the absolute path to the cached PDF file.
 */
/**
 * Get or download an NRC cover image for the given date.
 * Called from the public cover route (`/cover/nrc/:dateId`).
 * Returns the absolute path to the cached cover file.
 */
export async function getNrcCover(dateId: string): Promise<string> {
  const coverDir = join(config.dataDir, 'cache', 'covers');
  const dest = join(coverDir, `nrc-${dateId}.jpg`);

  if (existsSync(dest)) return dest;

  // Need to re-fetch the cover from NRC
  // Instantiate the source to use its resolveCoverUrl method
  const source = new NRCSource();
  const coverUrl = await (source as any).resolveCoverUrl(dateId);
  if (!coverUrl) throw new Error(`Could not resolve cover URL for NRC ${dateId}`);

  const coverRes = await authenticatedFetch(coverUrl);
  if (!coverRes.ok) throw new Error(`Failed to download NRC cover: ${coverRes.status}`);
  const buf = Buffer.from(await coverRes.arrayBuffer());
  if (buf.length < 100) throw new Error('Cover image too small');
  writeFileSync(dest, buf);
  log.info('[nrc] On-demand cover download', { date: dateId });
  return dest;
}

export async function getNrcPdf(dateId: string): Promise<string> {
  const pdfDir = join(config.dataDir, 'cache', 'pdfs');
  const dest = join(pdfDir, `nrc-${dateId}.pdf`);

  // Serve from cache if already downloaded
  if (existsSync(dest)) {
    const header = Buffer.from(await Bun.file(dest).slice(0, 4).arrayBuffer());
    if (header.toString('ascii').startsWith('%PDF')) {
      return dest;
    }
    // Invalid cache file — remove and re-download
    unlinkSync(dest);
  }

  // Try in-memory URL cache first
  let pdfUrl = pdfUrlCache.get(dateId);

  if (!pdfUrl) {
    // Scrape the NRC page to resolve the PDF URL
    const [y, m, d] = dateId.split('-');
    const date = new Date(parseInt(y), parseInt(m) - 1, parseInt(d));
    const pageUrl = getDownloadPageUrl(date);

    const pageRes = await authenticatedFetch(pageUrl);
    if (!pageRes.ok) throw new Error(`NRC page returned ${pageRes.status}`);

    const html = await pageRes.text();
    const { document } = parseHTML(html);

    let packageUrl: string | null = null;
    const els = document.querySelectorAll('[data-de-package-url]');
    for (const el of els) {
      const val = (el as any).getAttribute('data-de-package-url');
      if (val) { packageUrl = val; break; }
    }
    if (!packageUrl) throw new Error('No package URL found for this date');

    const apiUrl = packageUrl.startsWith('http') ? packageUrl : `${NRC_BASE}${packageUrl}`;
    const apiRes = await authenticatedFetch(apiUrl);
    if (!apiRes.ok) throw new Error(`NRC API returned ${apiRes.status}`);
    const pkg = await apiRes.json() as NrcPackage;

    const pdfPath = pkg.download?.pdf_full || pkg.assets?.pdf_full;
    if (!pdfPath) throw new Error('No PDF found in NRC package');

    pdfUrl = pdfPath.startsWith('http') ? pdfPath : `${NRC_BASE}${pdfPath}`;
    pdfUrlCache.set(dateId, pdfUrl);
  }

  // Download and cache the PDF
  log.info('[nrc] On-demand PDF download', { date: dateId });
  const pdfRes = await authenticatedFetch(pdfUrl);
  if (!pdfRes.ok) throw new Error(`Failed to download NRC PDF: ${pdfRes.status}`);

  const buffer = Buffer.from(await pdfRes.arrayBuffer());
  if (buffer.length > 4 && !buffer.subarray(0, 5).toString('ascii').startsWith('%PDF')) {
    throw new Error('Downloaded content is not a valid PDF');
  }

  writeFileSync(dest, buffer);
  log.info('[nrc] Cached on-demand PDF', { date: dateId, size_mb: (buffer.length / 1024 / 1024).toFixed(1) });
  return dest;
}

/**
 * MagazineLib Content Source
 *
 * Scrapes magazinelib.com for magazine issues. Each feed has a search
 * query in source_config. On fetch, searches for new issues and caches
 * covers eagerly. PDF downloads are **lazy** — resolved on-demand when
 * the user actually requests a PDF via the `/v1/magazinelib/pdf/:id`
 * route, matching the architecture of the standalone magazine-proxy.
 *
 * PDF download chain: issue page → intermediate URL → VK.com redirect → userapi.com direct URL.
 */

import { parseHTML } from 'linkedom';
import { existsSync, writeFileSync, mkdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { createHash } from 'crypto';
import { config } from '../config.ts';
import { throttledFetch, BROWSER_USER_AGENT, HTML_ACCEPT } from '../lib/http.ts';
import { getDb } from '../db/connection.ts';
import { getSetting } from '../services/settings.ts';
import { log } from '../lib/logger.ts';
import type { ContentSource, Feed, FetchResult, NewEntry } from './types.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE_URL = 'https://magazinelib.com';

// ---------------------------------------------------------------------------
// Types (also exported for the search route)
// ---------------------------------------------------------------------------

export interface MagazineSearchResult {
  issues: MagazineSearchIssue[];
  page: number;
  hasMore: boolean;
}

export interface MagazineSearchIssue {
  id: string;
  title: string;
  sourceUrl: string;
  coverUrl: string;
  description: string;
  seriesName: string;
  categories: string[];
  pubDate: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateId(url: string): string {
  return createHash('md5').update(url).digest('hex').slice(0, 12);
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function fetchPage(url: string): Promise<string> {
  const res = await throttledFetch(url, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept': HTML_ACCEPT,
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': BASE_URL,
    },
  });
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  return res.text();
}

function extractSeriesName(title: string): string {
  const separators = [' - ', ' – ', ' — ', ' #', ', Issue', ' Issue '];
  for (const sep of separators) {
    const idx = title.indexOf(sep);
    if (idx > 0) return title.substring(0, idx).trim();
  }
  const datePattern = /\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i;
  const withoutDate = title.replace(datePattern, '').trim();
  if (withoutDate.length < title.length) return withoutDate;
  return title;
}

// ---------------------------------------------------------------------------
// Search (also used by the /v1/magazinelib/search route)
// ---------------------------------------------------------------------------

export async function searchMagazines(query: string, page = 1): Promise<MagazineSearchResult> {
  const searchUrl = page > 1
    ? `${BASE_URL}/page/${page}/?s=${encodeURIComponent(query)}`
    : `${BASE_URL}/?s=${encodeURIComponent(query)}`;

  log.debug('[magazinelib] Searching', { url: searchUrl });
  const html = await fetchPage(searchUrl);
  const { document } = parseHTML(html);

  const issues: MagazineSearchIssue[] = [];

  const articles = document.querySelectorAll('article, .post-item, .listing-item, .entry-item');
  for (const el of articles) {
    try {
      const titleEl = el.querySelector('h2 a, h3 a, .post-title a, .entry-title a');
      const title = titleEl?.textContent?.trim() || '';
      const sourceUrl = titleEl?.getAttribute('href') || '';
      if (!title || !sourceUrl) continue;

      const imgEl = el.querySelector('img');
      const coverUrl =
        imgEl?.getAttribute('data-lazy-src') ||
        imgEl?.getAttribute('data-src') ||
        imgEl?.getAttribute('src') || '';

      const descEl = el.querySelector('.post-excerpt, .entry-summary, .post-content p, .excerpt');
      const description = descEl?.textContent?.trim() || title;

      const timeEl = el.querySelector('time, .post-date, .entry-date, .date');
      const dateText = timeEl?.getAttribute('datetime') || timeEl?.textContent?.trim() || '';

      const categories: string[] = [];
      el.querySelectorAll('.post-cat a, .category a, .cat-links a').forEach((catEl: any) => {
        categories.push(catEl.textContent?.trim() || '');
      });

      const id = generateId(sourceUrl);
      issues.push({
        id,
        title,
        sourceUrl,
        coverUrl,
        description,
        seriesName: extractSeriesName(title),
        categories: categories.filter(Boolean),
        pubDate: dateText || new Date().toISOString(),
      });
    } catch (err) {
      log.debug('[magazinelib] Error parsing search result', { error: String(err) });
    }
  }

  const hasMore = !!document.querySelector('.pagination .next, .nav-links .next, a.next');
  log.debug('[magazinelib] Search results', { count: issues.length, page, hasMore });

  return { issues, page, hasMore };
}

// ---------------------------------------------------------------------------
// In-memory issue cache (mirrors magazine-proxy architecture)
// ---------------------------------------------------------------------------
// Maps issue ID → metadata needed for on-demand PDF resolution.

const issueCache = new Map<string, MagazineSearchIssue & { resolvedPdfUrl?: string }>();

export function getCachedIssue(id: string) {
  return issueCache.get(id);
}

export function cacheIssues(issues: MagazineSearchIssue[]) {
  for (const issue of issues) {
    issueCache.set(issue.id, { ...issue });
  }
}

// ---------------------------------------------------------------------------
// Issue detail fetching — extract PDF download link
// ---------------------------------------------------------------------------

async function fetchIssueDetailPdfUrl(sourceUrl: string): Promise<string> {
  log.debug('[magazinelib] Fetching issue details', { url: sourceUrl });
  const html = await fetchPage(sourceUrl);
  const { document } = parseHTML(html);

  // MagazineLib-specific: VK attachment links (most reliable)
  // e.g. <div class="vk-att"><a href="/login/admin-ajax.php?action=vkpd_file&...">
  const selectors = [
    '.vk-att a',
    '.vk-att-item a',
    'a[href*="vkpd_file"]',
    'a[href*="admin-ajax.php"][href*="file"]',
    // Generic fallbacks
    'a[href*=".pdf"]',
    'a[href*="download"]',
    '.download-link a',
    '.download-button a',
    'a.download',
    '.entry-content a[href*="pdf"]',
    '.post-content a[href*="pdf"]',
    'a[href*="drive.google"]',
    'a[href*="mega.nz"]',
    'a[href*="mediafire"]',
  ];

  for (const selector of selectors) {
    const link = document.querySelector(selector);
    if (link) {
      const href = link.getAttribute('href');
      if (href) return href.startsWith('/') ? `${BASE_URL}${href}` : href;
    }
  }

  // Fallback: scan content area for file host links
  const contentLinks = document.querySelectorAll('.entry-content a, .post-content a, .single-content a');
  for (const el of contentLinks) {
    const href = (el as any).getAttribute('href') || '';
    if (href && (href.includes('.pdf') || href.includes('drive.google') || href.includes('mega.nz'))) {
      return href;
    }
  }

  return '';
}

// ---------------------------------------------------------------------------
// VK.com PDF URL resolution chain
// (Matches the magazine-proxy's resolveVkDocUrl implementation)
// ---------------------------------------------------------------------------

function extractDocUrlFromHtml(html: string): string | null {
  // Pattern 1: Docs.initDoc({...docUrl:"..."})
  const initDocMatch = html.match(/Docs\.initDoc\((\{.+?\})\)/s);
  if (initDocMatch) {
    try {
      const data = JSON.parse(initDocMatch[1]);
      if (data.docUrl) return data.docUrl;
    } catch {
      const urlMatch = initDocMatch[1].match(/"docUrl"\s*:\s*"([^"]+)"/);
      if (urlMatch) return urlMatch[1].replaceAll('\\/', '/');
    }
  }
  // Pattern 2: Direct userapi.com PDF link
  const userapiMatch = html.match(/https?:\/\/[a-z0-9.-]*userapi\.com\/[^"'\s<>]+\.pdf[^"'\s<>]*/i);
  if (userapiMatch) return userapiMatch[0].replaceAll('\\/', '/');
  return null;
}

async function resolveVkDocUrl(intermediateUrl: string): Promise<string> {
  log.debug('[magazinelib] Resolving VK doc URL', { url: intermediateUrl.substring(0, 80) });

  // Step 1: Follow MagazineLib redirect to VK page (manual redirect like proxy)
  const redirectRes = await throttledFetch(intermediateUrl, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Referer': `${BASE_URL}/`,
    },
    redirect: 'manual',
  });

  let vkPageUrl: string;
  if (redirectRes.status >= 300 && redirectRes.status < 400) {
    vkPageUrl = redirectRes.headers.get('location') || '';
  } else if (redirectRes.ok) {
    const html = await redirectRes.text();
    const directUrl = extractDocUrlFromHtml(html);
    if (directUrl) return directUrl;
    throw new Error('No redirect and no VK doc URL in response');
  } else {
    throw new Error(`MagazineLib returned ${redirectRes.status}`);
  }
  if (!vkPageUrl) throw new Error('No redirect location from MagazineLib');

  log.debug('[magazinelib] VK page URL', { url: vkPageUrl.substring(0, 80) });

  // Step 2: Fetch VK page and extract docUrl
  const vkRes = await throttledFetch(vkPageUrl, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    redirect: 'follow',
  });
  if (!vkRes.ok) throw new Error(`VK.com returned ${vkRes.status}`);

  const html = await vkRes.text();
  const docUrl = extractDocUrlFromHtml(html);
  if (!docUrl) throw new Error('Could not extract docUrl from VK.com page');

  log.debug('[magazinelib] Resolved direct PDF URL', { url: docUrl.substring(0, 80) });
  return docUrl;
}

/**
 * Resolve the actual PDF download URL for an issue.
 * Called on-demand from the PDF proxy route (`/v1/magazinelib/pdf/:issueId`).
 * Handles the MagazineLib → VK.com → userapi.com redirect chain.
 */
export async function resolvePdfUrl(issueId: string): Promise<string> {
  const cached = getCachedIssue(issueId);

  // If we already resolved a direct userapi.com URL, re-use it
  if (cached?.resolvedPdfUrl && cached.resolvedPdfUrl.includes('userapi.com')) {
    return cached.resolvedPdfUrl;
  }

  // Need to fetch the issue detail page and resolve the VK chain
  let sourceUrl = cached?.sourceUrl;
  if (!sourceUrl) {
    // In-memory cache is empty (e.g. after server restart) — look up source URL from DB
    const db = getDb();
    const row = db.query('SELECT url FROM entries WHERE hash = ? LIMIT 1').get(`mag-${issueId}`) as { url: string } | null;
    sourceUrl = row?.url;
  }
  if (!sourceUrl) {
    throw new Error(`No source URL known for issue ${issueId}`);
  }

  const intermediateUrl = await fetchIssueDetailPdfUrl(sourceUrl);
  if (!intermediateUrl) {
    throw new Error('No download link found on issue page');
  }

  log.debug('[magazinelib] Found intermediate URL', { url: intermediateUrl.substring(0, 120) });

  // If it's already a direct userapi.com PDF URL, use it as-is.
  // Do NOT trust .endsWith('.pdf') — admin-ajax URLs have .pdf in query
  // params but return redirects, not actual PDFs.
  if (intermediateUrl.includes('userapi.com')) {
    if (cached) cached.resolvedPdfUrl = intermediateUrl;
    return intermediateUrl;
  }

  // Resolve through VK chain (admin-ajax → 302 → VK doc page → userapi.com)
  const directUrl = await resolveVkDocUrl(intermediateUrl);
  if (cached) cached.resolvedPdfUrl = directUrl;
  return directUrl;
}

// ---------------------------------------------------------------------------
// File caching
// ---------------------------------------------------------------------------

const PDF_MAGIC = Buffer.from('%PDF');

function isValidPdf(buf: Buffer): boolean {
  return buf.length > 4 && buf.subarray(0, 4).equals(PDF_MAGIC);
}

async function downloadAndCacheFile(url: string, destPath: string, referer: string): Promise<void> {
  const res = await throttledFetch(url, {
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Accept': '*/*',
      'Referer': referer,
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());

  // Validate PDF files — VK.com sometimes returns HTML login pages
  if (destPath.endsWith('.pdf') && !isValidPdf(buffer)) {
    const snippet = buffer.subarray(0, 200).toString('utf8');
    throw new Error(`Downloaded content is not a valid PDF (got ${buffer.length} bytes, starts with: ${snippet.substring(0, 60)})`);
  }

  writeFileSync(destPath, buffer);
  log.debug('[magazinelib] Cached file', { path: destPath, size_mb: (buffer.length / 1024 / 1024).toFixed(1) });
}

function cachePdfPath(issueId: string): string {
  return join(config.dataDir, 'cache', 'pdfs', `mag-${issueId}.pdf`);
}

function cacheCoverPath(issueId: string): string {
  return join(config.dataDir, 'cache', 'covers', `mag-${issueId}.jpg`);
}

/**
 * Download and cache a PDF for the given issue.
 * Called from the on-demand PDF route.
 * Returns the absolute path to the cached file.
 */
export async function getPdf(issueId: string): Promise<string> {
  const dest = cachePdfPath(issueId);

  // Serve from cache if valid
  if (existsSync(dest)) {
    try {
      const header = Buffer.from(await Bun.file(dest).slice(0, 4).arrayBuffer());
      if (header.equals(PDF_MAGIC)) {
        log.debug('[magazinelib] Serving cached PDF', { issueId });
        return dest;
      }
      // Cached file is invalid (e.g. HTML error page) — remove it
      log.warn('[magazinelib] Removing invalid cached PDF', { path: dest });
      unlinkSync(dest);
    } catch {
      // Can't read → treat as missing
    }
  }

  // Resolve the actual PDF URL and download
  const pdfUrl = await resolvePdfUrl(issueId);
  await downloadAndCacheFile(pdfUrl, dest, `${BASE_URL}/`);
  return dest;
}

/**
 * Fetch the cover image URL by scraping the issue's source page.
 * Used as a fallback when the in-memory cache is empty (e.g. after restart).
 */
async function fetchCoverUrlFromPage(sourceUrl: string): Promise<string> {
  const html = await fetchPage(sourceUrl);
  const { document } = parseHTML(html);
  // OG image is the most reliable indicator of the cover
  const ogImage = document.querySelector('meta[property="og:image"]');
  if (ogImage) {
    const content = (ogImage as any).getAttribute('content');
    if (content) return content;
  }
  // Fallback: first prominent thumbnail in the post
  const imgEl = document.querySelector('.post-thumbnail img, .wp-post-image, article img, .entry-thumbnail img');
  if (imgEl) {
    const src = (imgEl as any).getAttribute('data-lazy-src')
      || (imgEl as any).getAttribute('data-src')
      || (imgEl as any).getAttribute('src');
    if (src) return src.startsWith('/') ? `${BASE_URL}${src}` : src;
  }
  throw new Error(`Could not find cover image URL on page: ${sourceUrl}`);
}

/**
 * Get or download a cover image for an issue.
 * Returns the absolute path to the cached file.
 */
export async function getCover(issueId: string): Promise<string> {
  const dest = cacheCoverPath(issueId);
  if (existsSync(dest)) return dest;

  let coverUrl: string | undefined = getCachedIssue(issueId)?.coverUrl;
  if (!coverUrl) {
    // In-memory cache is empty (e.g. after server restart) — re-scrape from source page
    const db = getDb();
    const row = db.query('SELECT url FROM entries WHERE hash = ? LIMIT 1').get(`mag-${issueId}`) as { url: string } | null;
    if (!row?.url) throw new Error(`No cover URL known for issue ${issueId}`);
    coverUrl = await fetchCoverUrlFromPage(row.url);
  }

  await downloadAndCacheFile(coverUrl, dest, `${BASE_URL}/`);
  return dest;
}

// ---------------------------------------------------------------------------
// ContentSource implementation
// ---------------------------------------------------------------------------

export class MagazineLibSource implements ContentSource {
  readonly type = 'magazinelib';

  async fetch(feed: Feed, signal: AbortSignal): Promise<FetchResult> {
    let sourceConfig: { query?: string } = {};
    try { sourceConfig = JSON.parse(feed.source_config || '{}'); } catch { /* empty */ }

    const query = sourceConfig.query;
    if (!query) {
      log.warn('[magazinelib] Feed has no search query configured', { feed_id: feed.id });
      return { entries: [] };
    }

    const maxIssues = getSetting<number>('modules.magazinelib.max_issues') ?? 10;
    const preCachePdfs = getSetting<boolean>('modules.magazinelib.pre_cache_pdfs') === true;
    const db = getDb();

    // -----------------------------------------------------------------------
    // Quick check: do we even need to search?
    // Count how many good (non-failed) entries we already have and check the
    // newest published_at.  If we already have maxIssues *complete* entries
    // and the newest one is less than 1 days old, skip the expensive search.
    // -----------------------------------------------------------------------
    const existingEntries = db.query(
      `SELECT hash, image_url, download_failed, published_at
       FROM entries
       WHERE feed_id = ? AND hash LIKE 'mag-%'
       ORDER BY published_at DESC`
    ).all(feed.id) as Array<{ hash: string; image_url: string; download_failed: number; published_at: string }>;

    const completeHashes = new Set<string>();
    const failedHashes = new Set<string>();
    const allExistingHashes = new Set<string>();

    for (const row of existingEntries) {
      allExistingHashes.add(row.hash);
      if (row.download_failed) {
        failedHashes.add(row.hash);
        continue;
      }
      const issueId = row.hash.replace('mag-', '');
      const hasCover = row.image_url && existsSync(cacheCoverPath(issueId));
      const hasPdf = !preCachePdfs || existsSync(cachePdfPath(issueId));
      if (hasCover && hasPdf) {
        completeHashes.add(row.hash);
      }
    }

    const goodCount = completeHashes.size;
    const newestPubDate = existingEntries.length > 0 ? new Date(existingEntries[0].published_at) : new Date(0);
    const daysSinceNewest = (Date.now() - newestPubDate.getTime()) / (1000 * 60 * 60 * 24);

    // If we already have enough complete issues AND the newest is recent, skip search entirely.
    // Magazines are at most monthly, so 1 days is a safe threshold.
    if (goodCount >= maxIssues && daysSinceNewest < 1) {
      log.debug('[magazinelib] All issues complete and recent, skipping search', {
        feed_id: feed.id, goodCount, maxIssues, daysSinceNewest: Math.round(daysSinceNewest),
      });
      return { entries: [] };
    }

    // -----------------------------------------------------------------------
    // Search magazinelib — only paginate until we find enough *new* issues
    // -----------------------------------------------------------------------
    let allIssues: MagazineSearchIssue[] = [];
    let page = 1;
    const maxPages = 5;
    while (allIssues.length < maxIssues && page <= maxPages) {
      if (signal.aborted) break;
      const results = await searchMagazines(query, page);
      if (results.issues.length === 0) break;
      allIssues.push(...results.issues);
      if (!results.hasMore) break;
      page++;
    }

    // Deduplicate by id and normalised title
    const seenIds = new Set<string>();
    const seenTitles = new Set<string>();
    allIssues = allIssues.filter(issue => {
      if (seenIds.has(issue.id)) return false;
      seenIds.add(issue.id);
      const normTitle = issue.title.trim().toLowerCase();
      if (seenTitles.has(normTitle)) return false;
      seenTitles.add(normTitle);
      return true;
    });

    allIssues = allIssues.slice(0, maxIssues);
    cacheIssues(allIssues);

    // -----------------------------------------------------------------------
    // Only process issues that are genuinely new (not in DB) or incomplete
    // -----------------------------------------------------------------------
    const entries: NewEntry[] = [];
    let skipped = 0;

    for (const issue of allIssues) {
      if (signal.aborted) break;

      const hash = `mag-${issue.id}`;

      // Already complete — nothing to do
      if (completeHashes.has(hash)) {
        skipped++;
        continue;
      }

      // Previously failed — user must clear the flag to retry
      if (failedHashes.has(hash)) {
        skipped++;
        continue;
      }

      // Already exists in DB (but incomplete, e.g. missing cover/PDF) —
      // repair by re-caching assets, but don't re-insert the entry
      if (allExistingHashes.has(hash)) {
        await this.repairAssets(issue, preCachePdfs, signal);
        skipped++;
        continue;
      }

      // ---- Genuinely new issue — cache assets and build entry ----
      const coverCachePath = cacheCoverPath(issue.id);

      if (issue.coverUrl && !existsSync(coverCachePath)) {
        try {
          await downloadAndCacheFile(issue.coverUrl, coverCachePath, `${BASE_URL}/`);
        } catch (err: any) {
          log.debug('[magazinelib] Failed to cache cover', { id: issue.id, error: err.message });
        }
      }

      // Pre-cache PDF eagerly when setting is on
      const pdfCachePath = cachePdfPath(issue.id);
      if (preCachePdfs && !existsSync(pdfCachePath)) {
        try {
          const pdfUrl = await resolvePdfUrl(issue.id);
          await downloadAndCacheFile(pdfUrl, pdfCachePath, `${BASE_URL}/`);
          log.info('[magazinelib] Pre-cached PDF', { id: issue.id });
        } catch (err: any) {
          log.debug('[magazinelib] Failed to pre-cache PDF', { id: issue.id, error: err.message });
        }
      }

      const hasCover = existsSync(coverCachePath);

      // Entry content — always use on-demand API routes so entries survive cache wipes
      const safeTitle = escapeHtml(issue.title);
      const coverHtml = `<img src="/cover/mag/${issue.id}" alt="${safeTitle}" data-magazine-cover="true" style="max-width:100%;border-radius:8px;" />`;
      const pdfUrl = `/v1/magazinelib/pdf/${issue.id}`;

      const content = [
        '<div class="magazine-entry">',
        coverHtml,
        `<p>${escapeHtml(issue.description)}</p>`,
        `<p><a href="${pdfUrl}" data-magazine-pdf="true" type="application/pdf">📥 Download PDF</a></p>`,
        `<p><small>Source: <a href="${escapeHtml(issue.sourceUrl)}">${escapeHtml(issue.sourceUrl)}</a></small></p>`,
        '</div>',
      ].join('\n');

      entries.push({
        hash: `mag-${issue.id}`,
        title: issue.title,
        url: issue.sourceUrl,
        author: issue.seriesName,
        content,
        published_at: issue.pubDate || new Date().toISOString(),
        image_url: `/cover/mag/${issue.id}`,
        enclosures: [{
          url: pdfUrl,
          mime_type: 'application/pdf',
          size: 0,
        }],
        tags: issue.categories,
      });
    }

    if (skipped > 0) {
      log.info('[magazinelib] Skipped already-complete issues', { skipped, new: entries.length });
    }

    // Clean up entries + cache files beyond the limit
    this.cleanupOldIssues(feed, maxIssues);

    return { entries };
  }

  /**
   * Repair missing assets (cover/PDF) for an existing DB entry.
   * Called when the entry exists but its cached files are gone.
   */
  private async repairAssets(issue: MagazineSearchIssue, preCachePdfs: boolean, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return;

    const db = getDb();

    // Migrate any existing entries that still use stale static file paths to on-demand API routes.
    // This ensures entries survive future cache wipes without 404ing.
    const entryRow = db.query('SELECT id, content FROM entries WHERE hash = ? LIMIT 1')
      .get(`mag-${issue.id}`) as { id: number; content: string } | null;
    if (entryRow) {
      const fixedContent = entryRow.content
        .replace(`/files/cache/covers/mag-${issue.id}.jpg`, `/cover/mag/${issue.id}`)
        .replace(`/v1/magazinelib/cover/${issue.id}`, `/cover/mag/${issue.id}`)
        .replace(`/files/cache/pdfs/mag-${issue.id}.pdf`, `/v1/magazinelib/pdf/${issue.id}`);
      db.run(
        `UPDATE entries SET image_url = ?, content = ?, changed_at = datetime('now') WHERE id = ?`,
        [`/cover/mag/${issue.id}`, fixedContent, entryRow.id]
      );
      db.run(
        `UPDATE enclosures SET url = ? WHERE entry_id = ? AND url LIKE '/files/cache/pdfs/mag-%'`,
        [`/v1/magazinelib/pdf/${issue.id}`, entryRow.id]
      );
    }

    // Re-download cover if the cached file is missing
    const coverCachePath = cacheCoverPath(issue.id);
    if (issue.coverUrl && !existsSync(coverCachePath)) {
      try {
        await downloadAndCacheFile(issue.coverUrl, coverCachePath, `${BASE_URL}/`);
        log.debug('[magazinelib] Repaired cover', { id: issue.id });
      } catch (err: any) {
        log.debug('[magazinelib] Failed to repair cover', { id: issue.id, error: err.message });
      }
    }

    if (preCachePdfs && !existsSync(cachePdfPath(issue.id))) {
      try {
        const pdfUrl = await resolvePdfUrl(issue.id);
        await downloadAndCacheFile(pdfUrl, cachePdfPath(issue.id), `${BASE_URL}/`);
        log.debug('[magazinelib] Repaired PDF', { id: issue.id });
      } catch (err: any) {
        log.debug('[magazinelib] Failed to repair PDF, marking as failed', { id: issue.id, error: err.message });
        db.run(
          `UPDATE entries SET download_failed = 1, changed_at = datetime('now') WHERE hash = ?`,
          [`mag-${issue.id}`]
        );
      }
    }
  }

  /**
   * Remove entries and associated cache files that exceed the max_issues limit.
   * Keeps the newest `maxIssues` entries per feed, deletes the rest.
   */
  private cleanupOldIssues(feed: Feed, maxIssues: number): void {
    const db = getDb();

    // Find entries beyond the limit (oldest first), excluding starred
    const oldEntries = db.query(
      `SELECT id, hash FROM entries
       WHERE feed_id = ? AND hash LIKE 'mag-%' AND starred = 0
       ORDER BY published_at DESC
       LIMIT -1 OFFSET ?`
    ).all(feed.id, maxIssues) as Array<{ id: number; hash: string }>;

    if (oldEntries.length === 0) return;

    log.info('[magazinelib] Cleaning up old issues', { feed_id: feed.id, count: oldEntries.length });

    for (const entry of oldEntries) {
      const issueId = entry.hash.replace('mag-', '');

      // Remove cached cover
      const coverPath = cacheCoverPath(issueId);
      if (existsSync(coverPath)) {
        try { unlinkSync(coverPath); } catch { /* ignore */ }
      }

      // Remove cached PDF
      const pdfPath = cachePdfPath(issueId);
      if (existsSync(pdfPath)) {
        try { unlinkSync(pdfPath); } catch { /* ignore */ }
      }

      // Delete the DB entry
      db.run('DELETE FROM entries WHERE id = ?', [entry.id]);
    }

    log.info('[magazinelib] Cleaned up old issues', { deleted: oldEntries.length });
  }
}

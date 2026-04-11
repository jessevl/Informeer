/**
 * Z-Library Service
 *
 * Search and download EPUB books from Z-Library (z-lib.fm and mirrors).
 * The mirror URL is configurable via settings.
 *
 * Supports optional account authentication via email/password.
 * Authenticated users get higher daily download limits (10+ vs 5).
 *
 * Z-Library has daily IP-based download limits (~5/day for anonymous users).
 * We track downloads in the database to warn users when approaching the limit.
 */

import { log } from '../lib/logger.ts';
import { BROWSER_USER_AGENT } from '../lib/http.ts';
import { getSetting } from '../services/settings.ts';
import { getDb } from '../db/connection.ts';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Default mirrors to try in order if the configured one fails */
const DEFAULT_MIRRORS = ['z-lib.fm', 'z-lib.fo', 'z-lib.gd', 'z-lib.gl'];

/** Daily download limit for anonymous (IP-based) access */
const DEFAULT_DAILY_LIMIT = 5;

/**
 * Get the configured Z-Library base URL.
 * Falls back to z-lib.fm if not configured.
 */
function getBaseUrl(): string {
  const mirror = getSetting<string>('modules.books.zlib_mirror') || DEFAULT_MIRRORS[0];
  // Ensure it's a full URL
  if (mirror.startsWith('http')) return mirror.replace(/\/$/, '');
  return `https://${mirror}`;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ZLibSearchResult {
  id: string;
  title: string;
  author: string;
  publisher: string;
  year: string;
  language: string;
  extension: string;
  fileSize: string;
  rating: string;
  coverUrl: string;
  bookUrl: string;
  downloadUrl: string;
  isbn: string;
}

export interface ZLibSearchResponse {
  results: ZLibSearchResult[];
  page: number;
  totalPages: number;
  hasMore: boolean;
}

export interface ZLibDownloadStatus {
  downloadsToday: number;
  dailyLimit: number;
  remaining: number;
  canDownload: boolean;
  authenticated: boolean;
}

// ---------------------------------------------------------------------------
// Session management (Z-Library authentication)
// ---------------------------------------------------------------------------

interface ZLibSession {
  remixUserId: string;
  remixUserKey: string;
  loggedInAt: number; // timestamp
}

/** In-memory session cache. Cleared on restart. */
let cachedSession: ZLibSession | null = null;

/**
 * Login to Z-Library using their API.
 * Returns session cookies (remix_userid, remix_userkey).
 */
async function zlibLogin(email: string, password: string): Promise<ZLibSession> {
  const baseUrl = getBaseUrl();
  log.info('[zlib] Logging in to Z-Library...');

  const response = await fetch(`${baseUrl}/eapi/user/login`, {
    method: 'POST',
    headers: {
      'User-Agent': BROWSER_USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ email, password }).toString(),
  });

  const text = await response.text();
  log.debug(`[zlib] Login response: ${text.substring(0, 500)}`);

  let data: {
    success: number;
    error?: string;
    user?: {
      id: number;
      email: string;
      name: string;
      remix_userkey: string;
      downloads_today: number;
      downloads_limit: number;
      isPremium: number;
      [key: string]: unknown;
    };
  };

  try {
    data = JSON.parse(text);
  } catch {
    log.warn(`[zlib] Login response is not JSON: ${text.substring(0, 200)}`);
    throw new Error('Z-Library login failed: unexpected response format');
  }

  if (!data.success || !data.user?.id || !data.user?.remix_userkey) {
    const error = data.error || 'Login failed';
    log.warn(`[zlib] Login failed: ${error} (full response: ${JSON.stringify(data).substring(0, 300)})`);
    throw new Error(`Z-Library login failed: ${error}`);
  }

  const session: ZLibSession = {
    remixUserId: String(data.user.id),
    remixUserKey: String(data.user.remix_userkey),
    loggedInAt: Date.now(),
  };

  // Update daily limit from account info if available
  if (data.user.downloads_limit) {
    const currentLimit = getSetting<number>('modules.books.zlib_daily_limit') ?? DEFAULT_DAILY_LIMIT;
    if (data.user.downloads_limit > currentLimit) {
      log.info(`[zlib] Account download limit: ${data.user.downloads_limit}/day (upgrading from ${currentLimit})`);
    }
  }

  cachedSession = session;
  log.info(`[zlib] Logged in successfully (user ${data.user.id}, premium: ${data.user.isPremium ? 'yes' : 'no'}, limit: ${data.user.downloads_limit}/day)`);
  return session;
}

/**
 * Get an active Z-Library session, logging in if needed.
 * Returns null if no credentials are configured.
 */
async function getSession(): Promise<ZLibSession | null> {
  const email = getSetting<string>('modules.books.zlib_email');
  const password = getSetting<string>('modules.books.zlib_password');

  if (!email || !password) return null;

  // Re-use cached session if less than 12 hours old
  if (cachedSession && (Date.now() - cachedSession.loggedInAt) < 12 * 60 * 60 * 1000) {
    return cachedSession;
  }

  try {
    return await zlibLogin(email, password);
  } catch (err) {
    log.warn(`[zlib] Auto-login failed: ${err}`);
    return null;
  }
}

/**
 * Build a cookie string from a session.
 */
function sessionCookies(session: ZLibSession): string {
  return `remix_userid=${session.remixUserId}; remix_userkey=${session.remixUserKey}`;
}

/**
 * Clear the cached session (e.g. after credential change).
 */
export function clearZLibSession(): void {
  cachedSession = null;
}

/**
 * Check if Z-Library credentials are configured and valid.
 */
export async function isZLibAuthenticated(): Promise<boolean> {
  const session = await getSession();
  return session !== null;
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function zlibFetch(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal; authenticated?: boolean; followRedirect?: boolean } = {},
): Promise<Response> {
  const { timeoutMs = 30_000, signal, authenticated = true, followRedirect = true } = opts;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const headers: Record<string, string> = {
    'User-Agent': BROWSER_USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Attach session cookies if available and requested
  if (authenticated) {
    const session = await getSession();
    if (session) {
      headers['Cookie'] = sessionCookies(session);
    }
  }

  try {
    const response = await fetch(url, {
      headers,
      signal: controller.signal,
      redirect: followRedirect ? 'follow' : 'manual',
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch a URL manually following redirects (needed for /dl/ → CDN cross-domain).
 * The initial request includes auth cookies, but the redirect to CDN doesn't need them.
 */
async function zlibFetchWithRedirect(
  url: string,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {},
): Promise<Response> {
  // First request: with cookies but don't auto-follow redirects
  const initialResponse = await zlibFetch(url, {
    ...opts,
    followRedirect: false,
    authenticated: true,
  });

  // If it's a redirect, follow it without cookies (CDN doesn't need them)
  if (initialResponse.status >= 300 && initialResponse.status < 400) {
    const location = initialResponse.headers.get('location');
    if (location) {
      log.debug(`[zlib] Following redirect: ${location.substring(0, 100)}...`);
      return zlibFetch(location, {
        ...opts,
        authenticated: false, // CDN doesn't need cookies
      });
    }
  }

  return initialResponse;
}

// ---------------------------------------------------------------------------
// Download tracking (per-IP daily limit)
// ---------------------------------------------------------------------------

/**
 * Get the current download count for today.
 */
export function getDownloadStatus(): ZLibDownloadStatus {
  const db = getDb();
  const dailyLimit = getSetting<number>('modules.books.zlib_daily_limit') ?? DEFAULT_DAILY_LIMIT;

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const row = db.query(
    "SELECT COUNT(*) as count FROM zlib_downloads WHERE date(downloaded_at) = ?"
  ).get(today) as { count: number } | null;

  const downloadsToday = row?.count ?? 0;
  const remaining = Math.max(0, dailyLimit - downloadsToday);

  // Check if credentials are configured (don't await login here)
  const email = getSetting<string>('modules.books.zlib_email');
  const password = getSetting<string>('modules.books.zlib_password');
  const authenticated = !!(email && password && cachedSession);

  return {
    downloadsToday,
    dailyLimit,
    remaining,
    canDownload: remaining > 0,
    authenticated,
  };
}

/**
 * Record a download in the tracking table.
 */
function recordDownload(bookId: string, title: string): void {
  const db = getDb();
  db.run(
    "INSERT INTO zlib_downloads (zlib_book_id, title, downloaded_at) VALUES (?, ?, datetime('now'))",
    [bookId, title],
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search Z-Library for books matching the query.
 * Filters to EPUB format by default.
 */
export async function searchZLib(
  query: string,
  page = 1,
  epubOnly = true,
): Promise<ZLibSearchResponse> {
  const baseUrl = getBaseUrl();

  // Build search URL
  const params = new URLSearchParams();
  if (epubOnly) {
    params.append('extensions[]', 'epub');
  }
  if (page > 1) {
    params.append('page', String(page));
  }

  const searchUrl = `${baseUrl}/s/${encodeURIComponent(query)}?${params.toString()}`;
  log.debug(`[zlib] Searching: ${query} (page ${page})`);

  const response = await zlibFetch(searchUrl);
  if (!response.ok) {
    throw new Error(`Z-Library search failed: HTTP ${response.status}`);
  }

  const html = await response.text();
  return parseSearchResults(html, page, baseUrl);
}

/**
 * Parse Z-Library search results from HTML.
 * Z-Library uses <z-bookcard> web components with metadata as attributes.
 */
function parseSearchResults(html: string, currentPage: number, baseUrl: string): ZLibSearchResponse {
  const results: ZLibSearchResult[] = [];

  // Extract all <z-bookcard> elements
  const bookCardRegex = /<z-bookcard\s([\s\S]*?)<\/z-bookcard>/gi;
  let match;

  while ((match = bookCardRegex.exec(html)) !== null) {
    const cardHtml = match[0];
    const result = parseBookCard(cardHtml, baseUrl);
    if (result) {
      results.push(result);
    }
  }

  // Extract pagination info from pagerOptions JavaScript
  let totalPages = 1;
  const pagerMatch = html.match(/pagerOptions\s*=\s*\{([^}]+)\}/);
  if (pagerMatch) {
    const pagesTotalMatch = pagerMatch[1].match(/pagesTotal:\s*(\d+)/);
    if (pagesTotalMatch) {
      totalPages = parseInt(pagesTotalMatch[1], 10);
    }
  }

  // If we found results but no pagination, we're on a single-page result
  if (results.length > 0 && totalPages === 1) {
    totalPages = currentPage; // at least this many pages
  }

  return {
    results,
    page: currentPage,
    totalPages,
    hasMore: currentPage < totalPages,
  };
}

/**
 * Parse a single <z-bookcard> element into a search result.
 */
function parseBookCard(cardHtml: string, baseUrl: string): ZLibSearchResult | null {
  // Extract attributes
  const attr = (name: string): string => {
    const m = cardHtml.match(new RegExp(`${name}="([^"]*)"`, 'i'));
    return m?.[1]?.trim() || '';
  };

  const id = attr('id');
  const href = attr('href');
  const download = attr('download');
  const publisher = attr('publisher');
  const language = attr('language');
  const year = attr('year');
  const extension = attr('extension');
  const filesize = attr('filesize');
  const rating = attr('rating');
  const isbn = attr('isbn');

  // Extract title from <div slot="title">
  const titleMatch = cardHtml.match(/<div\s+slot="title"[^>]*>([\s\S]*?)<\/div>/i);
  const title = titleMatch ? stripHtml(titleMatch[1]).trim() : '';

  // Extract author from <div slot="author">
  const authorMatch = cardHtml.match(/<div\s+slot="author"[^>]*>([\s\S]*?)<\/div>/i);
  const author = authorMatch ? stripHtml(authorMatch[1]).trim() : '';

  // Extract cover image
  const imgMatch = cardHtml.match(/data-src="([^"]+)"/i)
    || cardHtml.match(/src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i);
  let coverUrl = imgMatch?.[1] || '';

  // Z-Library CDN uses size-prefixed paths like /covers100/ or /covers110/.
  // Upgrade to covers299 for better quality — /covers/ (no size) returns 404.
  if (coverUrl) {
    coverUrl = coverUrl.replace(/\/covers\d+\//, '/covers299/');
  }

  if (!id || !title) return null;

  return {
    id,
    title,
    author,
    publisher,
    year,
    language,
    extension: extension || 'epub',
    fileSize: filesize,
    rating,
    coverUrl,
    bookUrl: href ? `${baseUrl}${href}` : '',
    downloadUrl: download ? `${baseUrl}${download}` : '',
    isbn,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Download a book from Z-Library.
 *
 * The /dl/{hash} URL is an HTML page, not a direct file download.
 * When authenticated or not rate-limited, the page contains a link
 * to the actual CDN file. We parse that link and follow it.
 *
 * Returns the file data as a Buffer and a suggested filename.
 */
export async function downloadFromZLib(
  bookId: string,
  downloadPath: string,
  title: string,
  signal?: AbortSignal,
): Promise<{ data: Buffer; filename: string }> {
  // Check download limit
  const status = getDownloadStatus();
  if (!status.canDownload) {
    throw new Error(
      `Z-Library daily download limit reached (${status.dailyLimit}/day). ` +
      `Resets at midnight. ${status.downloadsToday} downloads today.`
    );
  }

  const baseUrl = getBaseUrl();
  const downloadUrl = downloadPath.startsWith('http') ? downloadPath : `${baseUrl}${downloadPath}`;

  log.info(`[zlib] Downloading book: ${title} (id: ${bookId})`);

  // Strategy 1: Fetch the /dl/ page with auth cookies, manually follow redirect to CDN
  const response = await zlibFetchWithRedirect(downloadUrl, {
    timeoutMs: 120_000, // 2 minutes for large files
    signal,
  });

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error('Z-Library rate limit exceeded. Try again later.');
    }
    throw new Error(`Download failed: HTTP ${response.status}`);
  }

  const contentType = response.headers.get('content-type') || '';

  // If the response is already an EPUB/binary file, great!
  if (!contentType.includes('text/html')) {
    const arrayBuffer = await response.arrayBuffer();
    const data = Buffer.from(arrayBuffer);
    if (isValidEpub(data)) {
      recordDownload(bookId, title);
      const filename = extractFilename(response, title);
      log.info(`[zlib] Downloaded directly: ${filename} (${data.length} bytes)`);
      return { data, filename };
    }
  }

  // The response is HTML — this means the /dl/ page didn't redirect to CDN
  const html = await response.text();

  // Log a snippet of the HTML for debugging
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  log.debug(`[zlib] Got HTML response instead of file redirect (page title: "${titleMatch?.[1]?.trim() || 'unknown'}")`);

  // Check if rate-limited (anonymous IP-based limit)
  // If we're authenticated and the session is valid, this is likely a book-specific
  // issue (unavailable entry, DMCA'd, removed upload) rather than a real rate limit.
  const hasRateLimitHtml = html.includes('download-limits-error') || html.includes('Daily limit reached');
  if (hasRateLimitHtml && !status.authenticated) {
    throw new Error(
      'Z-Library daily download limit reached. ' +
      'Consider adding Z-Library credentials in Settings to increase the limit.'
    );
  }

  // For authenticated users who see the rate-limit page: this specific
  // book entry is unavailable (the auth session IS valid since login succeeded).
  // Log and fall through to alternative strategies.
  if (hasRateLimitHtml && status.authenticated) {
    log.warn(`[zlib] Book entry ${bookId} returned rate-limit page despite valid auth — entry may be unavailable`);
  }

  // Strategy 2: Look for a direct download link on the page
  const fileUrl = extractDownloadUrl(html, baseUrl);
  if (fileUrl) {
    log.debug(`[zlib] Found download URL: ${fileUrl}`);
    const fileResponse = await zlibFetch(fileUrl, {
      timeoutMs: 120_000, // 2 minutes for large files
      signal,
    });

    if (fileResponse.ok) {
      const arrayBuffer = await fileResponse.arrayBuffer();
      const data = Buffer.from(arrayBuffer);
      if (isValidEpub(data)) {
        recordDownload(bookId, title);
        const filename = extractFilename(fileResponse, title);
        log.info(`[zlib] Downloaded via page link: ${filename} (${data.length} bytes)`);
        return { data, filename };
      }
      log.warn(`[zlib] Downloaded file is not a valid EPUB (${data.length} bytes, starts with: ${data.subarray(0, 4).toString('hex')})`);
    } else {
      log.warn(`[zlib] CDN download failed: HTTP ${fileResponse.status}`);
    }
  }

  // Strategy 3: Try the book detail page to find the file hash, then construct CDN URL
  const bookPageUrl = downloadPath.replace('/dl/', '/book/');
  if (bookPageUrl !== downloadPath) {
    log.debug(`[zlib] Trying book detail page: ${baseUrl}${bookPageUrl}`);
    try {
      const bookPageResponse = await zlibFetch(`${baseUrl}${bookPageUrl}`, {
        timeoutMs: 30_000,
        signal,
      });
      if (bookPageResponse.ok) {
        const bookHtml = await bookPageResponse.text();
        const cdnUrl = extractCdnUrl(bookHtml, baseUrl);
        if (cdnUrl) {
          log.debug(`[zlib] Found CDN URL from book page: ${cdnUrl}`);
          const cdnResponse = await zlibFetch(cdnUrl, {
            timeoutMs: 120_000,
            signal,
          });
          if (cdnResponse.ok) {
            const arrayBuffer = await cdnResponse.arrayBuffer();
            const data = Buffer.from(arrayBuffer);
            if (isValidEpub(data)) {
              recordDownload(bookId, title);
              const filename = extractFilename(cdnResponse, title);
              log.info(`[zlib] Downloaded via CDN: ${filename} (${data.length} bytes)`);
              return { data, filename };
            }
          }
        }
      }
    } catch (err) {
      log.debug(`[zlib] Book page strategy failed: ${err}`);
    }
  }

  throw new Error(
    'This book entry is not available for download on Z-Library. ' +
    'Try a different edition or upload of the same book.'
  );
}

/**
 * Check if a buffer looks like a valid EPUB (ZIP file starting with PK).
 */
function isValidEpub(data: Buffer): boolean {
  // EPUB files are ZIP archives, which start with PK (0x50 0x4B)
  return data.length > 100 && data[0] === 0x50 && data[1] === 0x4B;
}

/**
 * Extract the actual file download URL from the /dl/ page HTML.
 * The page may contain various link patterns depending on auth state.
 */
function extractDownloadUrl(html: string, baseUrl: string): string | null {
  // Pattern 1: Direct CDN link (e.g., href="https://dln1.ncdn.ec/...")
  const cdnLinkMatch = html.match(/href="(https?:\/\/[^"]*ncdn[^"]*\.epub[^"]*)"/i)
    || html.match(/href="(https?:\/\/[^"]*ncdn[^"]*)"/i);
  if (cdnLinkMatch) return cdnLinkMatch[1];

  // Pattern 2: A download link with "dlButton" or similar class
  const dlButtonMatch = html.match(/class="[^"]*dlButton[^"]*"[^>]*href="([^"]+)"/i)
    || html.match(/href="([^"]+)"[^>]*class="[^"]*dlButton[^"]*"/i);
  if (dlButtonMatch) {
    const href = dlButtonMatch[1];
    return href.startsWith('http') ? href : `${baseUrl}${href}`;
  }

  // Pattern 3: "window.location" redirect in inline script
  const locationMatch = html.match(/window\.location(?:\.href)?\s*=\s*["']([^"']+(?:\.epub|ncdn|general-files)[^"']*)['"]/i);
  if (locationMatch) return locationMatch[1];

  // Pattern 4: Config.generalFilesProxy + file hash
  const proxyMatch = html.match(/"generalFilesProxy"\s*:\s*"([^"]+)"/);
  const hashMatch = html.match(/data-sha256="([a-f0-9]{64})"/i)
    || html.match(/book_sha256['"]\s*:\s*['"]([a-f0-9]{64})/i)
    || html.match(/sha256['"]\s*[=:]\s*['"]([a-f0-9]{64})/i);
  if (proxyMatch && hashMatch) {
    return proxyMatch[1].replace(/\\\//g, '/') + hashMatch[1];
  }

  // Pattern 5: Any anchor with a plausible file URL
  const anyFileLink = html.match(/href="(https?:\/\/[^"]*\/general-files\/[^"]*)"/i);
  if (anyFileLink) return anyFileLink[1];

  return null;
}

/**
 * Extract a CDN download URL from the book detail page HTML.
 */
function extractCdnUrl(html: string, _baseUrl: string): string | null {
  // Look for the reader link which contains the SHA256 hash
  const readerMatch = html.match(/reader\.[^/]+\/read\/([a-f0-9]{64})/i);
  const proxyMatch = html.match(/"generalFilesProxy"\s*:\s*"([^"]+)"/);

  if (readerMatch && proxyMatch) {
    const sha256 = readerMatch[1];
    const proxy = proxyMatch[1].replace(/\\\//g, '/');
    return `${proxy}${sha256}`;
  }

  return null;
}

/**
 * Extract a filename from response headers or construct one from the title.
 */
function extractFilename(response: Response, title: string): string {
  let filename = `${title.replace(/[^\w\s-]/g, '').trim()}.epub`;

  const disposition = response.headers.get('content-disposition');
  if (disposition) {
    const filenameMatch = disposition.match(/filename[*]?=['"]?([^'";\n]+)/i);
    if (filenameMatch) {
      filename = decodeURIComponent(filenameMatch[1].replace(/UTF-8''/, ''));
    }
  } else {
    try {
      const url = new URL(response.url);
      const urlFilename = url.searchParams.get('filename');
      if (urlFilename) {
        filename = decodeURIComponent(urlFilename);
      }
    } catch {
      // ignore URL parse errors
    }
  }

  return filename;
}

/**
 * Get the list of available Z-Library mirrors.
 */
export function getZLibMirrors(): string[] {
  return [...DEFAULT_MIRRORS];
}

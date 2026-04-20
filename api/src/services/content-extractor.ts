import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';
import { sanitizeHtml, resolveRelativeUrls, resolveLazyImages, extractFirstImage } from '../lib/html.ts';
import { log } from '../lib/logger.ts';
import { throttledFetch, htmlFetchHeaders, BROWSER_USER_AGENT, BOT_USER_AGENT, MAX_RESPONSE_BYTES } from '../lib/http.ts';
import { getNrcSessionCookies } from '../sources/nrc.ts';

export interface ExtractedContent {
  title: string;
  content: string;
  author: string;
  excerpt: string;
  siteName: string;
  imageUrl: string;
}

/**
 * Per-feed options that override default extraction behavior.
 * These come from the feeds table columns (set by the user in feed settings).
 */
export interface FeedExtractOptions {
  scraperRules?: string;   // Custom CSS selectors (overrides predefined rules)
  userAgent?: string;      // Custom User-Agent header
  cookie?: string;         // Custom Cookie header
}

// ---------------------------------------------------------------------------
// Predefined scraper rules — per-site CSS selectors for content extraction.
// Based on https://github.com/miniflux/v2/blob/main/internal/reader/scraper/rules.go (MIT)
// domain => CSS selectors
// ---------------------------------------------------------------------------

const PREDEFINED_RULES: Record<string, string> = {
  'arstechnica.com':      'div.post-content',
  'bbc.co.uk':            'div.vxp-column--single, div.story-body__inner, ul.gallery-images__list',
  'bleepingcomputer.com': '.articleBody',
  'blog.cloudflare.com':  'div.post-content',
  'cbc.ca':               '.story-content',
  'darkreading.com':      'div.ArticleBase-Body',
  'developpez.com':       'div[itemprop=articleBody]',
  'dilbert.com':          'span.comic-title-name, img.img-comic',
  'explosm.net':          'div#comic',
  'financialsamurai.com': 'article',
  'francetvinfo.fr':      '.text',
  'github.com':           'article.entry-content',
  'heise.de':             'header .article-content__lead, header .article-image, div.article-layout__content.article-content',
  'igen.fr':              'section.corps',
  'ikiwiki.iki.fi':       '.page.group',
  'ilpost.it':            '.entry-content',
  'ing.dk':               'section.body',
  'lapresse.ca':          '.amorce, .entry',
  'lemonde.fr':           'article',
  'lepoint.fr':           '.art-text',
  'lesjoiesducode.fr':    '.blog-post-content img',
  'lesnumeriques.com':    '.text',
  'linux.com':            'div.content, div[property]',
  'mac4ever.com':         'div[itemprop=articleBody]',
  'monwindows.com':       '.blog-post-body',
  'npr.org':              '#storytext',
  'oneindia.com':         '.io-article-body',
  'opensource.com':       'div[property]',
  'openingsource.org':    'article.suxing-popup-gallery',
  'osnews.com':           'div.newscontent1',
  'phoronix.com':         'div.content',
  'pitchfork.com':        '#main-content',
  'pseudo-sciences.org':  '#art_main',
  'quantamagazine.org':   '.outer--content, figure, script',
  'raywenderlich.com':    'article',
  'royalroad.com':        '.author-note-portlet,.chapter-content',
  'slate.fr':             '.field-items',
  'smbc-comics.com':      'div#cc-comicbody, div#aftercomic',
  'swordscomic.com':      'img#comic-image, div#info-frame.tab-content-area',
  'techcrunch.com':       'div.entry-content',
  'theoatmeal.com':       'div#comic',
  'theregister.com':      '#top-col-story h2, #body',
  'theverge.com':         'h2.inline:nth-child(2),h2.duet--article--dangerously-set-cms-markup,figure.w-full,div.duet--article--article-body-component',
  'turnoff.us':           'article.post-content',
  'universfreebox.com':   '#corps_corps',
  'version2.dk':          'section.body',
  'vnexpress.net':        '.detail-new p.description, article.fck_detail',
  'wdwnt.com':            'div.entry-content',
  'webtoons.com':         '.viewer_img,p.author_text',
  'wired.com':            'article',
  'zeit.de':              '.summary, .article-body',
  'zdnet.com':            'div.storyBody',
  // Additional Dutch news sites
  'tweakers.net':         '.articleContent',
  'nos.nl':               '.article-body__content, [data-article-content], .contentBody',
  'nu.nl':                '.block-content .block-wrapper',
  'rtlnieuws.nl':         '.article__body',
  'ad.nl':                'article .article__body',
  'telegraaf.nl':         'section.ArticleBodyBlocks',
  'volkskrant.nl':        'article .article__body',
  'nrc.nl':               '.article__content',
  'trouw.nl':             'article .article__body',
  'nytimes.com':          'section[name="articleBody"], .article-body, .StoryBodyCompact, section[data-testid="body-interior"]',
};

/**
 * Site-specific cookies to bypass cookie walls / consent banners.
 */
const SITE_COOKIES: Record<string, string> = {
  'tweakers.net': 'TNet-Consent=YES; tweakers_cookies_v2=1',
  'ad.nl': 'didomi_token=yes',
  'telegraaf.nl': 'didomi_token=yes',
  'volkskrant.nl': 'didomi_token=yes',
  // nrc.nl uses subscriber session auth — see getPaywallCookies()
  'nu.nl': 'nmt_closed_cookiebar=1',
  'nos.nl': 'npo_cc=30',
  'trouw.nl': 'didomi_token=yes',
  'rtlnieuws.nl': 'didomi_token=yes',
  'theguardian.com': 'GU_TK=1; gu.geo.override=NL',
};

/**
 * Site-specific Referer headers.
 */
const SITE_REFERERS: Record<string, string> = {
  'tweakers.net': 'https://tweakers.net/',
  'arstechnica.com': 'https://arstechnica.com/',
};

// ---------------------------------------------------------------------------
// Content removal — CSS selectors to strip before extraction
// ---------------------------------------------------------------------------

const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe[src*="ads"]',
  'nav', 'footer', 'header:not(article header)',
  '.sidebar', '.comment', '.comments', '.social-share', '.share-buttons',
  '.related-articles', '.related-posts', '.recommended',
  '.newsletter-signup', '.newsletter', '.subscribe',
  '.popup', '.modal', '.overlay',
  '.cookie-banner', '.cookie-consent', '.consent-banner',
  '.advertisement', '.ad-container', '.ad-slot', '.ad-wrapper',
  '.promo', '.sponsored',
  '.menu', '.navigation',
  '[role="complementary"]', '[role="navigation"]',
  '[aria-label="advertisement"]',
  // Accessibility skip-links (WordPress and other CMS frameworks)
  '.skip-link', '.screen-reader-text', '[class*="skip-link"]', '[class*="screen-reader"]',
  'a[href="#content"]', 'a[href="#main"]', 'a[href="#main-content"]',
  // Third-party social sharing widgets
  '[class*="sharedaddy"]', '[id*="sharedaddy"]',     // Jetpack (WordPress.com)
  '[class*="addthis"]',  '[id*="addthis"]',          // AddThis
  '[class*="addtoany"]', '[id*="addtoany"]',          // AddToAny
  '[class*="shareaholic"]',                           // Shareaholic
  '[class*="share-this"]', '[class*="sharethis"]',   // ShareThis
  '[class*="social-sharing"]', '[class*="post-sharing"]', '[class*="entry-share"]',
  // NYT paywall overlay elements (the extension blocks JS calls that activate these;
  // we strip them from the DOM so Readability doesn't pick up the overlay text)
  '#gateway-content', '#standalone-footer',
  '[data-testid="meter-paywall"]', '[data-testid="paywall"]',
  '[data-testid="RegGate"]', '[data-testid="gateway"]',
  '.css-1bd8bfl', // NYT subscription banner class (changes but worth trying)
  '[class*="Paywall"]', '[class*="paywall"]',
  '[class*="Gateway"]', '[class*="gateway"]',
];

// ---------------------------------------------------------------------------
// Pre-processing
// ---------------------------------------------------------------------------

/**
 * Strip script, style, and noisy tags from HTML before DOM parsing.
 */
function preProcessHtml(html: string): string {
  let clean = html;
  clean = clean.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  clean = clean.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  clean = clean.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  clean = clean.replace(/<!--[\s\S]*?-->/g, '');
  return clean;
}

/**
 * Remove noisy elements from a parsed document using CSS selectors.
 */
function removeNoiseElements(document: any): void {
  for (const selector of REMOVE_SELECTORS) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of elements) {
        el.remove();
      }
    } catch { /* invalid selector — skip */ }
  }
}

/**
 * Try CSS selector extraction. Uses provided rules string OR predefined rules.
 * Returns the matched element(s) innerHTML, or null if no rule / no match.
 * For multi-page articles, collects ALL matching elements and concatenates.
 */
function trySelectorExtraction(document: any, hostname: string, customRules?: string): string | null {
  // Priority: per-feed custom rules → predefined rules
  const domain = hostname.replace(/^www\./, '');
  const selector = customRules || PREDEFINED_RULES[domain];
  if (!selector) return null;

  try {
    const selectors = selector.split(',').map(s => s.trim());
    for (const sel of selectors) {
      // Collect ALL matching elements (handles multi-page/paginated articles)
      const elements = document.querySelectorAll(sel);
      if (!elements || elements.length === 0) continue;

      const parts: string[] = [];
      for (const el of elements) {
        const html = el?.innerHTML?.trim();
        if (html && html.length > 50) parts.push(html);
      }

      if (parts.length > 0) {
        const combined = parts.join('\n');
        if (combined.length > 100) {
          log.debug('Selector rule matched', { domain, selector: sel, elements: parts.length, custom: !!customRules });
          return combined;
        }
      }
    }
  } catch { /* fall through */ }

  return null;
}

// ---------------------------------------------------------------------------
// Meta-tag extraction helpers
// ---------------------------------------------------------------------------

function extractMetaImage(document: any, baseUrl: string): string {
  const selectors = [
    'meta[property="og:image"]', 'meta[name="og:image"]',
    'meta[property="og:image:secure_url"]',
    'meta[name="twitter:image"]', 'meta[name="twitter:image:src"]',
    'meta[property="twitter:image"]', 'meta[itemprop="image"]',
  ];
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      const content = el?.getAttribute('content');
      if (content) {
        try { return new URL(content, baseUrl).href; } catch { return content; }
      }
    } catch { /* skip */ }
  }
  return '';
}

function extractMetaDescription(document: any): string {
  for (const sel of ['meta[property="og:description"]', 'meta[name="description"]', 'meta[name="twitter:description"]']) {
    try {
      const el = document.querySelector(sel);
      const c = el?.getAttribute('content');
      if (c) return c.trim();
    } catch { /* skip */ }
  }
  return '';
}

function extractSiteNameMeta(document: any): string {
  try {
    return document.querySelector('meta[property="og:site_name"]')?.getAttribute('content')?.trim() || '';
  } catch { return ''; }
}

// ---------------------------------------------------------------------------
// Post-processing
// ---------------------------------------------------------------------------

/**
 * Post-process extracted content:
 * - Sanitize HTML
 * - Resolve relative URLs to absolute
 * - Resolve lazy-loaded images
 * - Remove empty/useless elements
 */
function postProcessContent(html: string, url: string): string {
  let content = html;

  // Resolve lazy images again in case Readability didn't
  content = resolveLazyImages(content);

  // Resolve relative URLs
  content = resolveRelativeUrls(content, url);

  // Sanitize (remove scripts, event handlers)
  content = sanitizeHtml(content);

  // Remove empty paragraphs and divs
  content = content.replace(/<(p|div|span)\b[^>]*>\s*<\/\1>/gi, '');

  // Remove excessive whitespace
  content = content.replace(/\n{3,}/g, '\n\n');

  return content.trim();
}

// ---------------------------------------------------------------------------
// HTTP fetch with site-specific handling
// ---------------------------------------------------------------------------

/**
 * Known consent/privacy gate domains that we should never follow redirects to.
 * When a site redirects to one of these, we retry with redirect:manual or
 * accept the response as-is.
 */
const CONSENT_DOMAINS = [
  'myprivacy.dpgmedia.nl',
  'consent.google.com',
  'consent.youtube.com',
  'consent.google.nl',
  'privacy-gate',
  'cookie-consent',
  'cookiewall',
  'consentmanager.net',
  'cdn.privacy-mgmt.com',
  'sourcepoint.theguardian.com',
  'accounts.google.com/consent',
];

/**
 * Sites known to gate content behind consent walls for browser User-Agents.
 * For these we skip the browser attempt entirely and fetch with the bot UA
 * directly (bots are typically exempt from GDPR consent requirements).
 *
 * These sites still set the correct Cookie in SITE_COOKIES — but the cookie
 * alone is NOT enough; the server checks the UA string first and only serves
 * consent-free content to non-Mozilla UAs.
 */
const CONSENT_WALL_SITES = [
  'tweakers.net',
  // Other DPG Media sites
  'ad.nl',
  'volkskrant.nl',
  'trouw.nl',
];

/**
 * Check if a hostname belongs to a site with known consent walls.
 */
function isConsentWallSite(hostname: string): boolean {
  return CONSENT_WALL_SITES.some(d => hostname === d || hostname.endsWith('.' + d));
}

/**
 * Check if a URL is a consent/privacy redirect that should be skipped.
 */
function isConsentRedirect(location: string): boolean {
  if (!location) return false;
  try {
    const url = new URL(location);
    // Check against known consent domains
    for (const domain of CONSENT_DOMAINS) {
      if (url.hostname === domain || url.hostname.endsWith('.' + domain)) return true;
      if (url.href.includes(domain)) return true;
    }
    // Generic patterns in redirect URLs
    if (/consent|privacy.gate|cookie.?wall|gdpr/i.test(url.pathname + url.search)) return true;
  } catch {}
  return false;
}

/**
 * Safely drain a Response body so Bun's HTTP client can close the socket.
 * Bun's native fetch can SIGSEGV when a response body is left unconsumed
 * while a subsequent request reuses the same socket (keep-alive). Always
 * call this on every response you don't pass to `readResponseBody()`.
 */
async function drainBody(response: Response): Promise<void> {
  try { await response.text(); } catch {}
}

/**
 * Read response body with a 15 MiB size cap to prevent OOM.
 * Uses response.text() instead of arrayBuffer() — simpler code path in Bun
 * and less likely to trigger native crashes.
 */
async function readResponseBody(response: Response): Promise<string> {
  const contentLength = response.headers.get('Content-Length');
  if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
    await drainBody(response);
    throw new Error(`Response too large: ${contentLength} bytes`);
  }
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new Error(`Response too large: ${text.length} bytes`);
  }
  return text;
}

/**
 * Fetch a URL with browser-like headers, site/feed-specific overrides,
 * and consent-redirect protection.
 *
 * Uses `redirect: 'manual'` to intercept consent-gate redirects BEFORE
 * following them (like tweakers.net → myprivacy.dpgmedia.nl). This is
 * critical because once you follow a consent redirect the original page
 * content is lost.
 *
 * IMPORTANT for Bun stability: every response body MUST be drained via
 * `drainBody()` or `readResponseBody()` before making the next request.
 * Leaving unconsumed bodies causes Bun's HTTP client to SIGSEGV when the
 * socket is reused (keep-alive). The `Connection: close` header (set in
 * `htmlFetchHeaders`) reduces this risk but draining is still required.
 */

/**
 * Resolve subscriber session cookies for known paywall sites.
 * Returns null if credentials are not configured or if the site is unknown.
 */
async function getPaywallCookies(hostname: string): Promise<string | null> {
  const domain = hostname.replace(/^\./, '');
  if (domain === 'nrc.nl' || domain.endsWith('.nrc.nl')) {
    return getNrcSessionCookies();
  }
  return null;
}

async function fetchPage(url: string, opts?: FeedExtractOptions): Promise<{ html: string; finalUrl: string }> {
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch {}

  // For sites known to gate content behind consent walls for browser UAs,
  // skip straight to the bot UA — don't waste a round-trip hitting the wall.
  // IMPORTANT: Use redirect: 'manual' even here — Bun's internal redirect
  // following (redirect: 'follow') can leave partial response bodies that
  // trigger SIGSEGV when the socket is reused. Manual redirect + drainBody
  // keeps us safe.
  if (!opts?.userAgent && isConsentWallSite(hostname)) {
    log.debug('Using bot UA for consent-wall site', { hostname });
    let currentUrl = url;
    let redirectsLeft = 5;

    while (redirectsLeft-- > 0) {
      const response = await throttledFetch(currentUrl, {
        headers: htmlFetchHeaders({ userAgent: BOT_USER_AGENT }),
        redirect: 'manual',
        timeoutMs: 20_000,
      });

      if (response.ok) {
        return { html: await readResponseBody(response), finalUrl: response.url || currentUrl };
      }

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('Location');
        await drainBody(response);
        if (!location) break;
        try { currentUrl = new URL(location, currentUrl).href; } catch { break; }
        continue;
      }

      await drainBody(response);
      throw new Error(`HTTP ${response.status} from consent-wall site ${hostname}`);
    }
    throw new Error(`Too many redirects for consent-wall site ${hostname}`);
  }

  // Build headers using shared helper, with site-specific overrides.
  // Priority: per-feed override > paywall session > consent cookie bypass
  let resolvedCookie = opts?.cookie;
  if (!resolvedCookie) {
    const paywallCookie = await getPaywallCookies(hostname);
    if (paywallCookie) {
      resolvedCookie = paywallCookie;
    } else {
      const cookieDomain = Object.keys(SITE_COOKIES).find(d => hostname.includes(d));
      resolvedCookie = cookieDomain ? SITE_COOKIES[cookieDomain] : undefined;
    }
  }

  // For NYT: use a Google search referrer to bypass metered paywall.
  // NYT's paywall JS checks the referrer — arriving "from Google" skips enforcement.
  const isNytUnlock = !opts?.cookie &&
    (hostname === 'nytimes.com' || hostname.endsWith('.nytimes.com'));
  const refererDomain = Object.keys(SITE_REFERERS).find(d => hostname.includes(d));
  const resolvedReferer = isNytUnlock ? 'https://www.google.com/' :
    (refererDomain ? SITE_REFERERS[refererDomain] : undefined);

  const headers = htmlFetchHeaders({
    userAgent: opts?.userAgent,
    cookie: resolvedCookie,
    referer: resolvedReferer,
  });

  // Manual redirect loop — intercepts consent gates while draining every body
  let currentUrl = url;
  let maxRedirects = 5;

  while (maxRedirects-- > 0) {
    const response = await throttledFetch(currentUrl, {
      headers,
      redirect: 'manual',
      timeoutMs: 20_000,
    });

    // 2xx — success, return page content
    if (response.ok) {
      return { html: await readResponseBody(response), finalUrl: currentUrl };
    }

    // 3xx — redirect
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('Location');

      // CRITICAL: drain the redirect body BEFORE making the next request.
      // Bun SIGSEGV-s when the socket is reused with an unconsumed body.
      await drainBody(response);

      if (!location) break;

      // Consent redirect → retry the ORIGINAL url with a bot UA
      // (bots are typically exempt from GDPR consent walls)
      if (isConsentRedirect(location)) {
        log.debug('Consent redirect blocked, retrying with bot UA', { url: currentUrl, redirect: location });

        // Manual redirect loop for the bot-UA retry too — redirect: 'follow'
        // is NEVER safe in Bun (leaves unconsumed bodies → SIGSEGV).
        let retryUrl = url;
        let retryRedirects = 5;
        while (retryRedirects-- > 0) {
          const retryResp = await throttledFetch(retryUrl, {
            headers: htmlFetchHeaders({ userAgent: BOT_USER_AGENT }),
            redirect: 'manual',
            timeoutMs: 20_000,
          });
          if (retryResp.ok) {
            return { html: await readResponseBody(retryResp), finalUrl: retryResp.url || retryUrl };
          }
          if (retryResp.status >= 300 && retryResp.status < 400) {
            const retryLoc = retryResp.headers.get('Location');
            await drainBody(retryResp);
            if (!retryLoc) break;
            if (isConsentRedirect(retryLoc)) {
              throw new Error(`Consent redirect to ${new URL(location).hostname} — cannot bypass`);
            }
            try { retryUrl = new URL(retryLoc, retryUrl).href; } catch { break; }
            continue;
          }
          await drainBody(retryResp);
          throw new Error(`Consent redirect to ${new URL(location).hostname} — cannot extract content`);
        }
        throw new Error(`Too many redirects on bot-UA retry for ${url}`);
      }

      // Legitimate redirect — resolve relative URL and follow
      try {
        currentUrl = new URL(location, currentUrl).href;
      } catch {
        break;
      }
      continue;
    }

    // Non-2xx, non-3xx — drain and error
    await drainBody(response);
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  throw new Error(`Too many redirects for ${url}`);
}

// ---------------------------------------------------------------------------
// Main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract readable article content from a URL.
 * Multi-strategy content extraction:
 * 1. Fetch with browser-like headers + cookie consent bypass
 * 2. Try per-feed custom CSS selectors (if set by user)
 * 3. Try predefined CSS selectors (from built-in rules)
 * 4. Fall back to Mozilla Readability
 * 5. Broad fallback selectors (article, main, etc.)
 * 6. Extract images from og:image, content, and meta tags
 *
 * @param url - The article URL to extract content from
 * @param opts - Optional per-feed overrides (scraper_rules, user_agent, cookie)
 */
export async function extractContent(url: string, opts?: FeedExtractOptions): Promise<ExtractedContent | null> {
  if (!url) return null;

  let rawHtml: string;
  let finalUrl: string;
  try {
    ({ html: rawHtml, finalUrl } = await fetchPage(url, opts));
  } catch (err: any) {
    // Catch network-level errors (socket close, TLS, timeout) gracefully
    // so they never bubble up as unhandled exceptions that crash the process.
    log.debug('Content extraction fetch failed', { url, error: err?.message || String(err) });
    return null;
  }
  const cleanHtml = preProcessHtml(rawHtml);

  const { document } = parseHTML(cleanHtml);

  // Set documentURI and baseURI so Readability can resolve relative URLs
  for (const prop of ['documentURI', 'baseURI'] as const) {
    try {
      Object.defineProperty(document, prop, {
        value: finalUrl,
        configurable: true,
        writable: true,
      });
    } catch {
      // Already defined and non-configurable — ignore
    }
  }

  let hostname = '';
  try { hostname = new URL(finalUrl).hostname; } catch {}

  // Extract metadata from <head> before we mutate the DOM
  const metaImage = extractMetaImage(document, finalUrl);
  const metaDescription = extractMetaDescription(document);
  const metaSiteName = extractSiteNameMeta(document);

  // Strategy 1: Try CSS selector extraction (per-feed custom rules → predefined rules)
  let content = trySelectorExtraction(document, hostname, opts?.scraperRules);
  let title = '';
  let author = '';
  let excerpt = '';
  let siteName = metaSiteName;

  // Strategy 2: Fall back to Readability on a FRESH document parse.
  // Important: Readability mutates the DOM and depends on structural elements
  // (nav, header, footer) to score content blocks. Running it after noise
  // removal often breaks extraction. So we re-parse the clean HTML.
  if (!content) {
    try {
      const { document: freshDoc } = parseHTML(cleanHtml);
      for (const prop of ['documentURI', 'baseURI'] as const) {
        try {
          Object.defineProperty(freshDoc, prop, {
            value: finalUrl, configurable: true, writable: true,
          });
        } catch {}
      }
      const reader = new Readability(freshDoc as any, {
        charThreshold: 50,
      });
      const article = reader.parse();

      if (article?.content) {
        content = article.content;
        title = article.title || '';
        author = article.byline || '';
        excerpt = article.excerpt || '';
        if (article.siteName) siteName = article.siteName;
      }
    } catch (err) {
      log.debug('Readability parse error', { url: finalUrl, error: (err as Error).message });
    }
  }

  // Strategy 3: If Readability returned nothing, remove noise and try broader selectors
  if (!content) {
    removeNoiseElements(document);
    const fallbackSelectors = [
      '.post-content', '.entry-content', '.article-body', '.story-body',
      'article', 'main', '[role="main"]', '#content',
    ];
    for (const sel of fallbackSelectors) {
      try {
        const el = document.querySelector(sel);
        if (el?.innerHTML && el.innerHTML.trim().length > 200) {
          content = el.innerHTML;
          log.debug('Fallback selector matched', { url: finalUrl, selector: sel });
          break;
        }
      } catch { /* skip */ }
    }
  }

  if (!content) {
    log.debug('All extraction strategies failed', { url: finalUrl });
    return null;
  }

  // Extract title from multiple sources (fallback chain)
  if (!title) {
    try { title = document.querySelector('title')?.textContent?.trim() || ''; } catch {}
  }
  if (!title) {
    try { title = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || ''; } catch {}
  }

  // Use meta description as excerpt if Readability didn't provide one
  if (!excerpt) {
    excerpt = metaDescription;
  }

  // Post-process the content
  content = postProcessContent(content, finalUrl);

  if (!content) {
    log.debug('Post-processed content was empty', { url: finalUrl });
    return null;
  }

  // Extract lead image.
  // og:image is the publisher's authoritative canonical image, so prefer it.
  // Fall back to scanning the extracted content only when og:image is absent
  // (e.g. sites that don't set OpenGraph tags).
  let imageUrl = metaImage || extractFirstImage(content, finalUrl);

  return {
    title,
    content,
    author,
    excerpt,
    siteName,
    imageUrl,
  };
}

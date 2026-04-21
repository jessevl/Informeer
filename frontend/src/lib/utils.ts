// Re-export cn from Frameer design system
export { cn } from '@frameer/lib/design-system';

/**
 * Format relative time (e.g., "2 hours ago")
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();

  // Future date
  if (diffMs < 0) {
    const absDiffMs = -diffMs;
    const absSecs = Math.floor(absDiffMs / 1000);
    const absMins = Math.floor(absSecs / 60);
    const absHours = Math.floor(absMins / 60);
    const absDays = Math.floor(absHours / 24);

    if (absSecs < 60) return 'in a moment';
    if (absMins < 60) return `in ${absMins}m`;
    if (absHours < 24) return `in ${absHours}h`;
    if (absDays < 7) return `in ${absDays}d`;
    return date.toLocaleDateString();
  }

  // Past date
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) {
    return 'just now';
  } else if (diffMins < 60) {
    return `${diffMins}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else if (diffDays < 7) {
    return `${diffDays}d ago`;
  } else {
    return date.toLocaleDateString();
  }
}

/**
 * Format reading time
 */
export function formatReadingTime(minutes: number): string {
  if (minutes < 1) {
    return '< 1 min';
  } else if (minutes === 1) {
    return '1 min';
  } else {
    return `${minutes} min`;
  }
}

/**
 * Format duration for audio/video
 */
export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Extract domain from URL
 */
export function extractDomain(url: string): string {
  try {
    const hostname = new URL(url).hostname;
    return hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncate(text: string, length: number): string {
  if (text.length <= length) return text;
  return text.slice(0, length).trim() + '…';
}

/**
 * Strip HTML tags from content
 */
export function stripHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent || '';
}

/**
 * Get excerpt from HTML content
 */
export function getExcerpt(html: string, maxLength = 200): string {
  const text = stripHtml(html);
  return truncate(text, maxLength);
}

/**
 * Extract first image URL from HTML content
 */
/** Patterns for images that should be skipped as "first image" (favicons, social icons, tracking pixels, etc.) */
const BAD_IMAGE_PATTERN = /(?:favicon|(?:\/share|social|follow|like|tweet|fb|facebook|twitter|linkedin|pinterest)[-_]?(?:icon|button|badge|logo)|\/(?:flattr|paypal|patreon)[-_]?(?:icon|button|badge)|feedburner|feeds\.feedburner\.com|doubleclick|googlesyndication|google-analytics|platform\.twitter\.com|gravatar\.com\/avatar|wp\.com.*\?(?:resize=1|w=1|h=1)|fbcdn\.net|sharethis|addthis|\/(?:facebook|twitter|linkedin|pinterest|whatsapp|telegram|reddit|email|rss|mastodon|x-twitter)\.\w{3,4}(?:\?|$))/i;
const SOCIAL_LINK_PATTERN = /(?:facebook\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.com|reddit\.com|whatsapp:|t\.me\/|telegram\.me\/|mailto:|sharethis|addthis)/i;
const SOCIAL_CONTAINER_PATTERN = /(?:^|[^a-z])(share|sharing|social|follow|addthis|sharethis)(?:[^a-z]|$)/i;
const SOCIAL_ICON_PATTERN = /(?:^|[^a-z])(facebook|twitter|linkedin|pinterest|reddit|whatsapp|telegram|email|mastodon|rss|icon|icons|logo|badge|button)(?:[^a-z]|$)/i;

function getElementHints(el: Element | null): string {
  if (!el) return '';
  return [
    el.getAttribute('class') || '',
    el.getAttribute('id') || '',
    el.getAttribute('aria-label') || '',
    el.getAttribute('title') || '',
    el.getAttribute('alt') || '',
    el.getAttribute('role') || '',
    el.getAttribute('href') || '',
    el.getAttribute('src') || '',
  ].join(' ');
}

function isSocialContainer(el: Element | null): boolean {
  let current = el;
  let depth = 0;
  while (current && depth < 4) {
    const hints = getElementHints(current);
    if (SOCIAL_CONTAINER_PATTERN.test(hints) || SOCIAL_ICON_PATTERN.test(hints)) {
      return true;
    }
    current = current.parentElement;
    depth += 1;
  }
  return false;
}

function isGoodImageUrl(url: string, tag: string, hints = ''): boolean {
  if (!url) return false;
  // Skip data URIs, SVGs, and tracking/social images
  if (url.startsWith('data:') || /\.svg(\?|$)/i.test(url)) return false;
  if (BAD_IMAGE_PATTERN.test(url)) return false;
  if (SOCIAL_ICON_PATTERN.test(hints)) return false;
  // Skip images with explicitly small dimensions in the tag (< 50px)
  const widthMatch = tag.match(/width=["']?(\d+)/i);
  const heightMatch = tag.match(/height=["']?(\d+)/i);
  if (widthMatch && parseInt(widthMatch[1]) < 50) return false;
  if (heightMatch && parseInt(heightMatch[1]) < 50) return false;
  return true;
}

export function extractFirstImage(html: string): string | null {
  if (!html) return null;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  for (const img of Array.from(doc.querySelectorAll('img'))) {
    const src = img.getAttribute('src') || '';
    if (!src || isSocialContainer(img)) continue;
    if (isGoodImageUrl(src, img.outerHTML, getElementHints(img))) return src;
  }

  for (const source of Array.from(doc.querySelectorAll('picture source, source'))) {
    const srcset = source.getAttribute('srcset') || '';
    const firstSrc = srcset.split(',')[0]?.trim().split(/\s+/)[0] || '';
    if (!firstSrc || isSocialContainer(source)) continue;
    if (isGoodImageUrl(firstSrc, source.outerHTML, getElementHints(source))) return firstSrc;
  }
  
  // Try to find an og:image or similar in the content
  const ogMatch = html.match(/og:image[^>]+content=["']([^"']+)["']/i);
  if (ogMatch) return ogMatch[1];
  
  return null;
}

function removeElementOrEmptyWrapper(el: Element): void {
  const parent = el.parentElement;
  if (parent && (
    parent.tagName === 'FIGURE' ||
    parent.tagName === 'PICTURE' ||
    parent.tagName === 'A' ||
    parent.tagName === 'P' ||
    parent.tagName === 'DIV' ||
    parent.tagName === 'SPAN'
  ) && parent.children.length === 1 && !parent.textContent?.trim()) {
    parent.remove();
    return;
  }
  el.remove();
}

function isLikelySocialShareElement(el: Element): boolean {
  const hints = getElementHints(el);
  const text = (el.textContent || '').trim();
  const linkHrefs = Array.from(el.querySelectorAll('a')).map(a => a.getAttribute('href') || '');
  const hasSocialLink = linkHrefs.some(href => SOCIAL_LINK_PATTERN.test(href)) || SOCIAL_LINK_PATTERN.test(hints);
  const hasSocialHints = SOCIAL_CONTAINER_PATTERN.test(hints) || SOCIAL_ICON_PATTERN.test(hints);
  const hasIconOnlyContent = !!el.querySelector('svg, img, i') && text.length < 40;
  const isCompactWidget = el.children.length > 0 && el.children.length <= 8 && text.length < 80;

  return (hasSocialLink && (hasSocialHints || hasIconOnlyContent || isCompactWidget)) ||
    (hasSocialHints && hasIconOnlyContent && isCompactWidget);
}

// ─── Patterns for publisher chrome that should be stripped ─────────────────

/**
 * class/id hints that reliably identify non-article-body chrome.
 * ONLY include patterns that are specific enough to never match article content
 * wrappers. Avoid generic terms like "newsletter", "promo", "ad" that
 * publishers use as class names on content sections too.
 */
const PUBLISHER_CHROME_HINTS = /(?:save-this-story|save_story|cne-audio|paywall-barrier|paywall-message|subscriber-only-badge|piano-offer|pmc-paywall|laterpay|leaky-paywall|article-gate|regwall|hard-wall|soft-wall|outbrain|taboola|consent-banner|cookie-consent|gdpr-consent|advert-slot|dfp-slot|gpt-ad|prebid-ad)/i;

/**
 * Exact text content (whole-string match) for short chrome-only inline elements.
 * Use a narrow selector — avoid `div` because div.textContent includes all
 * descendant text and could accidentally match a content section wrapper.
 */
const PUBLISHER_CHROME_TEXT = /^(?:save this story|saved|unsave|subscribe to read|subscribe now|already a subscriber|create a free account|this story is available|members only|sign in to read|get unlimited access|you['\u2019]ve reached your (?:free )?article limit|listen to this article|advertisement|lees ook|read more|read also|related|meer lezen|gerelateerd|toon meer|load more|meer laden|show more|reacties bekijken|bekijk reacties|credit[.\u2026]{2,3})\u002e?$/i;

/** Alt-text patterns that are not meaningful captions (machine-generated, generic) */
const TRIVIAL_ALT_TEXT = /^(?:image|photo|picture|foto|afbeelding|image may contain|foto van|picture of|\.{1,3}|-|_|\s*)$/i;

/** CSS selectors that identify publisher chrome to strip from the rendered article. */
const STRUCTURAL_CHROME_SELECTORS = [
  // Wired (Condé Nast) – data-testid attributes are stable across CSS-in-JS deploys
  '[data-testid="SplitScreenContentHeaderWrapper"]',
  '[data-testid="ContentHeaderWrapper"]',
  '[data-testid="action-bar-wrapper"]',
  '[data-testid*="PaywallInline"]',
  '[data-testid*="PaywallBarrier"]',
  '[data-testid*="Paywall"]',
  // Presentation-only ad slots (JS fills them client-side → they're empty in stored HTML)
  '[role="presentation"][aria-hidden="true"]',
  // NRC.nl Bison web components
  'dmt-icon',
  'dmt-util-bar',
  'dmt-share-widget',
  'dmt-inline-article-widget',
  // NYT – accessibility label span inside the lazy-image photo wrapper (shows as literal "Image")
  '[data-testid="photoviewer-children-figure"] > span',
];

/**
 * Flatten divs that serve only as structural containers (no direct text nodes,
 * all children are block-level). This is needed because publishers like NatGeo
 * wrap each paragraph group AND each figure in separate <div> elements.
 * CSS floats are scoped to their block formatting context, so a figure floated
 * inside its own <div> can never cause text in an adjacent <div> to wrap
 * around it. By unwrapping these pure-container divs we make paragraphs and
 * figures siblings in the same flow, which is the prerequisite for floats.
 * Runs multiple passes until no more divs can be unwrapped.
 */
const BLOCK_LEVEL_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'FIGURE', 'BLOCKQUOTE', 'UL', 'OL', 'LI', 'PRE', 'TABLE',
  'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'HR', 'DL', 'DT', 'DD',
  'DIV', 'SECTION', 'ASIDE', 'DETAILS', 'SUMMARY', 'HEADER', 'FOOTER',
]);

function flattenContainerDivs(doc: Document): void {
  let changed = true;
  let passes = 0;
  while (changed && passes < 12) {
    changed = false;
    passes++;
    for (const div of Array.from(doc.body.querySelectorAll('div, section'))) {
      if (!div.isConnected) continue;
      // Keep divs that have direct text nodes (they're content, not wrappers)
      const hasDirectText = Array.from(div.childNodes).some(
        n => n.nodeType === Node.TEXT_NODE && (n.textContent || '').trim().length > 0
      );
      if (hasDirectText) continue;
      const children = Array.from(div.children);
      if (children.length === 0) continue;
      // Only unwrap if every immediate child is a block-level element
      if (!children.every(c => BLOCK_LEVEL_TAGS.has(c.tagName))) continue;
      const parent = div.parentElement;
      if (!parent) continue;
      // Move all children before the wrapper div, then remove the wrapper
      while (div.firstChild) parent.insertBefore(div.firstChild, div);
      div.remove();
      changed = true;
    }
  }
}

/**
 * Parse caption HTML attribute into plain text (handles WordPress-style
 * data-image-caption which can itself contain HTML like "<p>Caption here</p>").
 */
function parseCaptionAttr(val: string): string {
  if (!val) return '';
  const tmp = new DOMParser().parseFromString(val, 'text/html');
  return tmp.body.textContent?.trim() || '';
}

/**
 * WordPress data-* attributes that are noisy metadata but not useful for display.
 */
const WP_NOISE_ATTRS = [
  'data-attachment-id', 'data-permalink', 'data-orig-file',
  'data-orig-size', 'data-comments-opened', 'data-image-meta',
  'data-image-title', 'data-image-description', 'data-image-caption',
  'data-medium-file', 'data-large-file',
];

/**
 * Convert non-standard caption containers inside <figure> elements to
 * proper <figcaption> elements. Many publishers (NatGeo, Getty, etc.) use
 * divs with data-testid or class names containing "caption" instead of the
 * semantic <figcaption> tag. Runs before wrapImagesInFigures so the latter
 * sees proper figcaption elements when deciding whether to add one.
 */
function normalizeFigureCaptions(doc: Document): void {
  for (const figure of Array.from(doc.querySelectorAll('figure'))) {
    if (figure.querySelector('figcaption')) continue;
    const captionEl = figure.querySelector(
      '[data-testid*="caption"], [data-testid*="Caption"], .caption, [class*="caption"]'
    );
    if (!captionEl) continue;
    const text = captionEl.textContent?.trim() || '';
    if (text.length < 3) { captionEl.remove(); continue; }
    const fc = doc.createElement('figcaption');
    fc.textContent = text;
    captionEl.replaceWith(fc);
  }
}

/**
 * Wrap bare <img> elements in <figure> tags with optional <figcaption>.
 * Caption priority: WordPress data-image-caption → non-trivial alt text.
 * Images already inside <figure> only get a missing figcaption added.
 * Only processes images that are "paragraph-level" (inside <p> with no other
 * significant text, or direct children of block containers).
 */
function wrapImagesInFigures(doc: Document): void {
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (!img.isConnected) continue;

    // Extract (and then remove) WordPress caption-related data-* attributes
    const captionAttr = img.getAttribute('data-image-caption') || img.getAttribute('data-image-description') || '';
    let captionText = parseCaptionAttr(captionAttr);
    if (!captionText) {
      const alt = img.getAttribute('alt')?.trim() || '';
      if (alt && !TRIVIAL_ALT_TEXT.test(alt)) captionText = alt;
    }

    // Strip WordPress noise attributes
    for (const attr of WP_NOISE_ATTRS) img.removeAttribute(attr);

    const parent = img.parentElement;
    const ancestorFigure = img.closest('figure');

    if (ancestorFigure) {
      // Add figcaption if the figure doesn't have one yet
      if (captionText && !ancestorFigure.querySelector('figcaption')) {
        const cap = doc.createElement('figcaption');
        cap.textContent = captionText;
        ancestorFigure.appendChild(cap);
      }
      continue;
    }

    // Decide what to wrap: prefer <a><img> (linked image) over bare <img>
    const childToWrap = parent?.tagName === 'A' ? parent : img;
    const grandParent = childToWrap.parentElement;
    if (!grandParent) continue;

    // Only wrap if the containing element is a block container with no other text
    const isBlockImg =
      grandParent.tagName === 'P' ||
      grandParent.tagName === 'DIV' ||
      grandParent.tagName === 'SECTION' ||
      grandParent.tagName === 'BODY' ||
      grandParent.tagName === 'ARTICLE';

    if (!isBlockImg) continue;

    // Check that the containing element has no other meaningful text
    const textWithoutImg = Array.from(grandParent.childNodes)
      .filter(n => n !== childToWrap && n !== img)
      .map(n => n.textContent || '')
      .join('')
      .trim();
    if (textWithoutImg) continue;

    const figure = doc.createElement('figure');
    grandParent.insertBefore(figure, childToWrap);
    figure.appendChild(childToWrap);

    if (captionText) {
      const cap = doc.createElement('figcaption');
      cap.textContent = captionText;
      figure.appendChild(cap);
    }

    // Remove now-empty <p> wrapper if the figure took the only content
    if (grandParent.tagName === 'P' && !grandParent.textContent?.trim()) {
      grandParent.remove();
    }
  }
}

/**
 * Classify figures as full-width or floating inline.
 *
 * A figure earns a float class only when it has substantial paragraph text
 * as an immediate neighbour (prev or next sibling) AND is not adjacent to
 * another figure. In all other cases (photo essays, galleries, sparse text)
 * the figure stays full-width — stacking naturally from top to bottom.
 *
 * Classes added:
 *   figure-float-left  → float: left, max-width ~46%
 *   figure-float-right → float: right, max-width ~46%
 *   (no class)         → full column width, clear: both
 *
 * WordPress explicit alignment classes (alignleft/alignright) are honoured
 * unconditionally — they always float.
 */
function classifyFigures(doc: Document): void {
  const FLOAT_PARA_MIN_LEN = 90; // chars of adjacent text needed to justify a float
  const TEXT_TAGS = new Set(['P', 'H2', 'H3', 'H4']);

  const figures = Array.from(doc.querySelectorAll('figure'));
  let floatIndex = 0;

  for (const fig of figures) {
    if (!fig.isConnected) continue;

    // WordPress explicit alignment takes priority — always float
    if (fig.classList.contains('alignleft')) {
      fig.classList.add('figure-float-left');
      continue;
    }
    if (fig.classList.contains('alignright')) {
      fig.classList.add('figure-float-right');
      continue;
    }

    const prev = fig.previousElementSibling;
    const next = fig.nextElementSibling;

    // Neighbour is another figure → gallery / photo essay → full width
    if (prev?.tagName === 'FIGURE' || next?.tagName === 'FIGURE') continue;

    // Check for substantial adjacent text (prev or next sibling paragraph)
    const prevLen = prev && TEXT_TAGS.has(prev.tagName)
      ? (prev.textContent?.trim().length ?? 0) : 0;
    const nextLen = next && TEXT_TAGS.has(next.tagName)
      ? (next.textContent?.trim().length ?? 0) : 0;

    if (prevLen >= FLOAT_PARA_MIN_LEN || nextLen >= FLOAT_PARA_MIN_LEN) {
      floatIndex++;
      fig.classList.add(floatIndex % 2 === 1 ? 'figure-float-left' : 'figure-float-right');
    }
    // else: no class → full width (the CSS default)
  }
}

export function sanitizeArticleHtml(html: string, entryTitle?: string): string {
  if (!html) return html;

  const doc = new DOMParser().parseFromString(html, 'text/html');

  // ── 0. Flatten structural container divs ──────────────────────────────────
  // Must run BEFORE chrome-stripping so publisher wrapper divs don't isolate
  // figures from their surrounding text, which would prevent CSS float wrapping.
  flattenContainerDivs(doc);

  // ── 0b. Normalize vendor caption containers to <figcaption> ───────────────
  // NatGeo and others use [data-testid*="caption"] divs instead of <figcaption>.
  // Must run before wrapImagesInFigures so it sees proper figcaption elements.
  normalizeFigureCaptions(doc);

  // ── 1. Strip structural publisher chrome by stable selectors ─────────────
  for (const sel of STRUCTURAL_CHROME_SELECTORS) {
    try {
      for (const el of Array.from(doc.querySelectorAll(sel))) {
        if ((el as Element).isConnected) (el as Element).remove();
      }
    } catch { /* invalid selector in some browsers – skip */ }
  }

  // ── 2. Strip publisher chrome by class/id hints ───────────────────────────
  // querySelectorAll returns a static snapshot, so removing earlier elements
  // doesn't affect iteration; guard with isConnected to skip double-removes.
  for (const el of Array.from(doc.body.querySelectorAll('[class],[id]'))) {
    if (!el.isConnected) continue;
    const hints = (el.getAttribute('class') || '') + ' ' + (el.getAttribute('id') || '');
    if (PUBLISHER_CHROME_HINTS.test(hints)) {
      el.remove();
    }
  }

  // ── 3. Strip duplicate leading h1 when entry title is known ──────────────
  if (entryTitle) {
    const titleNorm = entryTitle.toLowerCase().replace(/\s+/g, ' ').trim();
    for (const h1 of Array.from(doc.body.querySelectorAll('h1'))) {
      if (!h1.isConnected) continue;
      const h1Norm = (h1.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
      // Match if the heading text is a prefix of the entry title or vice-versa (handles
      // cases where Readability truncates the title slightly differently)
      if (
        h1Norm === titleNorm ||
        (h1Norm.length > 20 && titleNorm.startsWith(h1Norm)) ||
        (titleNorm.length > 20 && h1Norm.startsWith(titleNorm.slice(0, Math.min(40, titleNorm.length))))
      ) {
        h1.remove();
        break; // only remove the first matching heading
      }
    }
  }

  // ── 4. Strip NRC "Lees ook" / related-article link blocks ────────────────
  // Pattern: <a> whose text starts with "lees ook", "read also", etc., or
  // <a> whose only child is a small thumbnail image (related article teaser).
  for (const a of Array.from(doc.body.querySelectorAll('a'))) {
    if (!a.isConnected) continue;
    const txt = (a.textContent || '').toLowerCase().replace(/\s+/g, ' ').trim();
    if (PUBLISHER_CHROME_TEXT.test(txt)) {
      removeElementOrEmptyWrapper(a);
      continue;
    }
    // Related-article links that contain only a small image (<= 200px wide)
    const imgs = a.querySelectorAll('img');
    if (imgs.length === 1 && !a.textContent?.trim()) {
      const w = parseInt(imgs[0].getAttribute('width') || '999', 10);
      if (w <= 200) {
        removeElementOrEmptyWrapper(a);
      }
    }
  }

  // ── 5. Strip short inline chrome elements by exact text ──────────────────
  // Only check `p`, `span`, `button` — NOT `div`, because div.textContent is
  // the concatenation of all descendants and can spuriously match content divs.
  for (const el of Array.from(doc.body.querySelectorAll('p, span, button'))) {
    if (!el.isConnected) continue;
    const text = (el.textContent || '').trim();
    if (
      text.length < 120 &&
      PUBLISHER_CHROME_TEXT.test(text) &&
      el.querySelectorAll('img, iframe, video').length === 0
    ) {
      removeElementOrEmptyWrapper(el);
    }
  }

  // ── 6. Process images: remove bad ones, wrap good ones in figures ─────────
  for (const img of Array.from(doc.querySelectorAll('img'))) {
    if (!img.isConnected) continue;
    const src = img.getAttribute('src') || '';
    if (!isGoodImageUrl(src, img.outerHTML, getElementHints(img)) || isSocialContainer(img)) {
      removeElementOrEmptyWrapper(img);
      continue;
    }
    // Force eager loading so images don't cause column layout reflows mid-read
    img.removeAttribute('loading');
    img.removeAttribute('decoding');
    img.setAttribute('loading', 'eager');
  }

  // Wrap paragraph-level images in <figure> elements with figcaptions
  wrapImagesInFigures(doc);

  // ── 7. Strip social share widgets ────────────────────────────────────────
  for (const el of Array.from(doc.body.querySelectorAll('*'))) {
    if (!el.isConnected) continue;
    if (isLikelySocialShareElement(el)) {
      removeElementOrEmptyWrapper(el);
    }
  }

  // ── 8. Strip empty block elements ────────────────────────────────────────
  for (const el of Array.from(doc.body.querySelectorAll('p, div, section, aside'))) {
    if (!el.isConnected) continue;
    if (!el.textContent?.trim() && el.querySelectorAll('img, figure, iframe, video, audio, svg').length === 0) {
      el.remove();
    }
  }

  // ── 9. Clean up <figure> shells with no visual media ─────────────────────
  // NYT uses pure JS lazy-loading; server-rendered HTML has empty placeholder
  // divs inside <figure> elements. After step 8 removes those empty divs, we
  // may be left with a <figure> that has only a <figcaption>.
  // — If there is caption text: promote the figcaption to a styled <p> so
  //   the reader still gets the photo description.
  // — If there is no caption text either: remove the empty shell entirely.
  for (const figure of Array.from(doc.body.querySelectorAll('figure'))) {
    if (!figure.isConnected) continue;
    if (figure.querySelectorAll('img, video, iframe, canvas, svg').length > 0) continue;
    const caption = figure.querySelector('figcaption');
    const captionText = caption?.textContent?.trim() || '';
    if (captionText) {
      // Replace the empty figure with a plain italic caption paragraph
      const p = doc.createElement('p');
      p.className = 'article-photo-caption';
      p.textContent = captionText;
      figure.replaceWith(p);
    } else {
      figure.remove();
    }
  }

  // ── 10. Classify figures as full-width or floating ────────────────────────
  // Only float figures that are adjacent to substantial paragraph text.
  // Photo-essay figures (surrounded by other figures or short captions) are
  // left full-width so they stack naturally instead of creating a chaotic grid.
  classifyFigures(doc);

  return doc.body.innerHTML;
}

/**
 * Remove the first image from HTML content if it matches the cover image
 * This prevents showing duplicate images when cover image is displayed
 */
export function removeFirstImageFromContent(html: string, coverImageUrl: string | null): string {
  if (!html || !coverImageUrl) return html;
  
  // Parse the HTML
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  // Find the first img element
  const firstImg = doc.querySelector('img');
  if (!firstImg) return html;
  
  const imgSrc = firstImg.getAttribute('src');
  if (!imgSrc) return html;
  
  // Check if this image matches or is similar to the cover image
  // Compare by checking if URLs match or if they're from the same source
  const isSameImage = imgSrc === coverImageUrl || 
    imgSrc.includes(coverImageUrl) || 
    coverImageUrl.includes(imgSrc) ||
    // Also check if it's the same filename (handles CDN variants)
    extractFilename(imgSrc) === extractFilename(coverImageUrl);
  
  if (isSameImage) {
    // Remove the img element
    // Also remove parent element if it's a figure, picture, or wrapper div
    const parent = firstImg.parentElement;
    if (parent && (
      parent.tagName === 'FIGURE' || 
      parent.tagName === 'PICTURE' ||
      (parent.tagName === 'A' && parent.children.length === 1) ||
      (parent.tagName === 'P' && parent.children.length === 1 && !parent.textContent?.trim())
    )) {
      parent.remove();
    } else {
      firstImg.remove();
    }
    
    return doc.body.innerHTML;
  }
  
  return html;
}

/**
 * Extract filename from URL for comparison
 */
function extractFilename(url: string): string {
  try {
    const pathname = new URL(url).pathname;
    return pathname.split('/').pop() || '';
  } catch {
    return url.split('/').pop() || '';
  }
}

/**
 * Check if entry has media (podcast/video)
 */
export function hasMedia(enclosures: { mime_type: string }[] | null): boolean {
  if (!enclosures || enclosures.length === 0) return false;
  return enclosures.some(
    (e) => e.mime_type.startsWith('audio/') || e.mime_type.startsWith('video/')
  );
}

/**
 * Get media type from enclosures
 */
export function getMediaType(
  enclosures: { mime_type: string }[] | null
): 'audio' | 'video' | null {
  if (!enclosures || enclosures.length === 0) return null;
  
  const media = enclosures.find(
    (e) => e.mime_type.startsWith('audio/') || e.mime_type.startsWith('video/')
  );
  
  if (!media) return null;
  return media.mime_type.startsWith('audio/') ? 'audio' : 'video';
}

/**
 * Check if URL is a YouTube video
 */
export function isYouTubeUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)/.test(url);
}

/**
 * Extract YouTube video ID from URL
 * Supports: watch, embed, shorts, live, youtu.be, and v/ formats
 */
export function extractYouTubeId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/v\/([^&\n?#]+)/,
    /youtube\.com\/shorts\/([^&\n?#]+)/,  // YouTube Shorts
    /youtube\.com\/live\/([^&\n?#]+)/,    // YouTube Live
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }

  return null;
}

/**
 * Strip YouTube embeds (iframes) from HTML content
 * This prevents duplicate video players when we have our own video player
 * Also extracts YouTube IDs found in the content
 */
export function stripYouTubeEmbeds(html: string): { html: string; youtubeIds: string[] } {
  if (!html) return { html, youtubeIds: [] };
  
  const youtubeIds: string[] = [];
  
  // Parse the HTML
  const doc = new DOMParser().parseFromString(html, 'text/html');
  
  // Find all iframes that are YouTube embeds
  const iframes = doc.querySelectorAll('iframe');
  iframes.forEach(iframe => {
    const src = iframe.getAttribute('src') || '';
    if (isYouTubeUrl(src) || src.includes('youtube.com/embed') || src.includes('youtube-nocookie.com/embed')) {
      // Extract video ID from the embed URL
      const videoId = extractYouTubeId(src);
      if (videoId && !youtubeIds.includes(videoId)) {
        youtubeIds.push(videoId);
      }
      
      // Remove the iframe
      // Also check if parent is a div wrapper and remove it too
      const parent = iframe.parentElement;
      if (parent && (
        parent.tagName === 'DIV' && parent.children.length === 1 ||
        parent.tagName === 'P' && parent.children.length === 1 && !parent.textContent?.trim() ||
        parent.tagName === 'FIGURE'
      )) {
        parent.remove();
      } else {
        iframe.remove();
      }
    }
  });
  
  // Also look for object/embed tags that might contain YouTube
  const objects = doc.querySelectorAll('object, embed');
  objects.forEach(obj => {
    const data = obj.getAttribute('data') || obj.getAttribute('src') || '';
    if (isYouTubeUrl(data) || data.includes('youtube.com')) {
      const videoId = extractYouTubeId(data);
      if (videoId && !youtubeIds.includes(videoId)) {
        youtubeIds.push(videoId);
      }
      
      const parent = obj.parentElement;
      if (parent && parent.tagName === 'OBJECT' && parent.children.length <= 2) {
        parent.remove();
      } else if (parent && parent.children.length === 1) {
        parent.remove();
      } else {
        obj.remove();
      }
    }
  });
  
  return { html: doc.body.innerHTML, youtubeIds };
}

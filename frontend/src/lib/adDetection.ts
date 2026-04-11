/**
 * Ad Detection Module
 * Heuristic-based detection of full-page advertisements in PDF magazines.
 *
 * Analyzes each page using signals available from pdf.js (text content,
 * operator list, annotations) without rendering. Produces a confidence
 * score per page; pages above a threshold are classified as ads.
 *
 * Runs asynchronously in idle time so the reader UI stays responsive.
 */

import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

// ── Types ──────────────────────────────────────────────────────────────────

export interface AdSignal {
  name: string;
  score: number;    // 0–1 contribution
  weight: number;   // max points this signal can contribute
  detail?: string;
}

export interface AdAnalysis {
  pageNum: number;
  score: number;        // 0–100 composite score
  isAd: boolean;
  signals: AdSignal[];
}

export interface DetectionOptions {
  /** Score threshold (0–100) above which a page is flagged as an ad. Default: 55 */
  threshold?: number;
  /** Pages to analyze concurrently per batch. Default: 4 */
  batchSize?: number;
  /** Pages to always skip analysis for (e.g. cover). 1-based. Default: [1] */
  protectedPages?: number[];
  /** Called as pages are analyzed (for progress UI). */
  onProgress?: (analyzed: number, total: number) => void;
  /** AbortSignal to cancel detection early. */
  signal?: AbortSignal;
}

// ── Constants ──────────────────────────────────────────────────────────────

/** pdf.js operator codes we care about */
const OPS_PAINT_IMAGE = 82;       // OPS.paintImageXObject
const OPS_PAINT_JPEG = 83;        // OPS.paintJpegXObject
const OPS_PAINT_INLINE = 85;      // OPS.paintInlineImageXObject
const OPS_TRANSFORM = 12;         // OPS.transform (cm)
const IMAGE_OPS = new Set([OPS_PAINT_IMAGE, OPS_PAINT_JPEG, OPS_PAINT_INLINE]);

/** Common ad-related keywords / patterns */
const AD_KEYWORDS = [
  'advertisement', 'advertorial', 'sponsored',
  'shop now', 'buy now', 'order now', 'subscribe now',
  'available at', 'available from', 'on sale',
  'visit us', 'learn more', 'find out more',
  'scan the qr', 'scan here',
  'limited time', 'free trial', 'special offer',
  'promo code', 'use code', 'discount',
];

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s]+|[a-z0-9-]+\.(?:com|co\.uk|net|org|io|shop|store)(?:\/[^\s]*)?/i;
const TRADEMARK_PATTERN = /[®™©]/;

// ── Signal Analyzers ───────────────────────────────────────────────────────

/**
 * Signal 1: Low text density.
 * Ad pages are mostly images with very little text.
 * Returns 0–1 where 1 = very low text (strong ad signal).
 */
function analyzeTextDensity(
  textItems: Array<{ str: string; transform: number[]; width: number; height: number }>,
  pageArea: number,
): { score: number; charCount: number; detail: string } {
  const totalChars = textItems.reduce((sum, item) => sum + item.str.length, 0);

  // Normalize: a typical editorial page has 1500–3000 chars
  // An ad page typically has < 100 chars
  if (totalChars === 0) return { score: 1, charCount: 0, detail: 'No text at all' };
  if (totalChars < 30) return { score: 0.95, charCount: totalChars, detail: `Only ${totalChars} chars` };
  if (totalChars < 80) return { score: 0.8, charCount: totalChars, detail: `Very little text (${totalChars} chars)` };
  if (totalChars < 150) return { score: 0.6, charCount: totalChars, detail: `Low text (${totalChars} chars)` };
  if (totalChars < 300) return { score: 0.3, charCount: totalChars, detail: `Moderate text (${totalChars} chars)` };
  if (totalChars < 500) return { score: 0.1, charCount: totalChars, detail: `Fair text (${totalChars} chars)` };
  return { score: 0, charCount: totalChars, detail: `Editorial-level text (${totalChars} chars)` };
}

/**
 * Signal 2: Single dominant image.
 * Ad pages typically have one large full-bleed image.
 * Uses the operator list to find image paint operations and their transform matrices.
 * Returns 0–1 where 1 = single image covering >80% of page.
 */
function analyzeDominantImage(
  ops: { fnArray: number[]; argsArray: any[] },
  pageWidth: number,
  pageHeight: number,
): { score: number; detail: string } {
  const pageArea = pageWidth * pageHeight;
  const images: { width: number; height: number; area: number }[] = [];

  // Walk operator list and collect image dimensions from preceding transform matrices
  let lastTransform: number[] | null = null;

  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i];

    if (fn === OPS_TRANSFORM) {
      lastTransform = ops.argsArray[i] as number[];
    }

    if (IMAGE_OPS.has(fn) && lastTransform) {
      // Transform matrix: [a, b, c, d, e, f]
      // Image width = sqrt(a² + b²), height = sqrt(c² + d²) in PDF units
      const [a, b, c, d] = lastTransform;
      const w = Math.sqrt(a * a + b * b);
      const h = Math.sqrt(c * c + d * d);
      images.push({ width: w, height: h, area: w * h });
    }
  }

  if (images.length === 0) return { score: 0, detail: 'No images found' };

  // Find largest image
  const largest = images.reduce((max, img) => img.area > max.area ? img : max, images[0]);
  const coverage = largest.area / pageArea;

  // Scoring based on coverage and image count
  if (images.length === 1) {
    if (coverage > 0.8) return { score: 1, detail: `Single image covering ${(coverage * 100).toFixed(0)}%` };
    if (coverage > 0.6) return { score: 0.7, detail: `Single image covering ${(coverage * 100).toFixed(0)}%` };
    if (coverage > 0.4) return { score: 0.4, detail: `Single image covering ${(coverage * 100).toFixed(0)}%` };
  }

  // Multiple images with one dominant
  if (coverage > 0.7) return { score: 0.6, detail: `${images.length} images, largest covers ${(coverage * 100).toFixed(0)}%` };
  if (coverage > 0.5) return { score: 0.3, detail: `${images.length} images, largest covers ${(coverage * 100).toFixed(0)}%` };

  return { score: 0, detail: `${images.length} images, no dominant image` };
}

/**
 * Signal 3: URL presence in text.
 * Ad pages often contain bare URLs or domain names.
 * Returns 0–1.
 */
function analyzeUrlPresence(
  text: string,
  charCount: number,
): { score: number; detail: string } {
  const urls = text.match(new RegExp(URL_PATTERN.source, 'gi')) || [];

  if (urls.length === 0) return { score: 0, detail: 'No URLs' };

  // High URL-to-text ratio is a strong signal
  const urlChars = urls.join('').length;
  const ratio = charCount > 0 ? urlChars / charCount : 1;

  if (ratio > 0.3 && charCount < 200) return { score: 1, detail: `URLs dominate text (${urls.length} URLs, ratio ${(ratio * 100).toFixed(0)}%)` };
  if (urls.length >= 2 && charCount < 300) return { score: 0.8, detail: `${urls.length} URLs in sparse text` };
  if (urls.length >= 1 && charCount < 150) return { score: 0.7, detail: `URL in very sparse text` };
  if (urls.length >= 1) return { score: 0.2, detail: `${urls.length} URL(s) present` };

  return { score: 0, detail: 'No significant URL presence' };
}

/**
 * Signal 4: Missing running headers/footers.
 * Editorial pages typically have page numbers or magazine name in top/bottom 5%.
 * Returns 0–1 where 1 = no text in header/footer zones.
 */
function analyzeHeaderFooter(
  textItems: Array<{ str: string; transform: number[]; width: number; height: number }>,
  pageHeight: number,
): { score: number; detail: string } {
  if (textItems.length === 0) return { score: 0.8, detail: 'No text items to check' };

  const headerZone = pageHeight * 0.95; // top 5% (PDF y=0 is bottom)
  const footerZone = pageHeight * 0.05; // bottom 5%

  let hasHeader = false;
  let hasFooter = false;

  for (const item of textItems) {
    // transform[5] is the y position in PDF coordinates (bottom-up)
    const y = item.transform[5];
    if (y >= headerZone) hasHeader = true;
    if (y <= footerZone) hasFooter = true;
    if (hasHeader && hasFooter) break;
  }

  if (hasHeader && hasFooter) return { score: 0, detail: 'Has header and footer text' };
  if (hasHeader || hasFooter) return { score: 0.3, detail: `Missing ${hasHeader ? 'footer' : 'header'} text` };
  return { score: 0.7, detail: 'No header or footer text' };
}

/**
 * Signal 5: Ad keywords and trademarks.
 * Short text containing brand markers (®, ™) or CTA phrases.
 * Returns 0–1.
 */
function analyzeAdKeywords(
  text: string,
  charCount: number,
): { score: number; detail: string } {
  const lower = text.toLowerCase();

  const matchedKeywords = AD_KEYWORDS.filter(kw => lower.includes(kw));
  const hasTrademark = TRADEMARK_PATTERN.test(text);

  if (charCount < 50 && hasTrademark) {
    return { score: 1, detail: `Brand-only text with trademark symbols` };
  }

  if (matchedKeywords.length >= 2 && charCount < 300) {
    return { score: 0.9, detail: `Multiple ad phrases: ${matchedKeywords.join(', ')}` };
  }

  if (matchedKeywords.length >= 1 && charCount < 200) {
    return { score: 0.7, detail: `Ad phrase: "${matchedKeywords[0]}"` };
  }

  if (hasTrademark && charCount < 200) {
    return { score: 0.5, detail: 'Trademark symbols in sparse text' };
  }

  if (matchedKeywords.length >= 1) {
    return { score: 0.2, detail: `Ad phrase in normal text: "${matchedKeywords[0]}"` };
  }

  return { score: 0, detail: 'No ad keywords' };
}

/**
 * Signal 6: Full-page link annotations.
 * Ads often have a single clickable link covering most of the page.
 * Returns 0–1.
 */
function analyzeAnnotations(
  annotations: Array<{ subtype: string; rect?: number[] }>,
  pageWidth: number,
  pageHeight: number,
): { score: number; detail: string } {
  const pageArea = pageWidth * pageHeight;
  const links = annotations.filter(a => a.subtype === 'Link' && a.rect);

  if (links.length === 0) return { score: 0, detail: 'No link annotations' };

  // Find the largest link
  let maxLinkArea = 0;
  for (const link of links) {
    if (!link.rect) continue;
    const [x1, y1, x2, y2] = link.rect;
    const area = Math.abs(x2 - x1) * Math.abs(y2 - y1);
    maxLinkArea = Math.max(maxLinkArea, area);
  }

  const coverage = maxLinkArea / pageArea;

  if (coverage > 0.6) return { score: 1, detail: `Full-page link (${(coverage * 100).toFixed(0)}% coverage)` };
  if (coverage > 0.3) return { score: 0.5, detail: `Large link annotation (${(coverage * 100).toFixed(0)}% coverage)` };
  if (links.length >= 3) return { score: 0.3, detail: `${links.length} link annotations` };

  return { score: 0.1, detail: `${links.length} small link(s)` };
}

// ── Main Analysis ──────────────────────────────────────────────────────────

/** Signal weights (must sum to 100) */
const WEIGHTS = {
  textDensity: 30,
  dominantImage: 20,
  urlPresence: 15,
  headerFooter: 10,
  adKeywords: 15,
  annotations: 10,
} as const;

/**
 * Analyze a single PDF page for ad signals.
 * Does NOT render the page — only uses lightweight pdf.js APIs.
 */
export async function analyzePage(page: PDFPageProxy): Promise<AdAnalysis> {
  const pageNum = page.pageNumber;
  const viewport = page.getViewport({ scale: 1 });
  const pageWidth = viewport.width;
  const pageHeight = viewport.height;
  const pageArea = pageWidth * pageHeight;

  // Fetch all data in parallel
  const [textContent, opList, annotations] = await Promise.all([
    page.getTextContent(),
    page.getOperatorList(),
    page.getAnnotations(),
  ]);

  // Prepare text
  const textItems = (textContent.items as Array<{
    str: string;
    transform: number[];
    width: number;
    height: number;
  }>).filter(item => item.str.trim().length > 0);
  const fullText = textItems.map(item => item.str).join(' ');

  // Run all signal analyzers
  const textDensityResult = analyzeTextDensity(textItems, pageArea);
  const dominantImageResult = analyzeDominantImage(opList, pageWidth, pageHeight);
  const urlResult = analyzeUrlPresence(fullText, textDensityResult.charCount);
  const headerFooterResult = analyzeHeaderFooter(textItems, pageHeight);
  const keywordResult = analyzeAdKeywords(fullText, textDensityResult.charCount);
  const annotationResult = analyzeAnnotations(annotations, pageWidth, pageHeight);

  const signals: AdSignal[] = [
    { name: 'Text density', score: textDensityResult.score, weight: WEIGHTS.textDensity, detail: textDensityResult.detail },
    { name: 'Dominant image', score: dominantImageResult.score, weight: WEIGHTS.dominantImage, detail: dominantImageResult.detail },
    { name: 'URL presence', score: urlResult.score, weight: WEIGHTS.urlPresence, detail: urlResult.detail },
    { name: 'Header/footer', score: headerFooterResult.score, weight: WEIGHTS.headerFooter, detail: headerFooterResult.detail },
    { name: 'Ad keywords', score: keywordResult.score, weight: WEIGHTS.adKeywords, detail: keywordResult.detail },
    { name: 'Link annotations', score: annotationResult.score, weight: WEIGHTS.annotations, detail: annotationResult.detail },
  ];

  // Composite score: weighted sum
  const score = signals.reduce((sum, s) => sum + s.score * s.weight, 0);

  return {
    pageNum,
    score: Math.round(score * 10) / 10,
    isAd: false, // caller sets this based on threshold
    signals,
  };
}

/**
 * Yield to the main thread between batches.
 * Uses requestIdleCallback where available, falls back to setTimeout.
 */
function yieldToMain(): Promise<void> {
  return new Promise(resolve => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(() => resolve(), { timeout: 100 });
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Detect ad pages across an entire PDF document.
 * Returns a Map of pageNum → AdAnalysis for pages classified as ads.
 * Non-ad pages are not included in the result (but all pages are analyzed).
 */
export async function detectAdPages(
  pdf: PDFDocumentProxy,
  opts: DetectionOptions = {},
): Promise<{ adPages: Set<number>; analyses: Map<number, AdAnalysis> }> {
  const {
    threshold = 55,
    batchSize = 4,
    protectedPages = [1],
    onProgress,
    signal,
  } = opts;

  const allAnalyses = new Map<number, AdAnalysis>();
  const adPages = new Set<number>();
  const protectedSet = new Set(protectedPages);

  let analyzed = 0;
  const total = pdf.numPages;

  for (let start = 1; start <= total; start += batchSize) {
    if (signal?.aborted) break;

    const end = Math.min(start + batchSize - 1, total);
    const pageNums = Array.from({ length: end - start + 1 }, (_, i) => start + i);

    // Analyze batch in parallel
    const results = await Promise.all(
      pageNums.map(async (pageNum) => {
        if (protectedSet.has(pageNum)) {
          return {
            pageNum,
            score: 0,
            isAd: false,
            signals: [],
          } satisfies AdAnalysis;
        }

        const page = await pdf.getPage(pageNum);
        return analyzePage(page);
      }),
    );

    for (const analysis of results) {
      analysis.isAd = !protectedSet.has(analysis.pageNum) && analysis.score >= threshold;
      allAnalyses.set(analysis.pageNum, analysis);
      if (analysis.isAd) {
        adPages.add(analysis.pageNum);
      }
    }

    analyzed += pageNums.length;
    onProgress?.(Math.min(analyzed, total), total);

    // Yield between batches to keep the UI responsive
    if (start + batchSize <= total) {
      await yieldToMain();
    }
  }

  return { adPages, analyses: allAnalyses };
}

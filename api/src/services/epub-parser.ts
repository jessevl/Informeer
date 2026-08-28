/**
 * EPUB Parser Service
 *
 * Extracts metadata, cover image, and table of contents from EPUB files.
 * EPUBs are ZIP archives containing XML documents — no heavy dependencies needed.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { log } from '../lib/logger.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EpubMetadata {
  title: string;
  author: string;
  publisher: string;
  language: string;
  description: string;
  isbn: string;
  tags: string[];
  /** Any additional metadata as key/value pairs */
  extra: Record<string, string>;
}

export interface EpubTocEntry {
  title: string;
  href: string;
  children?: EpubTocEntry[];
}

export interface ParsedEpub {
  metadata: EpubMetadata;
  toc: EpubTocEntry[];
  coverImageData: Buffer | null;
  coverMimeType: string;
}

// ---------------------------------------------------------------------------
// XML helpers (lightweight, no external dependency)
// ---------------------------------------------------------------------------

/** Escape a string for safe interpolation into a RegExp. */
function reEscape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Optional namespace prefix — the `dc:` in `<dc:title>`. */
const NS = '(?:[A-Za-z0-9_.-]+:)?';

/**
 * Pattern source for an opening tag named exactly `tag`.
 *
 * The `(?=[\s/>])` lookahead is load-bearing: without it `<rootfile` also
 * matches the `<rootfiles>` wrapper, which carries none of the attributes
 * and — being first in the document — shadows the element we actually want.
 */
function openTagSrc(tag: string): string {
  return `<${NS}${reEscape(tag)}(?=[\\s/>])[^>]*>`;
}

/** Decode the predefined XML entities plus numeric character references. */
function decodeEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** Parse one tag's attributes into a map keyed by lowercased name. */
function parseAttrs(tagXml: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tagXml)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

/** Every opening tag named `tag`, as attribute maps. */
function xmlTags(xml: string, tag: string): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  const re = new RegExp(openTagSrc(tag), 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) out.push(parseAttrs(m[0]));
  return out;
}

/** Extract text content from an XML tag. Returns first match or empty string. */
function xmlText(xml: string, tag: string): string {
  const re = new RegExp(`${openTagSrc(tag)}([\\s\\S]*?)</${NS}${reEscape(tag)}\\s*>`, 'i');
  const m = xml.match(re);
  return m?.[1] ? decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim() : '';
}

/** Extract all matches of a tag's text content */
function xmlTextAll(xml: string, tag: string): string[] {
  const re = new RegExp(`${openTagSrc(tag)}([\\s\\S]*?)</${NS}${reEscape(tag)}\\s*>`, 'gi');
  const results: string[] = [];
  let m;
  while ((m = re.exec(xml)) !== null) {
    const text = decodeEntities(m[1].replace(/<[^>]*>/g, '')).trim();
    if (text) results.push(text);
  }
  return results;
}

/**
 * Value of `attr` on the first `<tag>` that actually carries it.
 *
 * Scanning every match rather than only the first means a wrapper element
 * without the attribute can't shadow the real one.
 */
function xmlAttr(xml: string, tag: string, attr: string): string {
  for (const attrs of xmlTags(xml, tag)) {
    const v = attrs[attr.toLowerCase()];
    if (v) return v;
  }
  return '';
}

// ---------------------------------------------------------------------------
// ZIP path resolution
// ---------------------------------------------------------------------------

function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/** Collapse `.` and `..` segments so the result matches a ZIP entry name. */
function normalizePath(p: string): string {
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (!seg || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

/**
 * Resolve a manifest href to its ZIP entry.
 *
 * Hrefs are URL-encoded and relative to the OPF while ZIP entry names are raw
 * and archive-absolute, so plain concatenation misses on any path containing a
 * space, an escaped character, or a `..` segment.
 */
function zipLookup(
  entries: Map<string, Uint8Array>,
  opfDir: string,
  href: string,
): Uint8Array | null {
  const bare = href.split('#')[0].split('?')[0];
  const variants = new Set<string>();
  for (const h of [bare, safeDecode(bare)]) {
    variants.add(normalizePath(opfDir + h));
    variants.add(normalizePath(h));
  }
  for (const v of variants) {
    const hit = entries.get(v);
    if (hit?.length) return hit;
  }

  // Last resort: match on basename, case-insensitively.
  const base = (safeDecode(bare).split('/').pop() || '').toLowerCase();
  if (base) {
    for (const [path, data] of entries) {
      const lower = path.toLowerCase();
      if ((lower === base || lower.endsWith('/' + base)) && data.length) return data;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// EPUB Parsing
// ---------------------------------------------------------------------------

/**
 * Parse an EPUB file from disk and extract metadata, TOC, and cover image.
 *
 * Uses Bun's native Zip support via `Bun.file()` + JSZip-like approach:
 * EPUBs are just ZIP files with a specific structure.
 */
export async function parseEpub(epubPath: string): Promise<ParsedEpub> {
  const zipData = readFileSync(epubPath);
  const entries = await readZipEntries(zipData);

  // 1. Find the rootfile from META-INF/container.xml
  const containerXml = entries.get('META-INF/container.xml');
  if (!containerXml) {
    throw new Error('Invalid EPUB: missing META-INF/container.xml');
  }
  
  const containerStr = new TextDecoder().decode(containerXml);
  const rootfilePath = xmlAttr(containerStr, 'rootfile', 'full-path');
  if (!rootfilePath) {
    throw new Error('Invalid EPUB: no rootfile path in container.xml');
  }

  // 2. Parse the OPF (content.opf) file
  const opfData = entries.get(rootfilePath);
  if (!opfData) {
    throw new Error(`Invalid EPUB: missing rootfile ${rootfilePath}`);
  }
  
  const opfStr = new TextDecoder().decode(opfData);
  const opfDir = rootfilePath.includes('/') ? rootfilePath.substring(0, rootfilePath.lastIndexOf('/') + 1) : '';

  // 3. Extract metadata
  const metadata = extractMetadata(opfStr);

  // 4. Extract TOC
  const toc = extractToc(opfStr, entries, opfDir);

  // 5. Extract cover image
  const { coverData, coverMimeType } = extractCover(opfStr, entries, opfDir);

  return {
    metadata,
    toc,
    coverImageData: coverData,
    coverMimeType,
  };
}

function extractMetadata(opfXml: string): EpubMetadata {
  // Extract the <metadata> section
  const metaMatch = opfXml.match(/<metadata[^>]*>([\s\S]*?)<\/metadata>/i);
  const metaSection = metaMatch?.[1] || opfXml;

  const title = xmlText(metaSection, 'title') || 'Untitled';
  const author = xmlText(metaSection, 'creator') || '';
  const publisher = xmlText(metaSection, 'publisher') || '';
  const language = xmlText(metaSection, 'language') || '';
  const description = xmlText(metaSection, 'description') || '';
  const tags = xmlTextAll(metaSection, 'subject');

  // ISBN: look in <dc:identifier> with opf:scheme="ISBN" or text containing ISBN pattern
  let isbn = '';
  const identifiers = xmlTextAll(metaSection, 'identifier');
  for (const id of identifiers) {
    const cleaned = id.replace(/[-\s]/g, '');
    if (/^(97[89])?\d{9}[\dXx]$/.test(cleaned)) {
      isbn = id;
      break;
    }
  }

  return {
    title,
    author,
    publisher,
    language,
    description,
    isbn,
    tags,
    extra: {},
  };
}

function extractToc(
  opfXml: string,
  zipEntries: Map<string, Uint8Array>,
  opfDir: string,
): EpubTocEntry[] {
  // Try NCX-based TOC first (EPUB 2)
  const ncxId = findNcxId(opfXml);
  if (ncxId) {
    const ncxHref = findManifestHref(opfXml, ncxId);
    if (ncxHref) {
      const ncxData = zipLookup(zipEntries, opfDir, ncxHref);
      if (ncxData) {
        return parseNcxNavPoints(new TextDecoder().decode(ncxData));
      }
    }
  }

  // Try nav document (EPUB 3)
  const navHref = findNavHref(opfXml);
  if (navHref) {
    const navData = zipLookup(zipEntries, opfDir, navHref);
    if (navData) {
      return parseNavToc(new TextDecoder().decode(navData));
    }
  }

  return [];
}

/** True if a manifest item declares the given space-separated property. */
function hasProperty(item: Record<string, string>, prop: string): boolean {
  return (item.properties || '').split(/\s+/).includes(prop);
}

function findNcxId(opfXml: string): string | null {
  // <spine toc="ncx">, else the manifest item declaring the NCX media type
  const spineToc = xmlTags(opfXml, 'spine')[0]?.toc;
  if (spineToc) return spineToc;

  const ncx = xmlTags(opfXml, 'item')
    .find(i => i['media-type'] === 'application/x-dtbncx+xml');
  return ncx?.id || null;
}

function findManifestHref(opfXml: string, id: string): string | null {
  return xmlTags(opfXml, 'item').find(i => i.id === id)?.href || null;
}

function findNavHref(opfXml: string): string | null {
  // EPUB 3 nav document declares properties="nav"
  return xmlTags(opfXml, 'item').find(i => hasProperty(i, 'nav'))?.href || null;
}

function parseNcxNavPoints(ncxXml: string): EpubTocEntry[] {
  const entries: EpubTocEntry[] = [];
  // Simple extraction of navPoints
  const navPointRe = /<navPoint[^>]*>[\s\S]*?<text>([^<]*)<\/text>[\s\S]*?<content[^>]+src="([^"]+)"[^>]*\/?>/gi;
  let m;
  while ((m = navPointRe.exec(ncxXml)) !== null) {
    entries.push({
      title: m[1].trim(),
      href: m[2],
    });
  }
  return entries;
}

function parseNavToc(navHtml: string): EpubTocEntry[] {
  const entries: EpubTocEntry[] = [];
  // Look for <a href="...">...</a> inside <nav epub:type="toc">
  const tocSection = navHtml.match(/<nav[^>]*epub:type="toc"[^>]*>([\s\S]*?)<\/nav>/i);
  const section = tocSection?.[1] || navHtml;
  
  const linkRe = /<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = linkRe.exec(section)) !== null) {
    entries.push({
      title: m[2].trim(),
      href: m[1],
    });
  }
  return entries;
}

function extractCover(
  opfXml: string,
  zipEntries: Map<string, Uint8Array>,
  opfDir: string,
): { coverData: Buffer | null; coverMimeType: string } {
  const items = xmlTags(opfXml, 'item');
  const isImage = (i: Record<string, string>) =>
    (i['media-type'] || '').startsWith('image/')
    || IMAGE_EXT_RE.test(i.href || '');

  // Ordered best-guess hrefs. Each is tried against the archive in turn, so a
  // manifest entry pointing at a file that isn't actually there falls through
  // to the next candidate rather than aborting the search.
  const candidates: string[] = [];

  // Strategy 1: <meta name="cover" content="<manifest-id>"/> (EPUB 2)
  const coverId = xmlTags(opfXml, 'meta')
    .find(m => (m.name || '').toLowerCase() === 'cover')?.content;
  if (coverId) {
    const href = items.find(i => i.id === coverId)?.href;
    if (href) candidates.push(href);
  }

  // Strategy 2: manifest item with properties="cover-image" (EPUB 3)
  const propCover = items.find(i => hasProperty(i, 'cover-image'))?.href;
  if (propCover) candidates.push(propCover);

  // Strategy 3: a manifest image whose id or href merely looks like a cover
  for (const i of items) {
    if (isImage(i) && (/cover/i.test(i.id || '') || /cover/i.test(i.href || ''))) {
      candidates.push(i.href);
    }
  }

  for (const href of candidates) {
    if (!href) continue;
    const data = zipLookup(zipEntries, opfDir, href);
    if (data?.length) {
      return { coverData: Buffer.from(data), coverMimeType: guessMimeType(href) };
    }
  }

  // Strategy 4: any cover-ish image anywhere in the archive, ignoring the manifest
  for (const [path, data] of zipEntries) {
    if (/cover/i.test(path) && IMAGE_EXT_RE.test(path) && data.length) {
      return { coverData: Buffer.from(data), coverMimeType: guessMimeType(path) };
    }
  }

  return { coverData: null, coverMimeType: '' };
}

/**
 * Raster image extensions.
 *
 * SVG is deliberately excluded: an EPUB `cover.svg` is nearly always a wrapper
 * that references the real bitmap, so picking it up and rasterising it yields
 * a blank image rather than the cover.
 */
const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp)$/i;

function guessMimeType(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

// ---------------------------------------------------------------------------
// ZIP reading using Bun's built-in decompression
// ---------------------------------------------------------------------------

/**
 * Read all entries from a ZIP buffer into a Map<path, data>.
 * Uses the system `unzip` if available, otherwise a minimal ZIP parser.
 */
async function readZipEntries(zipBuffer: Uint8Array): Promise<Map<string, Uint8Array>> {
  const entries = new Map<string, Uint8Array>();
  
  // Use Bun's built-in zip reading via the decompress utility
  // Parse the ZIP central directory manually for maximum compatibility
  const view = new DataView(zipBuffer.buffer, zipBuffer.byteOffset, zipBuffer.byteLength);
  
  // Find End of Central Directory record (search backwards)
  let eocdOffset = -1;
  for (let i = zipBuffer.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  
  if (eocdOffset === -1) {
    throw new Error('Invalid ZIP: EOCD not found');
  }

  const centralDirOffset = view.getUint32(eocdOffset + 16, true);
  const centralDirEntries = view.getUint16(eocdOffset + 10, true);
  
  let offset = centralDirOffset;
  for (let i = 0; i < centralDirEntries; i++) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraFieldLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    
    const fileName = new TextDecoder().decode(
      zipBuffer.subarray(offset + 46, offset + 46 + fileNameLength)
    );
    
    offset += 46 + fileNameLength + extraFieldLength + commentLength;
    
    // Skip directories
    if (fileName.endsWith('/')) continue;
    
    // Read from local file header
    const localExtra = view.getUint16(localHeaderOffset + 28, true);
    const localNameLen = view.getUint16(localHeaderOffset + 26, true);
    const dataOffset = localHeaderOffset + 30 + localNameLen + localExtra;
    
    const rawData = zipBuffer.subarray(dataOffset, dataOffset + compressedSize);
    
    if (compressionMethod === 0) {
      // Stored (no compression)
      entries.set(fileName, new Uint8Array(rawData.buffer as ArrayBuffer, rawData.byteOffset, rawData.byteLength));
    } else if (compressionMethod === 8) {
      // Deflate — use Bun's built-in decompression
      try {
        const decompressed = Bun.inflateSync(new Uint8Array(rawData.buffer as ArrayBuffer, rawData.byteOffset, rawData.byteLength));
        entries.set(fileName, new Uint8Array(decompressed));
      } catch (err) {
        log.debug(`Failed to decompress ${fileName}: ${err}`);
      }
    }
  }
  
  return entries;
}

/**
 * Save a cover image extracted from an EPUB to disk.
 */
export async function saveCoverImage(
  coverData: Buffer,
  coverMimeType: string,
  outputDir: string,
  bookId: number,
): Promise<string> {
  mkdirSync(outputDir, { recursive: true });

  // Normalise to JPEG at up to 1024px wide, so the cover route only ever has
  // one format to serve and oversized art doesn't bloat the library view.
  try {
    const resized = await sharp(coverData)
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    const jpgPath = join(outputDir, `${bookId}.jpg`);
    writeFileSync(jpgPath, resized);
    return jpgPath;
  } catch (err: any) {
    log.debug(`[epub-parser] Sharp re-encode failed, saving original: ${err.message}`);
    const ext = coverMimeType.includes('png') ? 'png'
      : coverMimeType.includes('gif') ? 'gif'
      : coverMimeType.includes('webp') ? 'webp'
      : 'jpg';
    const coverPath = join(outputDir, `${bookId}.${ext}`);
    writeFileSync(coverPath, coverData);
    return coverPath;
  }
}

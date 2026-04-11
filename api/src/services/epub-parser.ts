/**
 * EPUB Parser Service
 *
 * Extracts metadata, cover image, and table of contents from EPUB files.
 * EPUBs are ZIP archives containing XML documents — no heavy dependencies needed.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
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

/** Extract text content from an XML tag. Returns first match or empty string. */
function xmlText(xml: string, tag: string): string {
  // Handle both <tag>text</tag> and <ns:tag>text</ns:tag>
  const patterns = [
    new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'i'),
    new RegExp(`<[a-z]+:${tag}[^>]*>([^<]*)</[a-z]+:${tag}>`, 'i'),
  ];
  for (const re of patterns) {
    const m = xml.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return '';
}

/** Extract all matches of a tag's text content */
function xmlTextAll(xml: string, tag: string): string[] {
  const results: string[] = [];
  const patterns = [
    new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'gi'),
    new RegExp(`<[a-z]+:${tag}[^>]*>([^<]*)</[a-z]+:${tag}>`, 'gi'),
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(xml)) !== null) {
      if (m[1]?.trim()) results.push(m[1].trim());
    }
  }
  return results;
}

/** Extract an attribute value from an XML tag */
function xmlAttr(xml: string, tag: string, attr: string): string {
  const tagMatch = xml.match(new RegExp(`<${tag}[^>]*>`, 'i'));
  if (!tagMatch) return '';
  const attrMatch = tagMatch[0].match(new RegExp(`${attr}\\s*=\\s*"([^"]*)"`, 'i'));
  return attrMatch?.[1] || '';
}

/** Find all tags matching a pattern and return their outer XML */
function xmlFindAll(xml: string, tag: string): string[] {
  const results: string[] = [];
  // Self-closing and regular tags
  const re = new RegExp(`<${tag}[^>]*/?>(?:[\\s\\S]*?</${tag}>)?`, 'gi');
  let m;
  while ((m = re.exec(xml)) !== null) {
    results.push(m[0]);
  }
  return results;
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
  
  // Use Bun's native ZIP reading
  const blob = new Blob([zipData]);
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
      const ncxPath = opfDir + ncxHref;
      const ncxData = zipEntries.get(ncxPath);
      if (ncxData) {
        const ncxStr = new TextDecoder().decode(ncxData);
        return parseNcxNavPoints(ncxStr);
      }
    }
  }

  // Try nav document (EPUB 3)
  const navHref = findNavHref(opfXml);
  if (navHref) {
    const navPath = opfDir + navHref;
    const navData = zipEntries.get(navPath);
    if (navData) {
      const navStr = new TextDecoder().decode(navData);
      return parseNavToc(navStr);
    }
  }

  return [];
}

function findNcxId(opfXml: string): string | null {
  // Look for <spine toc="ncx"> or manifest item with media-type="application/x-dtbncx+xml"
  const spineMatch = opfXml.match(/<spine[^>]+toc="([^"]+)"/i);
  if (spineMatch) return spineMatch[1];
  
  const ncxMatch = opfXml.match(/<item[^>]+media-type="application\/x-dtbncx\+xml"[^>]+id="([^"]+)"/i)
    || opfXml.match(/<item[^>]+id="([^"]+)"[^>]+media-type="application\/x-dtbncx\+xml"/i);
  return ncxMatch?.[1] || null;
}

function findManifestHref(opfXml: string, id: string): string | null {
  const re = new RegExp(`<item[^>]+id="${id}"[^>]+href="([^"]+)"`, 'i');
  const m = opfXml.match(re);
  if (m) return m[1];
  
  const re2 = new RegExp(`<item[^>]+href="([^"]+)"[^>]+id="${id}"`, 'i');
  const m2 = opfXml.match(re2);
  return m2?.[1] || null;
}

function findNavHref(opfXml: string): string | null {
  // EPUB 3 nav document has properties="nav"
  const navMatch = opfXml.match(/<item[^>]+properties="[^"]*nav[^"]*"[^>]+href="([^"]+)"/i)
    || opfXml.match(/<item[^>]+href="([^"]+)"[^>]+properties="[^"]*nav[^"]*"/i);
  return navMatch?.[1] || null;
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
  // Strategy 1: <meta name="cover" content="cover-image-id"/>
  const coverMetaMatch = opfXml.match(/<meta[^>]+name="cover"[^>]+content="([^"]+)"/i)
    || opfXml.match(/<meta[^>]+content="([^"]+)"[^>]+name="cover"/i);
  
  if (coverMetaMatch) {
    const coverId = coverMetaMatch[1];
    const href = findManifestHref(opfXml, coverId);
    if (href) {
      const coverPath = opfDir + href;
      const data = zipEntries.get(coverPath);
      if (data) {
        const mime = guessMimeType(href);
        return { coverData: Buffer.from(data), coverMimeType: mime };
      }
    }
  }

  // Strategy 2: manifest item with properties="cover-image" (EPUB 3)
  const coverItemMatch = opfXml.match(/<item[^>]+properties="[^"]*cover-image[^"]*"[^>]+href="([^"]+)"/i)
    || opfXml.match(/<item[^>]+href="([^"]+)"[^>]+properties="[^"]*cover-image[^"]*"/i);
  
  if (coverItemMatch) {
    const coverPath = opfDir + coverItemMatch[1];
    const data = zipEntries.get(coverPath);
    if (data) {
      const mime = guessMimeType(coverItemMatch[1]);
      return { coverData: Buffer.from(data), coverMimeType: mime };
    }
  }

  // Strategy 3: look for common cover file names
  for (const [path, data] of zipEntries) {
    const lower = path.toLowerCase();
    if (
      (lower.includes('cover') && (lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.png')))
    ) {
      return { coverData: Buffer.from(data), coverMimeType: guessMimeType(path) };
    }
  }

  return { coverData: null, coverMimeType: '' };
}

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
  const ext = coverMimeType.includes('png') ? 'png' 
    : coverMimeType.includes('gif') ? 'gif' 
    : 'jpg';
  const coverPath = join(outputDir, `${bookId}.${ext}`);
  mkdirSync(dirname(coverPath), { recursive: true });

  // Resize cover to 512px width for consistent quality
  try {
    const resized = await sharp(coverData)
      .resize({ width: 1024, withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
    const jpgPath = join(outputDir, `${bookId}.jpg`);
    writeFileSync(jpgPath, resized);
    return jpgPath;
  } catch (err: any) {
    log.debug(`[epub-parser] Sharp resize failed, saving original: ${err.message}`);
    writeFileSync(coverPath, coverData);
    return coverPath;
  }
}

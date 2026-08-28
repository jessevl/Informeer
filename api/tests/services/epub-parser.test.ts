import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { parseEpub } from '../../src/services/epub-parser.ts';

/**
 * Build a ZIP from stored (uncompressed) entries.
 *
 * The parser reads sizes and offsets from the central directory and never
 * verifies CRCs, so stored entries with a zero CRC exercise the real code
 * path without pulling in a compression dependency.
 */
function buildZip(files: { name: string; data: Buffer }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const f of files) {
    const nameBuf = Buffer.from(f.name, 'utf8');

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt32LE(f.data.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 10); // stored
    central.writeUInt32LE(f.data.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);

    locals.push(local, f.data);
    centrals.push(central);
    offset += local.length + f.data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...locals, centralBuf, eocd]);
}

const COVER_BYTES = Buffer.from('fake-cover-image-payload-for-testing');

let dir: string;
beforeAll(() => { dir = mkdtempSync(join(tmpdir(), 'epub-test-')); });
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

function writeEpub(name: string, files: { name: string; data: Buffer }[]): string {
  const path = join(dir, name);
  writeFileSync(path, buildZip(files));
  return path;
}

const str = (s: string) => Buffer.from(s, 'utf8');

/** Standard container.xml — note the <rootfiles> wrapper around <rootfile>. */
const CONTAINER = str(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
   <rootfiles>
      <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
   </rootfiles>
</container>`);

describe('parseEpub', () => {
  test('reads the rootfile past the <rootfiles> wrapper (EPUB 2, cover via meta)', async () => {
    const opf = str(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:title>A Test Book</dc:title>
    <dc:creator opf:role="aut">Ada Lovelace</dc:creator>
    <dc:publisher>Test House</dc:publisher>
    <dc:language>en</dc:language>
    <dc:identifier id="bookid" opf:scheme="ISBN">978-0-14-311746-9</dc:identifier>
    <dc:subject>Fiction</dc:subject>
    <dc:subject>Testing</dc:subject>
    <meta name="cover" content="cover-img"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-img" href="images/cover%20art.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine toc="ncx"/>
</package>`);

    const ncx = str(`<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/">
  <navMap>
    <navPoint id="n1"><navLabel><text>Chapter One</text></navLabel><content src="c1.xhtml"/></navPoint>
    <navPoint id="n2"><navLabel><text>Chapter Two</text></navLabel><content src="c2.xhtml"/></navPoint>
  </navMap>
</ncx>`);

    const path = writeEpub('epub2.epub', [
      { name: 'mimetype', data: str('application/epub+zip') },
      { name: 'META-INF/container.xml', data: CONTAINER },
      { name: 'OEBPS/content.opf', data: opf },
      { name: 'OEBPS/toc.ncx', data: ncx },
      // Note the space: the manifest href is percent-encoded, the entry is not.
      { name: 'OEBPS/images/cover art.jpg', data: COVER_BYTES },
    ]);

    const parsed = await parseEpub(path);

    expect(parsed.metadata.title).toBe('A Test Book');
    expect(parsed.metadata.author).toBe('Ada Lovelace');
    expect(parsed.metadata.publisher).toBe('Test House');
    expect(parsed.metadata.language).toBe('en');
    expect(parsed.metadata.isbn).toBe('978-0-14-311746-9');
    expect(parsed.metadata.tags).toEqual(['Fiction', 'Testing']);
    expect(parsed.toc.map(t => t.title)).toEqual(['Chapter One', 'Chapter Two']);
    expect(parsed.coverImageData).not.toBeNull();
    expect(Buffer.compare(parsed.coverImageData!, COVER_BYTES)).toBe(0);
    expect(parsed.coverMimeType).toBe('image/jpeg');
  });

  test('finds an EPUB 3 cover-image with reversed attribute order and single quotes', async () => {
    const opf = str(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Modern Book</dc:title>
  </metadata>
  <manifest>
    <item href='img/front.png' properties='cover-image' id='c' media-type='image/png'/>
  </manifest>
</package>`);

    const path = writeEpub('epub3.epub', [
      { name: 'META-INF/container.xml', data: CONTAINER },
      { name: 'OEBPS/content.opf', data: opf },
      { name: 'OEBPS/img/front.png', data: COVER_BYTES },
    ]);

    const parsed = await parseEpub(path);
    expect(parsed.metadata.title).toBe('Modern Book');
    expect(Buffer.compare(parsed.coverImageData!, COVER_BYTES)).toBe(0);
    expect(parsed.coverMimeType).toBe('image/png');
  });

  test('falls through to a cover-ish file when the manifest points at a missing entry', async () => {
    const opf = str(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Broken Manifest</dc:title>
    <meta name="cover" content="ghost"/>
  </metadata>
  <manifest>
    <item id="ghost" href="does/not/exist.jpg" media-type="image/jpeg"/>
  </manifest>
</package>`);

    const path = writeEpub('fallback.epub', [
      { name: 'META-INF/container.xml', data: CONTAINER },
      { name: 'OEBPS/content.opf', data: opf },
      { name: 'OEBPS/assets/cover.jpeg', data: COVER_BYTES },
    ]);

    const parsed = await parseEpub(path);
    expect(Buffer.compare(parsed.coverImageData!, COVER_BYTES)).toBe(0);
  });

  test('resolves an href that walks out of the OPF directory', async () => {
    const opf = str(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Relative</dc:title></metadata>
  <manifest>
    <item id="c" href="../shared/cover.jpg" properties="cover-image" media-type="image/jpeg"/>
  </manifest>
</package>`);

    const path = writeEpub('relative.epub', [
      { name: 'META-INF/container.xml', data: CONTAINER },
      { name: 'OEBPS/content.opf', data: opf },
      { name: 'shared/cover.jpg', data: COVER_BYTES },
    ]);

    const parsed = await parseEpub(path);
    expect(Buffer.compare(parsed.coverImageData!, COVER_BYTES)).toBe(0);
  });

  test('decodes XML entities in metadata', async () => {
    const opf = str(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Salt &amp; Pepper &#8212; A Study</dc:title>
  </metadata>
  <manifest/>
</package>`);

    const path = writeEpub('entities.epub', [
      { name: 'META-INF/container.xml', data: CONTAINER },
      { name: 'OEBPS/content.opf', data: opf },
    ]);

    const parsed = await parseEpub(path);
    expect(parsed.metadata.title).toBe('Salt & Pepper — A Study');
    expect(parsed.coverImageData).toBeNull();
  });

  test('throws a clear error when container.xml is absent', async () => {
    const path = writeEpub('bad.epub', [{ name: 'random.txt', data: str('nope') }]);
    await expect(parseEpub(path)).rejects.toThrow(/container\.xml/);
  });
});

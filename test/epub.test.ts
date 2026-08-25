import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  BookError,
  CorruptContainerError,
  EncryptedContentError,
  UnrecognizedFormatError,
  open,
} from '../src/core/index.ts';
import { epub } from '../src/formats/epub/index.ts';

const PNG_MAGIC = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

async function fixture(name: string): Promise<ArrayBuffer> {
  const bytes = await readFile(new URL(`./fixtures/epub/${name}`, import.meta.url));
  return new Uint8Array(bytes).buffer;
}

async function openFixture(name: string) {
  return open(await fixture(name), { formats: [epub] });
}

test('EPUB2 fixture decodes with metadata, spine order, and meta-name cover', async () => {
  const book = await openFixture('epub2.epub');

  assert.equal(book.metadata.title, "The Cartographer's Tide");
  assert.equal(book.metadata.author, 'Mira Voss');
  assert.equal(book.metadata.language, 'en');

  assert.deepEqual(
    book.sections.map((s) => s.id),
    ['cover-page', 'chapter-1', 'chapter-2'],
  );
  for (const section of book.sections) {
    assert.equal(section.mediaType, 'application/xhtml+xml');
  }

  const cover = book.metadata.cover;
  assert.ok(cover, 'EPUB2 <meta name="cover"> resolves to the manifest item');
  assert.equal(cover.mediaType, 'image/png');
  assert.deepEqual((await cover.load()).slice(0, 8), PNG_MAGIC);

  const chapter = book.section('chapter-1');
  assert.ok(chapter);
  const text = new TextDecoder().decode(await chapter.load());
  assert.ok(text.includes('The harbour charts were wrong'));

  assert.deepEqual(book.toc, [
    { label: 'Soundings', sectionId: 'chapter-1', children: [] },
    { label: 'Dead Reckoning', sectionId: 'chapter-2', children: [] },
  ]);
  assert.equal(book.direction, undefined);
  assert.equal(book.fixedLayout, undefined);
  assert.equal(book.section('nope'), undefined);
});

test('EPUB2 fixture exposes non-spine manifest items as resources', async () => {
  const book = await openFixture('epub2.epub');
  assert.deepEqual([...book.resources.keys()].sort(), ['cover-image', 'ncx', 'style']);
  const style = book.resources.get('style');
  assert.ok(style);
  assert.equal(style.mediaType, 'text/css');
  assert.ok(new TextDecoder().decode(await style.load()).includes('font-family'));
});

test('EPUB3 fixture decodes with DC terms, spine order, and cover-image property', async () => {
  const book = await openFixture('epub3.epub');

  assert.equal(book.metadata.title, 'Salt Meridian');
  assert.equal(book.metadata.author, 'Ilya Kovar');
  assert.equal(book.metadata.language, 'en-US');

  assert.deepEqual(
    book.sections.map((s) => s.id),
    ['c1', 'c2', 'c3'],
  );

  const cover = book.metadata.cover;
  assert.ok(cover, 'properties="cover-image" resolves the cover');
  assert.equal(cover.mediaType, 'image/png');
  assert.deepEqual((await cover.load()).slice(0, 8), PNG_MAGIC);

  const nav = book.resources.get('nav');
  assert.ok(nav, 'the nav document is a resource, not a section');

  assert.deepEqual(book.toc, [
    { label: 'The Brine Ledger', sectionId: 'c1', children: [] },
    { label: 'Forty Degrees of Longing', sectionId: 'c2', children: [] },
    { label: 'The Meridian Keeper', sectionId: 'c3', children: [] },
  ]);
});

test('EPUB3 nav document TOC keeps nesting, fragments, and inline label markup', async () => {
  const book = await openFixture('toc-nav.epub');
  assert.deepEqual(book.toc, [
    {
      label: 'Landfall',
      sectionId: 'p1',
      children: [
        { label: 'Tide Tables', sectionId: 'p1', fragment: 'tide-tables', children: [] },
        { label: 'The Inner Passage', sectionId: 'p2', children: [] },
      ],
    },
    {
      label: 'Appendices',
      sectionId: 'p3',
      children: [{ label: 'Gazetteer', sectionId: 'p3', fragment: 'gazetteer', children: [] }],
    },
  ]);
});

test('EPUB2 NCX navMap TOC keeps nesting and fragments', async () => {
  const book = await openFixture('toc-ncx.epub');
  assert.deepEqual(book.toc, [
    {
      label: 'Landfall',
      sectionId: 'p1',
      children: [{ label: 'Moorings', sectionId: 'p1', fragment: 'moorings', children: [] }],
    },
    { label: 'Interior', sectionId: 'p2', children: [] },
    { label: 'Departure', sectionId: 'p3', children: [] },
  ]);
});

test('when both nav document and NCX exist the nav document wins', async () => {
  const book = await openFixture('toc-both.epub');
  assert.equal(book.toc[0]?.label, 'Landfall');
  assert.ok(
    !JSON.stringify(book.toc).includes('NCX '),
    'no NCX label leaks into the TOC when a nav document exists',
  );
});

test('OPF in a subdirectory resolves manifest, spine, TOC, and cover hrefs', async () => {
  const book = await openFixture('opf-subdir.epub');

  assert.deepEqual(
    book.sections.map((s) => s.id),
    ['intro', 'middle'],
  );
  const intro = book.section('intro');
  assert.ok(intro);
  const introText = new TextDecoder().decode(await intro.load());
  assert.ok(introText.includes('The glassworks woke'), 'percent-encoded href resolves to the real entry');

  const cover = book.metadata.cover;
  assert.ok(cover, './images/../images/cover.png normalizes and resolves');
  assert.deepEqual((await cover.load()).slice(0, 8), PNG_MAGIC);

  const style = book.resources.get('style');
  assert.ok(style);
  assert.ok(new TextDecoder().decode(await style.load()).includes('font-family'));

  assert.deepEqual(book.toc, [
    { label: 'First Light', sectionId: 'intro', children: [] },
    { label: 'Midway', sectionId: 'middle', fragment: 'anchor', children: [] },
  ]);
});

test('Section.resolve resolves against the section directory, not the OPF directory', async () => {
  const book = await openFixture('opf-subdir.epub');
  const middle = book.section('middle');
  assert.ok(middle?.resolve, 'the EPUB decoder supplies the resolver on every section');

  // OEBPS/text/middle.xhtml + ../styles/main.css → OEBPS/styles/main.css.
  // Resolved against the OPF's OEBPS/ instead, this would miss entirely.
  const style = middle.resolve('../styles/main.css');
  assert.ok(style, '../ from the section directory reaches OEBPS/styles/');
  assert.equal(style.mediaType, 'text/css');
  assert.equal(
    new TextDecoder().decode(await style.load()),
    'body { font-family: serif; margin: 1em; }\n',
  );

  assert.equal(
    middle.resolve('styles/main.css'),
    undefined,
    'the OPF-relative form of the same href does not resolve from a section two levels down',
  );
});

test('Section.resolve returns a Resource whose bytes are the referenced entry', async () => {
  const book = await openFixture('opf-subdir.epub');
  const middle = book.section('middle');
  assert.ok(middle?.resolve);

  const plate = middle.resolve('../images/sea%20glass.png');
  assert.ok(plate, 'a percent-encoded reference decodes to the real entry name');
  assert.equal(plate.mediaType, 'image/png');
  const plateBytes = await plate.load();
  assert.deepEqual(plateBytes.slice(0, 8), PNG_MAGIC);

  const cover = book.metadata.cover;
  assert.ok(cover);
  assert.notDeepEqual(
    plateBytes,
    await cover.load(),
    'the reference lands on its own image, not merely on some image',
  );
});

test('Section.resolve falls through to spine-listed documents, which are not in resources', async () => {
  const book = await openFixture('opf-subdir.epub');
  const middle = book.section('middle');
  const intro = book.section('intro');
  assert.ok(middle?.resolve);
  assert.ok(intro);
  assert.equal(book.resources.get('intro'), undefined, 'spine items are excluded from resources');

  const target = middle.resolve('../text/first%20light.xhtml');
  assert.ok(target, 'a reference at a spine document resolves like any other manifest item');
  assert.equal(target.mediaType, 'application/xhtml+xml');
  assert.deepEqual(await target.load(), await intro.load());
});

test('Section.resolveHref maps a section-relative href to the section it names', async () => {
  const book = await openFixture('opf-subdir.epub');
  const middle = book.section('middle');
  assert.ok(middle?.resolveHref, 'the EPUB decoder supplies the href resolver on every section');

  // OEBPS/text/middle.xhtml + ../text/first light.xhtml → OEBPS/text/first light.xhtml,
  // whose manifest id is `intro` — a mapping the id/filename heuristic cannot make,
  // since the id (`intro`) shares nothing with the file name.
  assert.deepEqual(
    middle.resolveHref('../text/first%20light.xhtml'),
    { sectionId: 'intro' },
    'a cross-directory, percent-encoded href resolves to the target section id',
  );
  assert.equal(
    middle.resolveHref('https://example.invalid/elsewhere.xhtml'),
    undefined,
    'an unresolvable href is a soft miss, not a throw',
  );
});

test('Section.resolveHref resolves sibling documents by filename and carries the fragment', async () => {
  const book = await openFixture('epub3.epub');
  const c1 = book.section('c1');
  assert.ok(c1?.resolveHref, 'the EPUB3 fixture supplies the href resolver');

  // Manifest id `c1` names the file chapter-1.xhtml; a link to chapter-2.xhtml must
  // reach section `c2`, and any fragment rides along untouched.
  assert.deepEqual(c1.resolveHref('chapter-2.xhtml'), { sectionId: 'c2' });
  assert.deepEqual(c1.resolveHref('chapter-3.xhtml#tide-tables'), {
    sectionId: 'c3',
    fragment: 'tide-tables',
  });
});

test('Section.resolve returns undefined for references it cannot serve, and never throws', async () => {
  const book = await openFixture('opf-subdir.epub');
  const middle = book.section('middle');
  assert.ok(middle?.resolve);

  for (const [reference, reason] of [
    ['https://example.invalid/elsewhere.png', 'an absolute URL'],
    ['//example.invalid/elsewhere.png', 'a protocol-relative URL'],
    ['data:image/png;base64,iVBORw0KGgo=', 'a data URI'],
    ['mailto:reader@example.invalid', 'a scheme-carrying link'],
    ['#anchor', 'a fragment-only reference'],
    ['', 'an empty reference'],
    ['../images/absent.png', 'a manifest item whose zip entry is missing'],
    ['../images/undeclared.png', 'a file the manifest never declares'],
  ] as const) {
    assert.equal(middle.resolve(reference), undefined, `${reason} resolves to undefined`);
  }
});

test('Section.resolve works from a section that sits beside the OPF', async () => {
  const book = await openFixture('epub2.epub');
  const chapter = book.section('chapter-1');
  assert.ok(chapter?.resolve);

  const style = chapter.resolve('style.css');
  assert.ok(style);
  assert.equal(style.mediaType, 'text/css');
  const declared = book.resources.get('style');
  assert.ok(declared);
  assert.deepEqual(await style.load(), await declared.load());

  const cover = chapter.resolve('./cover.png');
  assert.ok(cover, 'a ./-prefixed reference normalizes');
  assert.deepEqual((await cover.load()).slice(0, 8), PNG_MAGIC);
});

test('an unsupported spine item follows its manifest fallback chain to usable content', async () => {
  const book = await openFixture('fallback.epub');
  const section = book.section('exotic');
  assert.ok(section, 'the spine item keeps its own id');
  assert.equal(section.mediaType, 'application/xhtml+xml');
  const text = new TextDecoder().decode(await section.load());
  assert.ok(text.includes('Every room was let twice'), 'the chain lands on the xhtml fallback');
});

test('a circular manifest fallback chain raises CorruptContainerError, not a hang', async () => {
  await assert.rejects(
    openFixture('fallback-circular.epub'),
    (error: unknown) => error instanceof CorruptContainerError && error instanceof BookError,
  );
});

test('manifest properties drive nav discovery, cover discovery, and the scripted flag', async () => {
  const book = await openFixture('properties.epub');

  const cover = book.metadata.cover;
  assert.ok(cover, 'properties="cover-image" finds the cover');
  assert.deepEqual((await cover.load()).slice(0, 8), PNG_MAGIC);

  assert.deepEqual(book.toc, [
    { label: 'The Fixed Stars', sectionId: 'static', children: [] },
    { label: 'The Moving Parts', sectionId: 'interactive', children: [] },
  ]);

  assert.equal(book.section('static')?.scripted, undefined);
  assert.equal(book.section('interactive')?.scripted, true);
});

test('page-progression-direction="rtl" surfaces as book.direction', async () => {
  const book = await openFixture('rtl.epub');
  assert.equal(book.direction, 'rtl');
  assert.equal(book.fixedLayout, undefined);
});

test('rendition:layout pre-paginated surfaces as book.fixedLayout and nothing else', async () => {
  const book = await openFixture('fixed-layout.epub');
  assert.equal(book.fixedLayout, true);
  assert.equal(book.direction, undefined);
  assert.deepEqual(
    book.sections.map((s) => s.id),
    ['p1'],
  );
  const text = new TextDecoder().decode(await book.sections[0]!.load());
  assert.ok(text.includes('fixed plate'));
});

test('a trailing newline in the mimetype entry is tolerated', async () => {
  const book = await openFixture('mimetype-newline.epub');
  assert.equal(book.metadata.title, "The Cartographer's Tide");
});

for (const [name, reason] of [
  ['no-container.epub', 'missing META-INF/container.xml'],
  ['container-not-xml.epub', 'malformed container.xml'],
  ['container-no-rootfile.epub', 'container.xml without a rootfile'],
  ['missing-opf.epub', 'container.xml pointing at a missing OPF'],
  ['opf-not-xml.epub', 'malformed OPF'],
  ['opf-no-spine.epub', 'OPF without a spine'],
] as const) {
  test(`${reason} raises CorruptContainerError`, async () => {
    await assert.rejects(
      openFixture(name),
      (error: unknown) => error instanceof CorruptContainerError && error instanceof BookError,
    );
  });
}

test('an EPUB with encrypted entries raises EncryptedContentError', async () => {
  await assert.rejects(
    openFixture('encrypted.epub'),
    (error: unknown) => error instanceof EncryptedContentError && error instanceof BookError,
  );
});

test('a plain zip without a mimetype entry is not claimed', async () => {
  await assert.rejects(openFixture('not-epub.zip'), UnrecognizedFormatError);
});

test('a zip whose mimetype entry is not application/epub+zip is not claimed', async () => {
  await assert.rejects(openFixture('wrong-mimetype.epub'), UnrecognizedFormatError);
});

test('a plain text file is not claimed', async () => {
  const bytes = new TextEncoder().encode('This is not an ebook, just a note to self.');
  await assert.rejects(open(bytes.buffer, { formats: [epub] }), UnrecognizedFormatError);
});

test('a truncated zip that sniffs as nothing falls through cleanly', async () => {
  const head = new Uint8Array(await fixture('epub2.epub')).slice(0, 3);
  await assert.rejects(open(head.buffer, { formats: [epub] }), UnrecognizedFormatError);
});

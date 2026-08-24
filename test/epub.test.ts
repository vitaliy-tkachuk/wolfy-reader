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

  assert.deepEqual(book.toc, []);
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

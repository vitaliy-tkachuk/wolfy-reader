import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { open, toByteSource, UnrecognizedFormatError, type Book } from '../src/core/index.ts';
import { epub, text } from '../src/formats/index.ts';

const corpusDir = new URL('./corpus/', import.meta.url);

function bytesOf(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer;
}

async function openText(source: ArrayBuffer): Promise<Book> {
  // Registry order mirrors the demo: richer formats first, text last-resort.
  return open(source, { formats: [epub, text] });
}

async function sectionHtml(book: Book, index: number): Promise<string> {
  return new TextDecoder().decode(await book.sections[index]!.load());
}

const SAMPLE = [
  'Title: A Small Book',
  'Author: A. Writer',
  '',
  'CHAPTER I',
  '',
  'The first paragraph runs across',
  'two source lines but is one paragraph.',
  '',
  'The second paragraph stands alone.',
  '',
  'CHAPTER II',
  '',
  'A paragraph in the second chapter.',
].join('\n');

test('a headinged text splits into sections with a TOC and reads as XHTML', async () => {
  const book = await openText(bytesOf(SAMPLE));

  // Two chapter headings ⇒ two sections; the metadata block is consumed into
  // section content but the split is driven by the headings.
  const headings = book.toc.map((t) => t.label);
  assert.deepEqual(headings, ['CHAPTER I', 'CHAPTER II']);
  for (const entry of book.toc) {
    assert.ok(book.section(entry.sectionId), `TOC entry "${entry.label}" targets a real section`);
    assert.deepEqual(entry.children, []);
  }

  const first = await sectionHtml(book, book.sections.findIndex((s) => s.id === book.toc[0]!.sectionId));
  assert.ok(first.includes('<h2>CHAPTER I</h2>'), 'the heading renders as an h2');
  assert.ok(
    first.includes('The first paragraph runs across two source lines but is one paragraph.'),
    'soft-wrapped lines collapse into one paragraph',
  );
  assert.ok(first.includes('<p>The second paragraph stands alone.</p>'), 'a second paragraph renders');
});

test('metadata is read from the Gutenberg Title/Author header', async () => {
  const book = await openText(bytesOf(SAMPLE));
  assert.equal(book.metadata.title, 'A Small Book');
  assert.equal(book.metadata.author, 'A. Writer');
});

test('a headingless file still reads as one synthetic section', async () => {
  const book = await openText(bytesOf('Just one paragraph.\n\nAnd another one.'));
  assert.equal(book.sections.length, 1);
  assert.deepEqual(book.toc, []);
  const html = await sectionHtml(book, 0);
  assert.ok(html.includes('<p>Just one paragraph.</p>'));
  assert.ok(html.includes('<p>And another one.</p>'));
});

test('a non-UTF-8 (windows-1252) file decodes with correct characters', async () => {
  // "Café\n\nRésumé" in windows-1252 (é = 0xE9), invalid as UTF-8 so the strict
  // UTF-8 attempt throws and the legacy fallback decodes it.
  const cp1252 = new Uint8Array([
    0x43, 0x61, 0x66, 0xe9, // Café
    0x0a, 0x0a, // blank line
    0x52, 0xe9, 0x73, 0x75, 0x6d, 0xe9, // Résumé
  ]);
  const book = await openText(cp1252.buffer);
  const html = await sectionHtml(book, 0);
  assert.ok(html.includes('Café'), 'é decoded via the windows-1252 fallback');
  assert.ok(html.includes('Résumé'), 'both accented words decoded');
});

test('a UTF-8 BOM is stripped and the text decodes', async () => {
  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Hello world paragraph.')]);
  const book = await openText(withBom.buffer);
  const html = await sectionHtml(book, 0);
  assert.ok(html.includes('<p>Hello world paragraph.</p>'));
  assert.ok(!html.includes('﻿'), 'the BOM is not carried into the content');
});

test('a UTF-16LE BOM file decodes', async () => {
  const content = 'Wide characters here.';
  const u16 = new Uint8Array(2 + content.length * 2);
  u16[0] = 0xff;
  u16[1] = 0xfe;
  for (let i = 0; i < content.length; i += 1) u16[2 + i * 2] = content.charCodeAt(i) & 0xff;
  const book = await openText(u16.buffer);
  const html = await sectionHtml(book, 0);
  assert.ok(html.includes('<p>Wide characters here.</p>'));
});

test('markup-significant characters in the text are XML-escaped', async () => {
  const book = await openText(bytesOf('5 < 6 & 7 > 3, said <b>nobody</b>.'));
  const html = await sectionHtml(book, 0);
  assert.ok(html.includes('5 &lt; 6 &amp; 7 &gt; 3'), 'angle brackets and ampersands escape');
  assert.ok(!html.includes('<b>nobody</b>'), 'raw markup from the text does not survive as elements');
});

test('sniff rejects other formats and binary, accepts plain text', async () => {
  const src = (b: Uint8Array) => toByteSource(b.buffer as ArrayBuffer);
  const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]);
  const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const xml = new TextEncoder().encode('  <?xml version="1.0"?><FictionBook/>');
  const binary = new Uint8Array([0x48, 0x69, 0x00, 0x01, 0x02]);
  const plain = new TextEncoder().encode('Just some words.');

  assert.equal(await text.sniff(src(zip)), false, 'a zip is not text');
  assert.equal(await text.sniff(src(pdf)), false, 'a PDF is not text');
  assert.equal(await text.sniff(src(xml)), false, 'an XML/FB2 document is not text');
  assert.equal(await text.sniff(src(binary)), false, 'a NUL byte means binary');
  assert.equal(await text.sniff(src(plain)), true, 'plain prose is claimed');
});

test('an EPUB in a [epub, text] registry is claimed by epub, not text', async () => {
  const bytes = await readFile(new URL('./fixtures/epub/epub3.epub', import.meta.url));
  const book = await open(new Uint8Array(bytes).buffer, { formats: [epub, text] });
  // If text had wrongly claimed it, sections would be one synthetic XHTML blob of
  // zip noise; the real EPUB has its spine and metadata.
  assert.ok(book.metadata.title, 'the EPUB decoder ran, not the text fallback');
  assert.ok(book.sections.length >= 1);
});

test('bytes nothing claims still reject cleanly', async () => {
  const binary = new Uint8Array([0x00, 0x01, 0x02, 0x03]);
  await assert.rejects(open(binary.buffer, { formats: [epub, text] }), UnrecognizedFormatError);
});

// --- corpus (gitignored; skips when absent) ---------------------------------

async function corpusTxts(): Promise<string[]> {
  try {
    return (await readdir(corpusDir)).filter((n) => n.endsWith('.txt')).sort();
  } catch {
    return [];
  }
}

const txts = await corpusTxts();

test(
  'corpus Gutenberg TXT titles decode into readable XHTML sections',
  { skip: txts.length === 0 && 'corpus not downloaded (npm run fetch-corpus)' },
  async () => {
    for (const name of txts) {
      const bytes = await readFile(new URL(name, corpusDir));
      const book = await open(new Uint8Array(bytes).buffer, { formats: [epub, text] });
      assert.ok(book.sections.length > 0, `${name}: has at least one section`);
      const html = await sectionHtml(book, 0);
      assert.ok(html.includes('<p>') || html.includes('<h2>'), `${name}: renders as XHTML paragraphs`);
      // Every TOC entry resolves to a real section.
      for (const entry of book.toc) {
        assert.ok(book.section(entry.sectionId), `${name}: TOC "${entry.label}" resolves`);
      }
    }
  },
);

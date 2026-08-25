import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { open, type Book } from '../src/core/index.ts';
import { epub, fb2, text } from '../src/formats/index.ts';

async function openFb2(name: string): Promise<Book> {
  const bytes = await readFile(new URL(`./fixtures/fb2/${name}`, import.meta.url));
  // Registry order mirrors the demo; fb2 must claim the file, not text.
  return open(new Uint8Array(bytes).buffer, { formats: [epub, fb2, text] });
}

async function html(book: Book, id: string): Promise<string> {
  const section = book.section(id);
  assert.ok(section, `section ${id} exists`);
  return new TextDecoder().decode(await section.load());
}

test('metadata comes from title-info', async () => {
  const book = await openFb2('basic.fb2');
  assert.equal(book.metadata.title, 'A Test FB2 Book');
  assert.equal(book.metadata.author, 'Ada Writer');
  assert.equal(book.metadata.language, 'en');
  assert.ok(book.metadata.cover, 'a cover resource is present');
  assert.equal(book.metadata.cover!.mediaType, 'image/png');
  assert.ok((await book.metadata.cover!.load()).length > 0, 'the cover loads real bytes');
});

test('main body sections and a notes body become sections', async () => {
  const book = await openFb2('basic.fb2');
  const ids = book.sections.map((s) => s.id);
  assert.deepEqual(ids, ['s0', 's1', 'nb0'], 'two chapters plus one notes body');
});

test('the TOC follows the chapter structure with nested children', async () => {
  const book = await openFb2('basic.fb2');
  assert.equal(book.toc.length, 2);
  assert.equal(book.toc[0]!.label, 'Chapter One');
  assert.equal(book.toc[0]!.sectionId, 's0');
  assert.equal(book.toc[1]!.label, 'Chapter Two');
  const child = book.toc[1]!.children[0]!;
  assert.equal(child.label, 'A Subsection');
  assert.equal(child.sectionId, 's1');
  assert.equal(child.fragment, 'ch2a');
  for (const item of book.toc) assert.ok(book.section(item.sectionId), `${item.label} resolves`);
});

test('a footnote link is rewritten to a cross-section href the reader can follow', async () => {
  const book = await openFb2('basic.fb2');
  const ch1 = await html(book, 's0');
  // note1 lives in the notes body (nb0), so the bare "#note1" is rewritten to
  // "nb0#note1" — a path the reader resolves to that section, then seeks the id.
  assert.ok(ch1.includes('href="nb0#note1"'), 'the footnote href is section-qualified');
  const notes = await html(book, 'nb0');
  assert.ok(notes.includes('id="note1"'), 'the note target id is rendered');
  assert.ok(notes.includes('This is the footnote body'), 'the note text renders');
});

test('inline markup and images render as XHTML', async () => {
  const book = await openFb2('basic.fb2');
  const ch1 = await html(book, 's0');
  assert.ok(ch1.includes('<em>emphasis</em>'), 'emphasis maps to <em>');
  assert.ok(ch1.includes('<strong>strength</strong>'), 'strong maps to <strong>');
  const ch2 = await html(book, 's1');
  // Images reference the binary by a bare id (the view treats "#id" as a fragment,
  // not a resource), which Section.resolve maps back to the binary.
  assert.ok(ch2.includes('<img src="pic1"'), 'the image references the binary by bare id');
  assert.ok(ch2.includes('<h2') && ch2.includes('Chapter Two'), 'the chapter title is a heading');
  assert.ok(ch2.includes('A Subsection'), 'the nested subsection renders in the same section');
});

test('Section.resolve maps a binary reference to its resource', async () => {
  const book = await openFb2('basic.fb2');
  const ch2 = book.section('s1')!;
  const bare = ch2.resolve!('pic1');
  assert.ok(bare, 'a bare id resolves');
  assert.equal(bare!.mediaType, 'image/png');
  assert.ok((await bare!.load()).length > 0, 'the binary loads real bytes');
  assert.ok(ch2.resolve!('#pic1'), 'a #-prefixed reference resolves too');
  assert.equal(ch2.resolve!('missing'), undefined, 'an unknown reference resolves to nothing');
});

test('a minimal FB2 with a bare unnamed section still reads', async () => {
  const book = await openFb2('minimal.fb2');
  assert.equal(book.metadata.title, 'Minimal');
  assert.equal(book.sections.length, 1);
  const only = await html(book, 's0');
  assert.ok(only.includes('A single unnamed section with one paragraph'));
});

test('a windows-1251 declared FB2 decodes Cyrillic correctly', async () => {
  // "Тест" in windows-1251 is D2 E5 F1 F2. Built inline so the encoding path is
  // exercised without committing a non-UTF-8 binary fixture.
  const cyr = [0xd2, 0xe5, 0xf1, 0xf2];
  const parts: number[] = [];
  const ascii = (s: string) => {
    for (let i = 0; i < s.length; i += 1) parts.push(s.charCodeAt(i));
  };
  ascii('<?xml version="1.0" encoding="windows-1251"?>\n');
  ascii('<FictionBook xmlns:l="http://www.w3.org/1999/xlink"><description><title-info><book-title>');
  parts.push(...cyr);
  ascii('</book-title><lang>ru</lang></title-info></description><body><section><title><p>');
  parts.push(...cyr);
  ascii('</p></title></section></body></FictionBook>');

  const book = await open(new Uint8Array(parts).buffer, { formats: [epub, fb2, text] });
  assert.equal(book.metadata.title, 'Тест', 'the windows-1251 title decoded to Cyrillic');
  const only = await html(book, 's0');
  assert.ok(only.includes('Тест'), 'the section heading decoded too');
});

test('fb2 sniff claims FictionBook and rejects a plain EPUB/zip', async () => {
  const fb2Bytes = await readFile(new URL('./fixtures/fb2/basic.fb2', import.meta.url));
  const epubBytes = await readFile(new URL('./fixtures/epub/epub3.epub', import.meta.url));
  const src = (b: Uint8Array) => ({ size: b.length, read: (o: number, n: number) => Promise.resolve(b.subarray(o, o + n)), bytes: () => Promise.resolve(b) });
  assert.equal(await fb2.sniff(src(new Uint8Array(fb2Bytes))), true, 'FictionBook is claimed');
  assert.equal(await fb2.sniff(src(new Uint8Array(epubBytes))), false, 'a zip/EPUB is not FB2');
});

import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { BookError, open, type Book } from '../src/core/index.ts';
import { epub } from '../src/formats/epub/index.ts';

const corpusDir = new URL('./corpus/', import.meta.url);
const testsuiteDir = new URL('./corpus/epub-testsuite/', import.meta.url);

async function epubsIn(dir: URL): Promise<string[]> {
  try {
    return (await readdir(dir)).filter((name) => name.endsWith('.epub')).sort();
  } catch {
    // Corpus is gitignored; absent means "skip", never "fail".
    return [];
  }
}

const corpusEpubs = await epubsIn(corpusDir);
const testsuiteEpubs = await epubsIn(testsuiteDir);

function countToc(book: Book): number {
  let count = 0;
  const walk = (items: Book['toc']): void => {
    for (const item of items) {
      count += 1;
      assert.ok(book.section(item.sectionId), `TOC entry "${item.label}" targets a real section`);
      walk(item.children);
    }
  };
  walk(book.toc);
  return count;
}

test('corpus books decode with metadata, spine, TOC, and loadable sections', { skip: corpusEpubs.length === 0 && 'corpus not downloaded (npm run fetch-corpus)' }, async () => {
  for (const name of corpusEpubs) {
    const bytes = await readFile(new URL(name, corpusDir));
    const book = await open(new Uint8Array(bytes).buffer, { formats: [epub] });
    assert.ok(book.metadata.title, `${name}: title is present and non-empty`);
    assert.ok(book.metadata.language, `${name}: language is present and non-empty`);
    assert.ok(book.sections.length > 0, `${name}: spine is non-empty`);
    for (const section of book.sections) {
      assert.ok(section.id, `${name}: every section has an id`);
    }

    const tocEntries = countToc(book);
    assert.ok(tocEntries > 0, `${name}: the TOC is non-empty and every entry resolves`);

    for (const section of [book.sections[0]!, book.sections[book.sections.length - 1]!]) {
      const content = await section.load();
      assert.ok(content.length > 0, `${name}: section ${section.id} loads real bytes`);
      assert.ok(
        new TextDecoder().decode(content).includes('<'),
        `${name}: section ${section.id} looks like markup`,
      );
    }
    if (book.metadata.cover !== undefined) {
      assert.ok((await book.metadata.cover.load()).length > 0, `${name}: the cover loads real bytes`);
    }

    console.log(
      `${fileURLToPath(new URL(name, corpusDir))}: "${book.metadata.title ?? ''}" — ${book.sections.length} sections, ${tocEntries} TOC entries, cover ${book.metadata.cover ? 'yes' : 'no'}`,
    );
  }
});

const REFERENCE = /(?:src|href)\s*=\s*"([^"]*)"/g;

function referencesIn(markup: string): string[] {
  return [...markup.matchAll(REFERENCE)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&'));
}

function isInternal(reference: string): boolean {
  return (
    reference !== '' && !reference.startsWith('#') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(reference) && !reference.startsWith('//')
  );
}

test('corpus sections resolve their own references to loadable resources', { skip: corpusEpubs.length === 0 && 'corpus not downloaded (npm run fetch-corpus)' }, async () => {
  for (const name of corpusEpubs) {
    const bytes = await readFile(new URL(name, corpusDir));
    const book = await open(new Uint8Array(bytes).buffer, { formats: [epub] });

    let internal = 0;
    let resolved = 0;
    const unresolved: string[] = [];
    for (const section of book.sections) {
      const resolve = section.resolve;
      assert.ok(resolve, `${name}: section ${section.id} exposes a resolver`);
      assert.equal(
        resolve('https://example.invalid/x.png'),
        undefined,
        `${name}: an absolute URL never resolves`,
      );
      const markup = new TextDecoder().decode(await section.load());
      for (const reference of new Set(referencesIn(markup))) {
        if (!isInternal(reference)) {
          assert.equal(resolve(reference), undefined, `${name}: "${reference}" is not resolvable`);
          continue;
        }
        internal += 1;
        const resource = resolve(reference);
        if (resource === undefined) {
          unresolved.push(reference);
          continue;
        }
        resolved += 1;
        assert.ok(resource.mediaType, `${name}: resolved "${reference}" carries a media type`);
        const payload = await resource.load();
        assert.ok(payload.length > 0, `${name}: resolved "${reference}" loads real bytes`);
        if (reference.split('#')[0]?.endsWith('.css') === true) {
          assert.match(resource.mediaType, /css/, `${name}: "${reference}" resolves to a stylesheet`);
        }
      }
    }

    if (internal > 0) {
      assert.ok(resolved > 0, `${name}: at least one in-book reference resolves`);
    }
    console.log(
      `${fileURLToPath(new URL(name, corpusDir))}: ${resolved}/${internal} in-book references resolved` +
        (unresolved.length === 0 ? '' : ` — unresolved: ${[...new Set(unresolved)].slice(0, 5).join(', ')}`),
    );
  }
});

const OBFUSCATION_BOOK = 'ocf-font_obfuscation.epub';

test('W3C ocf-font_obfuscation: the obfuscated TrueType font loads as a real sfnt', { skip: !testsuiteEpubs.includes(OBFUSCATION_BOOK) && 'testsuite not downloaded (npm run fetch-corpus)' }, async () => {
  const bytes = await readFile(new URL(OBFUSCATION_BOOK, testsuiteDir));
  const book = await open(new Uint8Array(bytes).buffer, { formats: [epub] });
  const font = book.resources.get('font_truetype');
  assert.ok(font, 'the font is a non-spine manifest item');
  assert.equal(font.mediaType, 'font/ttf');
  const payload = await font.load();
  assert.deepEqual([...payload.slice(0, 4)], [0x00, 0x01, 0x00, 0x00], 'de-obfuscated bytes start with the TrueType sfnt version');
  const chapter = book.sections[0];
  assert.ok(chapter?.resolve);
  const viaSection = chapter.resolve('fonts/Lobster.ttf');
  assert.ok(viaSection);
  assert.deepEqual(await viaSection.load(), payload);
});

test('W3C epub-testsuite books never crash: every one yields a Book or a typed BookError', { skip: testsuiteEpubs.length === 0 && 'testsuite not downloaded (npm run fetch-corpus)' }, async () => {
  let decoded = 0;
  let refused = 0;
  for (const name of testsuiteEpubs) {
    const bytes = await readFile(new URL(name, testsuiteDir));
    try {
      const book = await open(new Uint8Array(bytes).buffer, { formats: [epub] });
      assert.ok(book.sections.length > 0, `${name}: a decoded testsuite book has a spine`);
      for (const section of book.sections) {
        try {
          await section.load();
        } catch (error) {
          assert.ok(error instanceof BookError, `${name}: section ${section.id} load failure is typed, got ${String(error)}`);
        }
      }
      decoded += 1;
    } catch (error) {
      assert.ok(error instanceof BookError, `${name}: decode failure is typed, got ${String(error)}`);
      refused += 1;
      console.log(`${name}: typed refusal — ${(error as Error).name}: ${(error as Error).message}`);
    }
  }
  console.log(`epub-testsuite: ${decoded} decoded, ${refused} typed refusals, 0 crashes`);
});

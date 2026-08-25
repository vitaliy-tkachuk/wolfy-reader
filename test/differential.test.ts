import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import { BookError, open, type Book } from '../src/core/index.ts';
import { epub, fb2, text } from '../src/formats/index.ts';
import {
  differentialScore,
  extractBookText,
  normalizeWords,
  stripGutenbergBoilerplate,
} from './support/differential.ts';

const corpusDir = new URL('./corpus/', import.meta.url);
const testsuiteDir = new URL('./corpus/epub-testsuite/', import.meta.url);
const formats = [epub, fb2, text];

/**
 * The format table: extension → the format list to decode it, and the extractor.
 * Extraction is format-neutral (every decoder emits markup sections), so MOBI slots
 * in later (M5-5) by adding a single `.mobi` row — the harness does not reshape.
 */
const FORMAT_BY_EXT: Record<string, { formats: typeof formats }> = {
  '.epub': { formats },
  '.txt': { formats },
  // '.mobi': { formats } — added in M5-5 alongside the mobi decoder.
};

async function filesIn(dir: URL): Promise<string[]> {
  try {
    return (await readdir(dir)).sort();
  } catch {
    // Corpus is gitignored; absent means "skip", never "fail".
    return [];
  }
}

async function decode(dir: URL, name: string): Promise<Book> {
  const bytes = await readFile(new URL(name, dir));
  return open(new Uint8Array(bytes).buffer, { formats });
}

async function normalizedBody(book: Book): Promise<string[]> {
  return normalizeWords(stripGutenbergBoilerplate(await extractBookText(book)));
}

const corpusFiles = await filesIn(corpusDir);

/** Titles present as BOTH .epub and .txt — the differential pairs. */
function differentialPairs(files: readonly string[]): string[] {
  const stems = new Set<string>();
  for (const f of files) {
    if (!f.endsWith('.txt')) continue;
    const stem = f.slice(0, -'.txt'.length);
    if (files.includes(`${stem}.epub`)) stems.add(stem);
  }
  return [...stems].sort();
}

const pairs = differentialPairs(corpusFiles);
const THRESHOLD = 0.85;

test(
  'EPUB and TXT editions of the same title decode to the same prose',
  { skip: pairs.length === 0 && 'corpus not downloaded (npm run fetch-corpus)' },
  async () => {
    // The suite targets >= 5 titles; the fetch script ships 5 Gutenberg pairs.
    let compared = 0;
    for (const stem of pairs) {
      const fromEpub = await normalizedBody(await decode(corpusDir, `${stem}.epub`));
      const fromTxt = await normalizedBody(await decode(corpusDir, `${stem}.txt`));

      // Both directions: each edition's body prose appears in the other's. A one-way
      // check could pass if one edition were a strict superset; requiring both makes
      // a divergent decode fail from either side.
      const epubInTxt = differentialScore(fromEpub, fromTxt);
      const txtInEpub = differentialScore(fromTxt, fromEpub);
      assert.ok(
        epubInTxt >= THRESHOLD,
        `${stem}: only ${(epubInTxt * 100).toFixed(0)}% of EPUB windows found in TXT (threshold ${THRESHOLD * 100}%)`,
      );
      assert.ok(
        txtInEpub >= THRESHOLD,
        `${stem}: only ${(txtInEpub * 100).toFixed(0)}% of TXT windows found in EPUB (threshold ${THRESHOLD * 100}%)`,
      );
      compared += 1;
    }
    assert.ok(compared >= 5, `expected >= 5 differential titles, compared ${compared} (run npm run fetch-corpus)`);
  },
);

test(
  'the harness detects divergence — a corrupted decode fails the comparison',
  { skip: pairs.length === 0 && 'corpus not downloaded (npm run fetch-corpus)' },
  async () => {
    const stem = pairs[0]!;
    const fromTxt = await normalizedBody(await decode(corpusDir, `${stem}.txt`));
    // Corrupt the "other decode" by reversing its word order: same vocabulary, no
    // shared contiguous window. If the score stayed high on this, the differential
    // would be measuring nothing.
    const corrupted = [...fromTxt].reverse();
    const score = differentialScore(fromTxt, corrupted);
    assert.ok(score < 0.2, `a reversed decode should score near zero, got ${(score * 100).toFixed(0)}%`);
    // And it clears the threshold against itself, proving the low score is the
    // corruption, not a broken scorer.
    assert.ok(differentialScore(fromTxt, fromTxt) >= THRESHOLD, 'a decode matches itself');
  },
);

test(
  'Standard Ebooks EPUB3 decodes and yields real prose',
  { skip: corpusFiles.length === 0 && 'corpus not downloaded' },
  async () => {
    const standard = corpusFiles.filter((f) => f.startsWith('standardebooks-') && f.endsWith('.epub'));
    if (standard.length === 0) return; // present only when fetched
    for (const name of standard) {
      const book = await decode(corpusDir, name);
      assert.ok(book.metadata.title, `${name}: has a title`);
      assert.ok(book.sections.length > 0, `${name}: has sections`);
      const words = normalizeWords(await extractBookText(book));
      assert.ok(words.length > 1000, `${name}: yields substantial prose`);
    }
  },
);

const testsuiteFiles = await filesIn(testsuiteDir);

test(
  'W3C epub-testsuite books decode without crashing',
  { skip: testsuiteFiles.length === 0 && 'corpus not downloaded' },
  async () => {
    for (const name of testsuiteFiles.filter((f) => f.endsWith('.epub'))) {
      // Spec edge cases: the contract is "decode without throwing, or throw a typed
      // BookError" — never an untyped crash. A successful decode must expose sections.
      try {
        const book = await decode(testsuiteDir, name);
        assert.ok(Array.isArray(book.sections), `${name}: exposes a sections array`);
      } catch (error) {
        assert.ok(error instanceof BookError, `${name}: failure is a typed BookError, not ${String(error)}`);
      }
    }
  },
);

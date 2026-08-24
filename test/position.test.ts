import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import {
  BookError,
  CorruptContainerError,
  capturePosition,
  parsePosition,
  serializePosition,
  open,
  type Book,
  type Position,
} from '../src/core/index.ts';
import { epub } from '../src/formats/epub/index.ts';

const SAMPLE =
  'Call me Ishmael. Some years ago—never mind how long precisely—having ' +
  'little or no money in my purse, and nothing particular to interest me on ' +
  'shore, I thought I would sail about a little and see the watery part of ' +
  'the world.';

function assertRoundTrip(position: Position): void {
  const restored = parsePosition(serializePosition(position));
  assert.deepEqual(restored.anchor, position.anchor);
  assert.equal(restored.sectionId, position.sectionId);
  assert.equal(restored.progress, position.progress);
  assert.equal(restored.serialized, position.serialized);
}

test('captures a position at any offset in the text', () => {
  for (let offset = 0; offset <= SAMPLE.length; offset += 1) {
    const position = capturePosition(SAMPLE, offset, 's1');
    assert.equal(position.sectionId, 's1');
    assert.ok(position.progress >= 0 && position.progress <= 1);
    assert.ok(SAMPLE.includes(position.anchor.exact) || position.anchor.exact === '');
    assert.ok(position.serialized.startsWith('wr1:'));
  }
});

test('serialize/parse round-trips losslessly across every offset', () => {
  for (let offset = 0; offset <= SAMPLE.length; offset += 1) {
    assertRoundTrip(capturePosition(SAMPLE, offset, 's-round'));
  }
});

test('captures cleanly at section start and end', () => {
  const atStart = capturePosition(SAMPLE, 0, 's1');
  assert.equal(atStart.anchor.offset, 0);
  assert.equal(atStart.anchor.prefix, '');
  assert.equal(atStart.progress, 0);
  assertRoundTrip(atStart);

  const atEnd = capturePosition(SAMPLE, SAMPLE.length, 's1');
  assert.equal(atEnd.anchor.suffix, '');
  assertRoundTrip(atEnd);
});

test('empty text yields a valid, round-trippable position', () => {
  const position = capturePosition('', 0, 's-empty');
  assert.equal(position.anchor.exact, '');
  assert.equal(position.anchor.offset, 0);
  assert.equal(position.progress, 0);
  assertRoundTrip(position);
});

test('the serialized form carries an explicit version field', () => {
  const serialized = serializePosition(capturePosition(SAMPLE, 10, 's1'));
  assert.ok(serialized.startsWith('wr1:'));
  const payload = JSON.parse(serialized.slice('wr1:'.length));
  assert.equal(payload.v, 1);
});

test('parse rejects a non-position string with a typed error', () => {
  assert.throws(() => parsePosition('not-a-position'), (error: unknown) => {
    return error instanceof CorruptContainerError && error instanceof BookError;
  });
});

test('parse rejects malformed JSON payload with a typed error', () => {
  assert.throws(() => parsePosition('wr1:{not json'), CorruptContainerError);
});

test('parse rejects a payload missing required fields', () => {
  assert.throws(() => parsePosition('wr1:{"v":1}'), CorruptContainerError);
});

test('parse rejects an unknown future version without an untyped crash', () => {
  const future = 'wr1:' + JSON.stringify({
    v: 99,
    s: 's1',
    p: 0.5,
    e: 'quote',
    pre: 'before',
    suf: 'after',
    o: 3,
  });
  assert.throws(() => parsePosition(future), (error: unknown) => {
    return error instanceof CorruptContainerError && /version 99/.test((error as Error).message);
  });
});

const boundaryCases: Record<string, string> = {
  'surrogate pairs': 'A 𝟘𝟙𝟚𝟛𝟜 math digits here in the middle of a run of text.',
  'combining marks': 'Café égale à the naïve façade jalapeño sequence run.',
  'emoji ZWJ family': 'Look 👨‍👩‍👧‍👦 a family emoji then 👩🏽‍🚀 an astronaut in the stream.',
  'CJK text': '吾輩は猫である。名前はまだ無い。どこで生れたかとんと見当がつかぬ。',
  'flag sequences': 'Flags 🇺🇦🇯🇵🇬🇧 in a row inside some surrounding words of context.',
};

for (const [name, text] of Object.entries(boundaryCases)) {
  test(`boundary snapping keeps clusters intact — ${name}`, () => {
    for (let offset = 0; offset <= text.length; offset += 1) {
      const position = capturePosition(text, offset, 's-boundary');
      const combined = position.anchor.prefix + position.anchor.exact + position.anchor.suffix;
      // A cluster split would surface a lone surrogate; the window must be a
      // contiguous, well-formed substring of the source.
      assert.ok(text.includes(combined) || combined === '');
      assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(combined), 'no lone high surrogate');
      assert.ok(!/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(combined), 'no lone low surrogate');
      assertRoundTrip(position);
    }
  });
}

test('offset is a grapheme index, not a code-unit index', () => {
  // Two 4-code-unit emoji precede the word "word"; its grapheme offset is 2 spaces short.
  const text = '👋🌍 word after';
  const position = capturePosition(text, text.indexOf('word'), 's1');
  assert.ok(position.anchor.exact.startsWith('word'));
  // offset counts graphemes: 👋, 🌍, space = 3 graphemes before "word".
  assert.equal(position.anchor.offset, 3);
});

const corpusDir = new URL('./corpus/', import.meta.url);

async function firstCorpusEpub(): Promise<string | undefined> {
  try {
    return (await readdir(corpusDir)).filter((name) => name.endsWith('.epub')).sort()[0];
  } catch {
    return undefined;
  }
}

const corpusEpub = await firstCorpusEpub();

test(
  'captures and round-trips positions across a real corpus section',
  { skip: corpusEpub === undefined && 'corpus not downloaded (npm run fetch-corpus)' },
  async () => {
    const bytes = await readFile(new URL(corpusEpub!, corpusDir));
    const book: Book = await open(new Uint8Array(bytes).buffer, { formats: [epub] });
    const section = book.sections[0];
    assert.ok(section);
    const html = new TextDecoder().decode(await section.load());
    // Strip tags to plain text; core never does this, but a test may.
    const text = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length === 0) return;
    for (let index = 0; index < 20; index += 1) {
      const offset = Math.floor((text.length * index) / 20);
      assertRoundTrip(capturePosition(text, offset, section.id));
    }
  },
);

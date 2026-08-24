import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { test } from 'node:test';
import {
  BookError,
  CorruptContainerError,
  capturePosition,
  parsePosition,
  resolvePosition,
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

function graphemeSlice(text: string, offset: number, length: number): string {
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)];
  return graphemes.slice(offset, offset + length).map((g) => g.segment).join('');
}

test('resolves to the exact original location on unchanged content', () => {
  const offset = SAMPLE.indexOf('money');
  const position = capturePosition(SAMPLE, offset, 's1');
  const resolved = resolvePosition(position, SAMPLE);
  assert.ok(resolved);
  assert.equal(resolved.sectionId, 's1');
  assert.equal(graphemeSlice(SAMPLE, resolved.offset, resolved.length), position.anchor.exact);
});

test('finds the quote by content when text before the anchor is edited', () => {
  const position = capturePosition(SAMPLE, SAMPLE.indexOf('watery'), 's1');
  const edited = 'A brand new opening sentence was inserted here. ' + SAMPLE;
  const resolved = resolvePosition(position, edited);
  assert.ok(resolved);
  assert.equal(graphemeSlice(edited, resolved.offset, resolved.length), position.anchor.exact);
  // The stored offset is stale, yet the content match still lands correctly.
  assert.notEqual(resolved.offset, position.anchor.offset);
});

test('finds the quote when text after the anchor is edited', () => {
  const position = capturePosition(SAMPLE, SAMPLE.indexOf('Ishmael'), 's1');
  const edited = SAMPLE + ' And then a great deal more text was appended at the end.';
  const resolved = resolvePosition(position, edited);
  assert.ok(resolved);
  assert.equal(graphemeSlice(edited, resolved.offset, resolved.length), position.anchor.exact);
});

test('context picks the right occurrence when the quote appears twice', () => {
  const text = 'the cat sat on the mat. later the cat ran up the hill quickly.';
  const first = text.indexOf('cat');
  const second = text.indexOf('cat', first + 1);
  const posFirst = capturePosition(text, first, 's1');
  const posSecond = capturePosition(text, second, 's1');
  const resolvedFirst = resolvePosition(posFirst, text);
  const resolvedSecond = resolvePosition(posSecond, text);
  assert.ok(resolvedFirst);
  assert.ok(resolvedSecond);
  // Context, not offset, distinguishes: the two anchors resolve to different spots.
  assert.notEqual(resolvedFirst.offset, resolvedSecond.offset);
  assert.equal(graphemeSlice(text, resolvedFirst.offset, resolvedFirst.length), posFirst.anchor.exact);
  assert.equal(graphemeSlice(text, resolvedSecond.offset, resolvedSecond.length), posSecond.anchor.exact);
});

test('stored offset breaks a tie when context cannot', () => {
  // Two occurrences of "target" with identical surrounding context on both sides,
  // so context scores tie; the nearest to the stored grapheme offset must win.
  // Short windows keep the quote and context from reaching the distinguishing text.
  const text = 'x y z target x y z target x y z';
  const firstTarget = text.indexOf('target');
  const secondTarget = text.indexOf('target', firstTarget + 1);
  const tight = { quoteLength: 6, contextLength: 6 };

  const posFirst = capturePosition(text, firstTarget, 's1', tight);
  const posSecond = capturePosition(text, secondTarget, 's1', tight);
  assert.equal(posFirst.anchor.exact, 'target');
  assert.equal(posSecond.anchor.exact, 'target');
  // The two anchors carry identical quote and context; only the stored offset differs.
  assert.equal(posFirst.anchor.prefix, posSecond.anchor.prefix);
  assert.equal(posFirst.anchor.suffix, posSecond.anchor.suffix);
  assert.notEqual(posFirst.anchor.offset, posSecond.anchor.offset);

  const resolvedFirst = resolvePosition(posFirst, text);
  const resolvedSecond = resolvePosition(posSecond, text);
  assert.ok(resolvedFirst);
  assert.ok(resolvedSecond);
  // Offset alone separates them: each lands on its own occurrence.
  assert.equal(resolvedFirst.offset, posFirst.anchor.offset);
  assert.equal(resolvedSecond.offset, posSecond.anchor.offset);
  assert.notEqual(resolvedFirst.offset, resolvedSecond.offset);
});

test('a vanished quote is a soft miss, not a throw', () => {
  const position = capturePosition(SAMPLE, SAMPLE.indexOf('Ishmael'), 's1');
  const replaced = SAMPLE.replaceAll('Ishmael', 'Someone');
  let result: ReturnType<typeof resolvePosition> | undefined;
  assert.doesNotThrow(() => {
    result = resolvePosition(position, replaced);
  });
  assert.equal(result, undefined);
});

test('resolving against empty text is a soft miss', () => {
  const position = capturePosition(SAMPLE, 20, 's1');
  assert.equal(resolvePosition(position, ''), undefined);
});

test('an empty-quote position resolves to a zero-length location', () => {
  const position = capturePosition('', 0, 's-empty');
  const resolved = resolvePosition(position, 'some fresh replacement text');
  assert.ok(resolved);
  assert.equal(resolved.length, 0);
});

test('resolves a quote captured at the text boundary', () => {
  const atStart = capturePosition(SAMPLE, 0, 's1');
  const resolvedStart = resolvePosition(atStart, SAMPLE);
  assert.ok(resolvedStart);
  assert.equal(resolvedStart.offset, 0);

  const atEnd = capturePosition(SAMPLE, SAMPLE.length, 's1');
  const resolvedEnd = resolvePosition(atEnd, SAMPLE);
  assert.ok(resolvedEnd);
  assert.equal(
    graphemeSlice(SAMPLE, resolvedEnd.offset, resolvedEnd.length),
    atEnd.anchor.exact,
  );
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
      const position = capturePosition(text, offset, section.id);
      assertRoundTrip(position);
      // Capture → resolve on unchanged content is exact.
      const resolved = resolvePosition(position, text);
      assert.ok(resolved, `offset ${offset}: resolves on unchanged content`);
      assert.equal(
        graphemeSlice(text, resolved.offset, resolved.length),
        position.anchor.exact,
        `offset ${offset}: resolved slice matches the captured quote`,
      );
    }
  },
);

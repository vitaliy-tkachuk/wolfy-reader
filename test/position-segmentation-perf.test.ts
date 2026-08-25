import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Perf-shaped guard for the T001 rewrite: segmentation over a section must be
 * ~linear, not quadratic. The counting subclass below is installed BEFORE the
 * position module creates its cached `Intl.Segmenter` instances (they are built
 * lazily on first use, and this file is its own `node --test` process), so every
 * `segment()` call the position layer makes is metered. A quadratic path —
 * re-segmenting the whole text per sentence — would meter hundreds of times the
 * budget asserted here.
 */
const meter = { codeUnits: 0 };

const RealSegmenter = Intl.Segmenter;
class CountingSegmenter extends RealSegmenter {
  override segment(input: string): Intl.Segments {
    meter.codeUnits += input.length;
    return super.segment(input);
  }
}
(Intl as { Segmenter: typeof Intl.Segmenter }).Segmenter = CountingSegmenter;

const { capturePosition, resolvePosition, segmentSentences, serializePosition } = await import(
  '../src/core/position.ts'
);

const SENTENCE_COUNT = 2000;
const sentenceTexts: string[] = [];
for (let index = 0; index < SENTENCE_COUNT; index += 1) {
  sentenceTexts.push(
    index % 10 === 9
      ? `Sentence ${index} has a family 👨‍👩‍👧‍👦 emoji, a café, and flags 🇺🇦🇯🇵 inside.`
      : `This is synthetic sentence number ${index}, padded with steady prose.`,
  );
}
const TEXT = sentenceTexts.join(' ');

function graphemeSlice(text: string, offset: number, length: number): string {
  const graphemes = [...new RealSegmenter(undefined, { granularity: 'grapheme' }).segment(text)];
  return graphemes.slice(offset, offset + length).map((g) => g.segment).join('');
}

test('a large section segments in ~linear work and yields unchanged sentences', () => {
  meter.codeUnits = 0;
  const sentences = segmentSentences(TEXT, 's-perf');

  // Sentence list is exactly the synthetic construction — count and texts.
  assert.equal(sentences.length, SENTENCE_COUNT);
  for (let index = 0; index < SENTENCE_COUNT; index += 250) {
    assert.equal(sentences[index]!.text, sentenceTexts[index]);
  }

  // Coarse work-count: linear segmentation meters a handful of passes over the
  // text (graphemes once, words once, sentences once, per-sentence quote counts
  // summing to one more pass). The old quadratic path metered ~SENTENCE_COUNT
  // passes — far beyond this budget — so it cannot silently return.
  const budget = 12 * TEXT.length;
  assert.ok(
    meter.codeUnits <= budget,
    `segmentation work ${meter.codeUnits} exceeds linear budget ${budget} ` +
      `(quadratic would be ~${SENTENCE_COUNT * TEXT.length})`,
  );
});

test('batch-captured sentence positions are byte-identical to single captures', () => {
  const sentences = segmentSentences(TEXT, 's-perf');
  let searchFrom = 0;
  for (let index = 0; index < SENTENCE_COUNT; index += 125) {
    const sentence = sentences[index]!;
    const offset = TEXT.indexOf(sentence.text, searchFrom);
    assert.ok(offset >= 0, `sentence ${index} found in the text`);
    searchFrom = offset;
    // The single-capture path (exhaustively covered by position.test.ts) is the
    // reference: the batch path must serialize to the very same bytes.
    const quoteLength = [...new RealSegmenter(undefined, { granularity: 'grapheme' }).segment(
      sentence.text,
    )].length;
    const single = capturePosition(TEXT, offset, 's-perf', { quoteLength });
    assert.equal(sentence.position.serialized, single.serialized);
    assert.equal(serializePosition(sentence.position), single.serialized);
  }
});

test('sentence positions resolve to their own spans on the large section', () => {
  const sentences = segmentSentences(TEXT, 's-perf');
  for (let index = 0; index < SENTENCE_COUNT; index += 250) {
    const sentence = sentences[index]!;
    const resolved = resolvePosition(sentence.position, TEXT);
    assert.ok(resolved, `sentence ${index} resolves`);
    assert.equal(
      graphemeSlice(TEXT, resolved.offset, resolved.length).trim(),
      sentence.text.trim(),
      `sentence ${index} resolves to its own span`,
    );
  }
});

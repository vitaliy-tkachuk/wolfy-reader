import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parsePosition,
  resolvePosition,
  segmentSentences,
  serializePosition,
} from '../src/core/index.ts';

const TEXT = 'The cat sat. Then the dog ran! Did the bird fly? Yes, it flew away.';

test('segments a paragraph into its sentences', () => {
  const sentences = segmentSentences(TEXT, 's0');
  const texts = sentences.map((s) => s.text.trim());
  assert.deepEqual(texts, ['The cat sat.', 'Then the dog ran!', 'Did the bird fly?', 'Yes, it flew away.']);
});

test('each sentence Position resolves and spans the whole sentence', () => {
  for (const sentence of segmentSentences(TEXT, 's0')) {
    // The anchored quote is the sentence itself, so decorate highlights all of it.
    assert.equal(sentence.position.anchor.exact.trim(), sentence.text.trim());
    const resolved = resolvePosition(sentence.position, TEXT);
    assert.ok(resolved, `"${sentence.text}" resolves`);
    // The resolved span, sliced back out of the text, is the sentence (modulo the
    // trailing space the segmenter includes and the range trims).
    const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(TEXT)].map((g) => g.segment);
    const span = graphemes.slice(resolved!.offset, resolved!.offset + resolved!.length).join('');
    assert.equal(span.trim(), sentence.text.trim(), 'the resolved span is the sentence');
  }
});

test('sentence Positions serialize and round-trip losslessly', () => {
  for (const sentence of segmentSentences(TEXT, 's0')) {
    const round = parsePosition(serializePosition(sentence.position));
    assert.equal(round.sectionId, sentence.position.sectionId);
    assert.equal(round.anchor.exact, sentence.position.anchor.exact);
    assert.ok(resolvePosition(round, TEXT), 'the round-tripped position still resolves');
  }
});

test('whitespace-only input yields no sentences', () => {
  assert.deepEqual(segmentSentences('   \n\n  ', 's0'), []);
});

test('a resolved sentence Position tracks content shifts (prefix insertion)', () => {
  const sentences = segmentSentences(TEXT, 's0');
  const target = sentences[2]!; // "Did the bird fly?"
  // Insert text before the sentence: the content anchor still finds it, offset moved.
  const shifted = `A new opening sentence here. ${TEXT}`;
  const resolved = resolvePosition(target.position, shifted);
  assert.ok(resolved, 'the sentence still resolves after a prefix insertion');
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(shifted)].map((g) => g.segment);
  const span = graphemes.slice(resolved!.offset, resolved!.offset + resolved!.length).join('');
  assert.equal(span.trim(), target.text.trim());
});

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

test('a sentence wrapped across source line breaks is one sentence, not many', () => {
  // Section textContent keeps the source's newlines + indentation (the page hides
  // them via white-space:normal). UAX #29 would break a "sentence" at every line
  // break — segmentSentences must merge back to the punctuation seam.
  const wrapped = 'The quick brown\n    fox jumped over\n    the lazy dog and ran. Next one here.';
  const sentences = segmentSentences(wrapped, 's0');
  assert.deepEqual(
    sentences.map((s) => s.text),
    ['The quick brown fox jumped over the lazy dog and ran.', 'Next one here.'],
  );
  // The anchor still spans the raw newline-bearing run, so it resolves against the
  // frame's (newline-bearing) section text and decorate highlights the whole sentence.
  const first = sentences[0]!;
  const resolved = resolvePosition(first.position, wrapped);
  assert.ok(resolved, 'the merged sentence resolves against the raw text');
  const graphemes = [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(wrapped)].map((g) => g.segment);
  const span = graphemes.slice(resolved!.offset, resolved!.offset + resolved!.length).join('');
  assert.equal(
    span.replace(/\s+/gu, ' ').trim(),
    'The quick brown fox jumped over the lazy dog and ran.',
    'the highlighted span covers the whole wrapped sentence',
  );
});

test('a punctuation-less line merges forward rather than fragmenting', () => {
  // Plain text carries no heading structure — a line with no terminator is not a
  // sentence boundary, so it joins the next run instead of becoming a stray "2 word"
  // segment. (The alternative, breaking on the blank line, is exactly the newline
  // over-split we are fixing.)
  const sentences = segmentSentences('A Title Line\n\nBody follows here.', 's0');
  assert.deepEqual(
    sentences.map((s) => s.text),
    ['A Title Line Body follows here.'],
  );
});

test('a trailing sentence with no terminal punctuation is still emitted', () => {
  const sentences = segmentSentences('First one. And a tail with no full stop', 's0');
  assert.deepEqual(
    sentences.map((s) => s.text),
    ['First one.', 'And a tail with no full stop'],
  );
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

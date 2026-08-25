import assert from 'node:assert/strict';
import { test } from 'node:test';

import { capturePosition, resolvePosition } from '../src/core/index.ts';
import { chunkNodes, DEFAULT_CHUNK_CHARS, type ChunkNode } from '../src/layout/chunk.ts';
import {
  normalizeSectionMarkup,
  normalizeSelfClosing,
  substituteDropCapAlt,
} from '../src/layout/normalize.ts';

/**
 * Headless unit tests for the paginator's pure transforms — chunk-boundary rules
 * and markup normalization. Geometry (getClientRects, multi-column fragmentation,
 * eviction) is not exercised here; it needs a real layout engine and lives in
 * test/browser/layout.browser.mjs. These transforms are DOM-free by design so the
 * boundary rules they feed can be pinned without a browser (see layout.md).
 */

/** A paragraph-like element node carrying `chars` characters of text. */
function para(chars: number, tag = 'P'): ChunkNode {
  const text = 'x'.repeat(Math.max(0, chars));
  return { tag, chars, html: `<${tag.toLowerCase()}>${text}</${tag.toLowerCase()}>` };
}

function textNode(text: string): ChunkNode {
  return { tag: '#text', chars: text.length, html: text };
}

test('splits only between top-level children, packing to the budget', () => {
  // Four 3000-char paragraphs against an 8000 budget: two fit per chunk (6000),
  // a third would overflow (9000 > 8000) and starts a new chunk.
  const nodes = [para(3000), para(3000), para(3000), para(3000)];
  const { chunks } = chunkNodes(nodes, 8000);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0]!.nodes, 2);
  assert.equal(chunks[1]!.nodes, 2);
  assert.equal(chunks[0]!.chars, 6000);
});

test('emits an over-budget element whole rather than descending into it', () => {
  // Lydia's-letter case: a single element well past the budget. It becomes its
  // own chunk at ~1.25x budget; the boundary is never placed mid-element.
  const nodes = [para(500), para(10142), para(500)];
  const { chunks, stats } = chunkNodes(nodes, 8000);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[1]!.nodes, 1);
  assert.equal(chunks[1]!.chars, 10142);
  assert.equal(stats.oversizedElements, 1);
  assert.equal(stats.largestElementChars, 10142);
});

test('never ends a chunk on a heading — the heading is deferred to the next chunk', () => {
  // Budget fills, then a heading arrives right before the overflow paragraph. The
  // heading must lead the next chunk, not orphan at the foot of this one.
  const nodes = [para(7000), para(500, 'H2'), para(3000)];
  const { chunks, stats } = chunkNodes(nodes, 8000);
  assert.equal(chunks.length, 2);
  // First chunk keeps only the filler paragraph; the heading moved forward.
  assert.equal(chunks[0]!.nodes, 1);
  assert.equal(chunks[1]!.nodes, 2);
  assert.ok(chunks[1]!.html.startsWith('<h2>'), chunks[1]!.html.slice(0, 20));
  assert.equal(stats.headingsDeferred, 1);
});

test('never ends a chunk on an <hr> either', () => {
  const nodes: ChunkNode[] = [para(7500), { tag: 'HR', chars: 0, html: '<hr>' }, para(3000)];
  const { chunks } = chunkNodes(nodes, 8000);
  assert.equal(chunks.length, 2);
  assert.ok(chunks[1]!.html.startsWith('<hr>'), chunks[1]!.html.slice(0, 20));
});

test('atomic elements are emitted whole, never split inside', () => {
  // A large table crosses the budget but is atomic: it is emitted as one chunk
  // with no attempt to split its rows across a boundary.
  for (const tag of ['TABLE', 'PRE', 'OL', 'UL', 'DL', 'FIGURE', 'BLOCKQUOTE', 'SVG', 'MATH']) {
    const nodes = [para(500), para(12000, tag), para(500)];
    const { chunks, stats } = chunkNodes(nodes, 8000);
    const atomic = chunks.find((chunk) => chunk.html.includes(`<${tag.toLowerCase()}>`));
    assert.ok(atomic !== undefined, `${tag} chunk missing`);
    assert.equal(atomic!.nodes, 1, `${tag} was packed with a sibling`);
    assert.equal(stats.atomicOversized, 1, `${tag} not counted atomic-oversized`);
  }
});

test('a heading that is the very first node is not deferred into an empty prior chunk', () => {
  // With only one node held, the defer loop must stop (current.length > 1) so it
  // never flushes an empty chunk ahead of a leading heading.
  const nodes = [para(500, 'H1'), para(9000)];
  const { chunks } = chunkNodes(nodes, 8000);
  // The oversized paragraph forces its own chunk; the heading leads the first.
  assert.ok(chunks[0]!.html.startsWith('<h1>'), chunks[0]!.html.slice(0, 20));
  assert.ok(chunks.every((chunk) => chunk.nodes > 0));
});

test('bare top-level text nodes are glued to the open chunk and counted', () => {
  const nodes = [para(3000), textNode('a run of bare narrative text'), para(3000)];
  const { chunks, stats } = chunkNodes(nodes, 8000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0]!.nodes, 3);
  assert.equal(stats.bareTextNodes, 1);
});

test('the default budget is 8000 characters', () => {
  assert.equal(DEFAULT_CHUNK_CHARS, 8000);
  const nodes = [para(5000), para(5000)];
  const { chunks } = chunkNodes(nodes);
  // 10000 > 8000 default, so the two do not pack together.
  assert.equal(chunks.length, 2);
});

test('normalizeSelfClosing closes a non-void tag but leaves void tags alone', () => {
  const markup = '<a id="CHAPTER_XLVIII"/><p>after</p><br/><img src="x"/>';
  const out = normalizeSelfClosing(markup);
  assert.match(out, /<a id="CHAPTER_XLVIII"><\/a>/);
  assert.match(out, /<br\/>/);
  assert.match(out, /<img src="x"\/>/);
  // The paragraph after the anchor is untouched — it is no longer swallowed.
  assert.match(out, /<p>after<\/p>/);
});

test('normalizeSelfClosing handles attributes containing a slash without misfiring', () => {
  const markup = '<a href="a/b"/>tail';
  const out = normalizeSelfClosing(markup);
  assert.equal(out, '<a href="a/b"></a>tail');
});

test('substituteDropCapAlt replaces a drop-cap image with its alt text', () => {
  const markup = '<span class="letra"><img alt="T" src="dropcap.png"/></span>HE whole party';
  const out = substituteDropCapAlt(markup);
  assert.match(out, /<span class="letra">T<\/span>HE whole party/);
  assert.doesNotMatch(out, /<img/);
});

test('substituteDropCapAlt drops an image with empty or absent alt', () => {
  assert.equal(substituteDropCapAlt('<img alt="" src="x.png">'), '');
  assert.equal(substituteDropCapAlt('<img src="decorative.png">'), '');
});

test('substituteDropCapAlt decodes entities and re-escapes markup-significant chars', () => {
  const out = substituteDropCapAlt('<img alt="A &amp; B">');
  assert.equal(out, 'A &amp; B');
  const angle = substituteDropCapAlt('<img alt="&lt;tag&gt;">');
  assert.equal(angle, '&lt;tag&gt;');
});

test('normalizeSectionMarkup applies both transforms in order', () => {
  const markup = '<img alt="Q"/><a id="anchor"/><p>tail</p>';
  const out = normalizeSectionMarkup(markup);
  assert.match(out, /^Q/);
  assert.match(out, /<a id="anchor"><\/a>/);
  assert.match(out, /<p>tail<\/p>/);
});

/**
 * Selection bridge: a frame-supplied UTF-16 offset range over the section text is
 * captured with `capturePosition` (the same call `Paginator.positionOfOffsetRange`
 * makes), and the resulting `Position` must resolve back to the selected range.
 * The frame-side range computation and page mapping are geometry and live in the
 * browser suite; this pins the pure UTF-16-offset → `Position` → resolve leg.
 */
test('a UTF-16 selection offset range captures a Position that resolves back', () => {
  const text = 'The quick brown fox jumps over the lazy dog. It was a fine morning.';
  // Select "brown fox" — UTF-16 offsets 10..19 in this all-BMP text.
  const start = text.indexOf('brown');
  const position = capturePosition(text, start, 'chapter-1');
  assert.equal(position.sectionId, 'chapter-1');
  assert.ok(position.anchor.exact.startsWith('brown'), 'the anchor quote begins at the selection start');

  const resolved = resolvePosition(position, text);
  assert.ok(resolved !== undefined, 'the captured Position must resolve against the same text');
  // The anchor snaps to a word start, so the resolved grapheme offset lands on the
  // start of the selected word — the same spot the selection began.
  assert.equal([...text.slice(0, resolved.offset)].length, start);
});

test('a selection over multi-code-unit clusters captures on grapheme boundaries', () => {
  // An emoji (2 UTF-16 code units) precedes the selected word, so a UTF-16 offset
  // and a grapheme index diverge. capturePosition takes the UTF-16 offset and
  // snaps to a grapheme boundary, so the quote never splits the cluster.
  const text = 'Look 👋 there is the target word here.';
  const start = text.indexOf('target');
  const position = capturePosition(text, start, 'chapter-2');
  const resolved = resolvePosition(position, text);
  assert.ok(resolved !== undefined);
  assert.ok(position.anchor.exact.startsWith('target'), 'the quote begins at the selected word');
  // The stored grapheme offset counts the emoji as one grapheme, not two units.
  assert.equal(position.anchor.offset, [...text.slice(0, start)].length);
});

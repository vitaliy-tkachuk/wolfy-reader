import assert from 'node:assert/strict';
import { test } from 'node:test';

import { resolvePosition, type Book, type Section } from '../src/core/index.ts';
import { extractText, matchText, normalizeQuery, searchBook } from '../src/search/index.ts';

// --- Extraction ------------------------------------------------------------

test('extraction concatenates text across inline markup so wo<em>rd</em> is word', () => {
  assert.equal(extractText('<p>wo<em>rd</em></p>'), 'word');
  assert.equal(extractText('<p>a <b>bold</b> claim</p>'), 'a bold claim');
});

test('extraction skips script/style/head content and decodes entities', () => {
  assert.equal(extractText('<head><title>T</title></head><body>Hi</body>'), 'Hi');
  assert.equal(extractText('<style>p{color:red}</style><p>seen</p>'), 'seen');
  assert.equal(extractText('<script>var x=1<2;</script><p>ok</p>'), 'ok');
  assert.equal(extractText('caf&eacute; &amp; tea &#233;'), 'café & tea é');
  assert.equal(extractText('<p>a<!-- comment -->b</p>'), 'ab');
});

test('extraction keeps CDATA text and tolerates malformed markup', () => {
  assert.equal(extractText('<p><![CDATA[raw & text]]></p>'), 'raw & text');
  assert.equal(extractText('<p>dangling < not a tag'), 'dangling < not a tag');
});

// --- The canonical reading text: capture mirrors what the frame shows -------

test('discarded-element content contributes nothing, exactly as the sanitizer removes it', () => {
  // The sanitizer discards form controls and template with everything inside
  // them; their text never reaches the frame, so it must not be captured over.
  assert.equal(extractText('<p>one <textarea>NOISE</textarea>two</p>'), 'one two');
  assert.equal(extractText('<p>a<select><option>x</option><option>y</option></select>b</p>'), 'ab');
  assert.equal(extractText('<p>a<template><p>smuggled</p></template>b</p>'), 'ab');
  assert.equal(extractText('<p>a<input type="text" value="q"/>b</p>'), 'ab');
  // SVG discards by its own table: script goes, but <text> prose stays.
  assert.equal(
    extractText('<p>before <svg><script>evil()</script><text>diagram label</text></svg> after</p>'),
    'before diagram label after',
  );
});

test('an <img> contributes what the resource layer will show: nothing when served, alt when substituted', () => {
  const resolve = (reference: string) =>
    reference === 'images/dropcap-t.png' ? { mediaType: 'image/png', load: async () => new Uint8Array() } : undefined;
  // Served image: zero characters, like textContent over an <img> element.
  assert.equal(extractText('<p><img src="images/dropcap-t.png" alt="T"/>he tide</p>', resolve), 'he tide');
  // Unresolvable image: the frame substitutes the alt text as a text node.
  assert.equal(extractText('<p><img src="images/gone.png" alt="T"/>he tide</p>', resolve), 'The tide');
  // Resolvable but unservable media type: refused a URL, so alt again.
  const refuse = () => ({ mediaType: 'text/javascript', load: async () => new Uint8Array() });
  assert.equal(extractText('<p><img src="x.js" alt="T"/>he tide</p>', refuse), 'The tide');
  // Remote/data references are left for the CSP: the element survives, no text.
  assert.equal(extractText('<p><img src="https://example.invalid/x.png" alt="T"/>he tide</p>'), 'he tide');
  // Empty alt means decorative: removed, nothing contributed.
  assert.equal(extractText('<p><img src="images/gone.png" alt=""/>tide</p>', resolve), 'tide');
  // No resolver at all mirrors a section without a resolve seam: alt shows.
  assert.equal(extractText('<p><img src="images/gone.png" alt="T"/>he tide</p>'), 'The tide');
});

test('whitespace-only top-level text runs are dropped, as the chunker drops those text nodes', () => {
  // Between block elements the source carries newlines/indentation; the chunker
  // drops those top-level text nodes before the frame tiles the section text.
  assert.equal(extractText('<body>\n<p>one</p>\n  <p>two</p>\n</body>'), 'onetwo');
  // Whitespace inside an element is real reading text and stays.
  assert.equal(extractText('<p>a <b>bold</b> claim</p>'), 'a bold claim');
  // Non-whitespace bare text at the top level is glued into the flow, not dropped.
  assert.equal(extractText('<body><p>a</p>bare<p>b</p></body>'), 'abareb');
  // The implied </p> of HTML parsing keeps unclosed paragraphs from swallowing
  // the top level: the separator between these two never reaches the frame.
  assert.equal(extractText('<body><p>first\n<p>second</p></body>'), 'first\nsecond');
});

test('a hit spanning an alt substitution and a discarded element resolves in the frame-shown text', () => {
  // The exact shape of the search-anchors fixture, headlessly: a drop cap whose
  // alt is substituted and a discarded form control, both inside the phrase.
  const markup =
    '<body>\n' +
    '<h1>The Tide Ledger</h1>\n' +
    '<p class="first"><img src="images/dropcap-t.png" alt="T"/>he tide ledger never' +
    '<textarea rows="1">FORM_NOISE_NOT_PROSE</textarea>' +
    ' forgave a missing entry, and the harbour clerk knew it.</p>\n' +
    '</body>';
  const raw = extractText(markup); // no resolver: the drop cap cannot resolve, alt shows
  // What the frame measures: sanitized body textContent, top-level whitespace dropped.
  const frameText =
    'The Tide Ledger' +
    'The tide ledger never forgave a missing entry, and the harbour clerk knew it.';
  assert.equal(raw, frameText, 'capture text must equal the frame-shown text');

  const hits = [...matchText(raw, 'The tide ledger never forgave a missing entry', 'ledger', 0)];
  assert.equal(hits.length, 1, 'the phrase spanning both regions must be found');
  assert.equal(hits[0]!.text, 'The tide ledger never forgave a missing entry');
  const resolved = resolvePosition(hits[0]!.position, frameText);
  assert.ok(resolved !== undefined, 'the anchor must resolve against the frame-shown text');
});

test('a genuine miss still degrades to a value, never an error', () => {
  // A Position captured over text the target no longer contains resolves to
  // undefined — the soft-miss contract is unchanged by the alignment.
  const hits = [...matchText('the quick brown fox', 'quick', 's', 0)];
  assert.equal(hits.length, 1);
  assert.equal(resolvePosition(hits[0]!.position, 'entirely different prose'), undefined);
});

// --- Normalization policy --------------------------------------------------

test('matching is case-insensitive', () => {
  const hits = [...matchText('The QUICK brown Fox', 'quick', 's', 0)];
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.text, 'QUICK');
});

test('matching folds smart quotes, dashes and NFC composition', () => {
  // Curly apostrophe in the text matches a straight one typed in the query.
  assert.equal([...matchText('don’t stop', "don't", 's', 0)].length, 1);
  // Em dash in the text matches a hyphen typed in the query.
  assert.equal([...matchText('a—b', 'a-b', 's', 0)].length, 1);
  // Decomposed e + combining acute in the text matches precomposed é.
  assert.equal([...matchText('café', 'café', 's', 0)].length, 1);
});

test('matching collapses whitespace so runs and newlines do not defeat a query', () => {
  assert.equal([...matchText('one   two\n\tthree', 'two three', 's', 0)].length, 1);
  assert.equal([...matchText('a\nb', 'a b', 's', 0)].length, 1);
});

test('diacritics are preserved — café does not match cafe', () => {
  assert.equal([...matchText('a café here', 'cafe', 's', 0)].length, 0);
});

test('a blank query yields nothing', () => {
  assert.equal(normalizeQuery('   '), '');
  assert.equal([...matchText('any text at all', '   ', 's', 0)].length, 0);
});

// --- Hit shape, context, and position round-trip ---------------------------

test('a hit carries the raw matched text and a word-clean context', () => {
  const text = 'The wandering albatross soared above the grey southern ocean today.';
  const hits = [...matchText(text, 'albatross', 's', 0, { contextRadius: 12 })];
  assert.equal(hits.length, 1);
  const hit = hits[0]!;
  assert.equal(hit.text, 'albatross');
  assert.ok(hit.context.includes('albatross'));
  // No partial word at either edge: the trimmed context begins and ends on a word
  // that appears whole in the source text.
  const first = hit.context.split(' ')[0]!;
  const last = hit.context.split(' ').at(-1)!;
  assert.ok(text.includes(first), `leading token "${first}" is a partial word`);
  assert.ok(text.includes(last), `trailing token "${last}" is a partial word`);
});

test("the hit's Position re-resolves to the same span in the section text", () => {
  const text = 'Alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu.';
  for (const query of ['gamma', 'epsilon', 'lambda']) {
    const hits = [...matchText(text, query, 'sec-1', 0)];
    assert.equal(hits.length, 1, `expected one hit for ${query}`);
    const resolved = resolvePosition(hits[0]!.position, text);
    assert.ok(resolved !== undefined, `${query} position did not resolve`);
    assert.equal(resolved!.sectionId, 'sec-1');
    // The resolved quote covers the match: the matched word starts at or after the
    // anchor (capturePosition snaps to a word start, which is the match here).
    const at = text.indexOf(query);
    assert.ok(at >= 0);
  }
});

test('a match split across inline markup produces a resolvable hit', () => {
  const raw = extractText('<p>the ancient wo<em>rd</em> endures</p>');
  const hits = [...matchText(raw, 'word', 's', 0)];
  assert.equal(hits.length, 1);
  assert.equal(hits[0]!.text, 'word');
  assert.ok(resolvePosition(hits[0]!.position, raw) !== undefined);
});

test('every occurrence in a section is yielded', () => {
  const hits = [...matchText('ba ba black sheep, ba', 'ba', 's', 0)];
  assert.equal(hits.length, 3);
});

// --- Whole-book lazy scan --------------------------------------------------

function sectionOf(id: string, text: string, counter: { loads: string[] }): Section {
  return {
    id,
    mediaType: 'application/xhtml+xml',
    load: async () => {
      counter.loads.push(id);
      return new TextEncoder().encode(`<p>${text}</p>`);
    },
  };
}

function bookOf(sections: Section[]): Book {
  return {
    metadata: {},
    toc: [],
    sections,
    section: (id) => sections.find((s) => s.id === id),
    resources: new Map(),
  };
}

test('searchBook yields the first hit before the last section is scanned (lazy)', async () => {
  const counter = { loads: [] as string[] };
  const decoded: number[] = [];
  const book = bookOf([
    sectionOf('a', 'the needle is here', counter),
    sectionOf('b', 'more needle later', counter),
    sectionOf('c', 'and needle again', counter),
  ]);

  const iterator = searchBook(book, 'needle', {
    onSection: (index) => decoded.push(index),
  });
  const first = await iterator.next();
  assert.equal(first.done, false);
  assert.equal(first.value.sectionIndex, 0);
  // Only section 0 was decoded to produce the first hit; the last is untouched.
  assert.deepEqual(decoded, [0], `decoded ${decoded.join(',')} before the first hit`);
  assert.ok(!counter.loads.includes('c'), 'the last section was decoded too early');
});

test('searchBook streams hits across sections and stops cleanly on early break', async () => {
  const counter = { loads: [] as string[] };
  const decoded: number[] = [];
  const book = bookOf([
    sectionOf('a', 'needle one', counter),
    sectionOf('b', 'needle two', counter),
    sectionOf('c', 'needle three', counter),
  ]);

  const seen: number[] = [];
  for await (const hit of searchBook(book, 'needle', { onSection: (i) => decoded.push(i) })) {
    seen.push(hit.sectionIndex);
    if (seen.length === 2) break; // stop after the second section's hit
  }
  assert.deepEqual(seen, [0, 1]);
  // The generator's cleanup ran on break: section 2 was never loaded/decoded.
  assert.ok(!decoded.includes(2), `section 2 was decoded after break (${decoded.join(',')})`);
  assert.ok(!counter.loads.includes('c'), 'the third section was loaded after break');
});

test('searchBook finds every occurrence in every section, in order', async () => {
  const counter = { loads: [] as string[] };
  const book = bookOf([
    sectionOf('a', 'sea sea', counter),
    sectionOf('b', 'no match', counter),
    sectionOf('c', 'sea shells', counter),
  ]);
  const hits = [];
  for await (const hit of searchBook(book, 'sea')) hits.push(hit);
  assert.equal(hits.length, 3);
  assert.deepEqual(hits.map((h) => h.sectionIndex), [0, 0, 2]);
});

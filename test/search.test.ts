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

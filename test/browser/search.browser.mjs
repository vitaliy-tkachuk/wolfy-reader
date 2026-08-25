import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for full-text search's browser-load-bearing pieces:
 * `goTo(hit.position)` landing on the hit's page inside the sandboxed frame, and the
 * search-hit *highlight* drawn over that same anchor via the decorations API. The
 * matcher, extraction, normalization, context windowing and iterator laziness are
 * all headless (test/search.test.ts); only the jump and the drawn overlay cross the
 * frame boundary — resolving a hit's content-anchored Position against the
 * frame-measured section text, seeking to its page, and painting the overlay client
 * rects — so only those are asserted here.
 *
 * Mirrors reader.browser.mjs / decorations.browser.mjs: same serve-demo mounts, same
 * harness.html, a graceful skip when playwright is absent, and a corpus skip for the
 * multi-page landing case.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');
const corpusDir = resolve(repoRoot, 'test', 'corpus');
const corpusBook = resolve(corpusDir, 'gutenberg-pride-and-prejudice.epub');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('search.browser: playwright is not installed — skipping. Run `npm install` first.');
}

let corpusPresent = false;
try {
  await access(corpusBook);
  corpusPresent = true;
} catch {
  console.log('search.browser: corpus book absent — corpus cases skipped (run `npm run fetch-corpus`).');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};
const skipCorpus = !corpusPresent ? { skip: 'the corpus book is absent' } : {};

let server = null;
let browser = null;
let page = null;

before(async () => {
  if (playwright === null) return;
  server = await startServer({
    port: 0,
    mounts: [
      { prefix: '/src', dir: resolve(repoRoot, 'src') },
      { prefix: '/fixtures', dir: fixtureDir },
      { prefix: '/corpus', dir: corpusDir },
      { prefix: '/', dir: browserDir },
    ],
  });
  browser = await playwright.chromium.launch({ channel: 'chromium' });
  page = await browser.newPage();
  await page.goto(`${server.origin}/harness.html`);
  await page.waitForFunction(() => window.harnessReady === true);
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openReader(url, options = {}) {
  const opened = await page.evaluate((u) => window.harness.openBook(u), url);
  assert.ok(opened !== null, `${url} could not be fetched`);
  return page.evaluate((o) => window.harness.createReader(o), options);
}

const HOSTILE = '/fixtures/hostile.epub';
const PP = '/corpus/gutenberg-pride-and-prejudice.epub';

function contentFrame() {
  const frames = page.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame — the reader content frame');
  return frames[0];
}

/** The overlay boxes painted for a decoration id, with class + geometry facts. */
async function overlayBoxes(id, className) {
  return contentFrame().evaluate(
    ([decorationId, cls]) => {
      const boxes = [...document.querySelectorAll(`[data-decoration="${decorationId}"]`)];
      return boxes.map((box) => {
        const rect = box.getBoundingClientRect();
        return { width: rect.width, height: rect.height, hasClass: box.classList.contains(cls) };
      });
    },
    [id, className],
  );
}

describe('reader.search — jump to hit', { ...skipAll }, () => {
  test('a hit found in a section jumps to that section, its Position resolving in the frame', async () => {
    await openReader(HOSTILE);
    // "lamplighter" lives in the "preserve" section (index 4 in reading order),
    // several sections past the opening one — so landing there proves the jump used
    // the hit's Position, not the reading cursor.
    const hits = await page.evaluate(() => window.harness.readerSearch('lamplighter'));
    assert.ok(hits.length >= 1, 'search found no hit for "lamplighter"');
    const hit = hits[0];
    assert.equal(hit.text.toLowerCase(), 'lamplighter');
    const targetSection = await page.evaluate((id) => window.harness.sectionIndexOf(id), 'preserve');
    assert.equal(hit.sectionIndex, targetSection, 'the hit reported the wrong section');

    // Start elsewhere, then jump by the hit's Position.
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const before = await page.evaluate(() => window.harness.readerPosition());
    assert.notEqual(before.section, targetSection, 'test must start off the target section');

    const landed = await page.evaluate((s) => window.harness.readerGoToSearchHit(s), hit.serialized);
    assert.equal(landed.section, targetSection, 'goTo(hit.position) landed in the wrong section');
  });

  test('search streams multiple hits across sections, each carrying context', async () => {
    await openReader(HOSTILE);
    // A common word appears in several sections; each hit carries its own context.
    const hits = await page.evaluate(() => window.harness.readerSearch('the', 30));
    assert.ok(hits.length >= 2, 'expected several "the" hits across the book');
    for (const hit of hits) {
      assert.ok(hit.context.length > 0, 'a hit carried empty context');
      assert.ok(typeof hit.serialized === 'string' && hit.serialized.startsWith('wr1:'));
    }
    // Hits are ordered by section (the scan is sequential).
    const sections = hits.map((h) => h.sectionIndex);
    for (let i = 1; i < sections.length; i += 1) assert.ok(sections[i] >= sections[i - 1]);
  });
});

describe('reader.search — anchors align with the sanitized frame text', { ...skipAll }, () => {
  const SEARCH_ANCHORS = '/fixtures/search-anchors.epub';

  test('a hit spanning an alt-substituted drop cap and a discarded element jumps to its visible range', async () => {
    await openReader(SEARCH_ANCHORS);
    // The phrase the frame shows is "The tide ledger never forgave a missing
    // entry": the "T" exists only as a substituted <img alt> (the drop cap is
    // declared in the manifest but absent from the archive) and the run crosses
    // a <textarea> the sanitizer discarded. Capture over anything but the
    // canonical reading text either misses the phrase or anchors a quote the
    // frame does not contain.
    const query = 'The tide ledger never forgave a missing entry';
    const hits = await page.evaluate((q) => window.harness.readerSearch(q), query);
    assert.ok(hits.length >= 1, 'the phrase spanning both transformed regions must be found');
    const hit = hits[0];
    assert.equal(hit.text, 'The tide ledger never forgave a missing entry');
    assert.ok(!hit.context.includes('FORM_NOISE'), 'discarded-element noise must not leak into context');

    const targetSection = await page.evaluate((id) => window.harness.sectionIndexOf(id), 'ledger');
    assert.equal(hit.sectionIndex, targetSection, 'the hit reported the wrong section');

    // Start on the opening section; the jump must travel and land.
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const before = await page.evaluate(() => window.harness.readerPosition());
    assert.notEqual(before.section, targetSection, 'test must start off the target section');
    const landed = await page.evaluate((s) => window.harness.readerGoToSearchHit(s), hit.serialized);
    assert.equal(landed.section, targetSection, 'goTo(hit.position) did not reach the visible range');

    // The same anchor draws a visible highlight — resolution against the frame
    // text produced real geometry, not a soft miss.
    await page.evaluate((s) => window.harness.readerDecorate('anchor-hit', s, 'anchor-hl'), hit.serialized);
    const boxes = await overlayBoxes('anchor-hit', 'anchor-hl');
    assert.ok(boxes.length > 0, 'the aligned anchor must paint at least one overlay box');
  });

  test("the hostile book's Gutenberg-style drop cap is searchable through its substituted alt", async () => {
    await openReader(HOSTILE);
    // "The lamplighter" exists in the frame only because <img alt="T"> is
    // substituted; before capture/resolution shared one text model this query
    // found nothing at all.
    const hits = await page.evaluate(() => window.harness.readerSearch('The lamplighter counted'));
    assert.ok(hits.length >= 1, 'the alt-substituted phrase must be found');
    const targetSection = await page.evaluate((id) => window.harness.sectionIndexOf(id), 'preserve');
    assert.equal(hits[0].sectionIndex, targetSection);
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const landed = await page.evaluate((s) => window.harness.readerGoToSearchHit(s), hits[0].serialized);
    assert.equal(landed.section, targetSection, 'the drop-cap hit must jump');
  });
});

describe('reader.search — highlighting a hit', { ...skipAll }, () => {
  test('jumping to a hit then decorating its Position draws a class-carrying highlight', async () => {
    await openReader(HOSTILE);
    const hits = await page.evaluate(() => window.harness.readerSearch('lamplighter'));
    assert.ok(hits.length >= 1, 'search found no hit for "lamplighter"');
    const hit = hits[0];

    // Land on the hit's page, then draw the highlight over the very same anchor the
    // jump used — this is the whole feature: the hit's Position is both jumpable and
    // decoratable off one content-addressed anchor.
    const landed = await page.evaluate((s) => window.harness.readerGoToSearchHit(s), hit.serialized);
    const targetSection = await page.evaluate((id) => window.harness.sectionIndexOf(id), 'preserve');
    assert.equal(landed.section, targetSection, 'goTo(hit.position) landed in the wrong section');

    let threw = false;
    try {
      await page.evaluate((s) => window.harness.readerDecorate('search-hit', s, 'search-hl'), hit.serialized);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'decorating a landed hit must not throw');

    const boxes = await overlayBoxes('search-hit', 'search-hl');
    assert.ok(boxes.length > 0, 'the highlight must paint at least one overlay box on the landed hit');
    for (const box of boxes) {
      assert.ok(box.hasClass, 'each highlight box carries the decoration class');
      assert.ok(box.width > 0 && box.height > 0, 'a painted highlight box has real geometry');
    }
  });

  test('a hit whose Position no longer resolves draws nothing and throws nothing', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.readerGoTo('start'));
    // A Position anchored to the active section but over text absent from it — the same
    // soft-miss a stale/edited hit Position would produce. Decorating it must be inert.
    const serialized = await page.evaluate(() => window.harness.buildAbsentPosition());
    if (serialized === null) return;

    let threw = false;
    try {
      await page.evaluate((s) => window.harness.readerDecorate('search-hit', s, 'search-hl'), serialized);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'a soft-miss hit must not throw');
    assert.equal(
      (await overlayBoxes('search-hit', 'search-hl')).length,
      0,
      'a soft-miss hit paints no overlay box',
    );
  });
});

describe('reader.search — landing on a mid-section page (corpus)', { ...skipAll, ...skipCorpus }, () => {
  test('a hit deep in a multi-page section lands past page 0', async () => {
    await openReader(PP);
    // item8 (Pride & Prejudice) is the largest section and spans many pages. Search
    // it, find a hit whose Position resolves to a page beyond the first, and prove
    // goTo lands there — the whole point of a jumpable hit.
    const hits = await page.evaluate(() => window.harness.readerSearch('Wickham', 40));
    assert.ok(hits.length >= 1, 'search found no "Wickham" hits in Pride & Prejudice');

    // Walk hits until one lands on a page > 0 in a multi-page section.
    let landedDeep = null;
    for (const hit of hits) {
      const landed = await page.evaluate((s) => window.harness.readerGoToSearchHit(s), hit.serialized);
      if (landed.totalPages > 1 && landed.page > 0) {
        landedDeep = landed;
        break;
      }
    }
    assert.ok(
      landedDeep !== null,
      'no "Wickham" hit resolved to a page past the first in a multi-page section',
    );
    assert.ok(landedDeep.page > 0, `jump landed on page ${landedDeep.page}, wanted > 0`);
  });
});

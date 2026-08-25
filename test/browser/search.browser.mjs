import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for full-text search's one browser-load-bearing piece:
 * `goTo(hit.position)` landing on the hit's page inside the sandboxed frame. The
 * matcher, extraction, normalization, context windowing and iterator laziness are
 * all headless (test/search.test.ts); only the jump crosses the frame boundary —
 * resolving a hit's content-anchored Position against the frame-measured section
 * text and seeking to its page — so only that is asserted here.
 *
 * Mirrors reader.browser.mjs: same serve-demo mounts, same harness.html, a graceful
 * skip when playwright is absent, and a corpus skip for the multi-page landing case.
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

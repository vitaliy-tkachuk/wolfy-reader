import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for the built paginator. Pagination geometry — Range.getClientRects,
 * multi-column fragmentation, content-visibility containment, eviction — only exists
 * in a real layout engine (the prototype proved it does not reproduce headless), so
 * these run in full Chromium. Pure transforms are covered headless in
 * test/layout.test.ts.
 *
 * Mirrors view.browser.mjs exactly: same serve-demo mounts, same harness.html, a
 * graceful skip when playwright is absent and, for the corpus cases, when the
 * gitignored corpus book is absent.
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
  console.log('layout.browser: playwright is not installed — skipping. Run `npm install` first.');
}

let corpusPresent = false;
try {
  await access(corpusBook);
  corpusPresent = true;
} catch {
  console.log('layout.browser: corpus book absent — corpus cases skipped (run `npm run fetch-corpus`).');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};
const skipCorpus = !corpusPresent ? { skip: 'the corpus book is absent' } : {};

// A section long enough to span several pages and, at the 8000-char budget,
// several chunks — so eviction and the estimate/firm transition are exercised.
function longSection(paragraphs, id = 'synthetic-long') {
  const words =
    'The paginator turns a decoded section into pages that turn without losing your place. ' +
    'Each paragraph carries enough prose to fill a column and force the flow onto a fresh page. ';
  const body = Array.from({ length: paragraphs }, (_, i) => `<p>${i + 1}. ${words.repeat(6)}</p>`).join('');
  return {
    id,
    source: `<html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`,
  };
}

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

/** The single content frame the paginator owns; asserts nothing else is mounted. */
function contentFrame() {
  const frames = page.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame — the paginator content frame');
  return frames[0];
}

async function paginateSynthetic(spec, request) {
  await page.evaluate(() => window.harness.createPaginator());
  return page.evaluate(([s, r]) => window.harness.paginateSynthetic(s, r), [spec, request]);
}

describe('page-count stability', { ...skipAll }, () => {
  test('repeated layouts of the same content and viewport give the same page count', async () => {
    const spec = longSection(40);
    const request = { mode: 'paginated', pageWidth: 700, pageHeight: 560 };
    const counts = [];
    for (let run = 0; run < 4; run += 1) {
      await paginateSynthetic(spec, request);
      const state = await page.evaluate(() => window.harness.refine());
      counts.push(state.pageCount);
    }
    assert.ok(counts[0] > 1, `expected multiple pages, got ${counts[0]}`);
    for (const count of counts) {
      assert.equal(count, counts[0], `page count drifted across identical runs: ${counts.join(', ')}`);
    }
  });

  test('the estimate firms after refine', async () => {
    const firm = await paginateSynthetic(longSection(40), {
      mode: 'paginated',
      pageWidth: 700,
      pageHeight: 560,
    });
    // After a full-measurement relayout the state is firm.
    const refined = await page.evaluate(() => window.harness.refine());
    assert.equal(refined.firm, true, 'refine did not firm the page count');
    assert.ok(refined.totalChunks > 1, `expected several chunks, got ${refined.totalChunks}`);
    assert.ok(refined.pageCount >= firm.pageCount - 2);
  });
});

describe('page ↔ Position round-trip', { ...skipAll }, () => {
  test('sampled pages round-trip through capture/resolve back to the same page', async () => {
    const state = await paginateSynthetic(longSection(50), {
      mode: 'paginated',
      pageWidth: 700,
      pageHeight: 560,
    });
    await page.evaluate(() => window.harness.refine());
    const total = state.pageCount;
    // Sample first, last, and evenly spaced interior pages.
    const samples = [...new Set([0, Math.floor(total / 3), Math.floor((2 * total) / 3), total - 1])].filter(
      (p) => p >= 0 && p < total,
    );
    for (const target of samples) {
      await page.evaluate((p) => window.harness.goToPage(p), target);
      const landed = await page.evaluate((p) => window.harness.pageOfPositionAt(p), target);
      assert.equal(landed, target, `page ${target} round-tripped to ${landed}`);
    }
  });
});

describe('paginated pages paint their content', { ...skipAll }, () => {
  // Regression: a chunk with overflow:hidden clips its own multi-column overflow,
  // so translating it to reveal a later column paints nothing — every page after
  // the first is blank. getClientRects still reports laid-out positions for the
  // clipped columns, so only a paint-aware probe (elementFromPoint respects the
  // clip) catches it. Assert real text is painted at the viewport centre on more
  // than the first page, and that the pages actually differ.
  test('the second and third pages render text, not blank columns', async () => {
    const state = await paginateSynthetic(longSection(50), {
      mode: 'paginated',
      pageWidth: 700,
      pageHeight: 560,
    });
    await page.evaluate(() => window.harness.refine());
    assert.ok(state.pageCount >= 3, `need a multi-page section, got ${state.pageCount}`);

    const frame = contentFrame();
    const paintedAtCentre = () =>
      frame.evaluate(() => {
        const root = document.getElementById('wolfyreader-content');
        const box = root.getBoundingClientRect();
        const el = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
        return el ? (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 60) : '';
      });

    const painted = [];
    for (const p of [0, 1, 2]) {
      await page.evaluate((n) => window.harness.goToPage(n), p);
      painted.push(await paintedAtCentre());
    }
    painted.forEach((text, p) => {
      assert.ok(text.length > 0, `page ${p} painted no text at its centre — the column was clipped or blank`);
    });
    assert.notEqual(painted[1], painted[0], 'page 2 shows the same text as page 1 — the turn painted nothing new');
    assert.notEqual(painted[2], painted[1], 'page 3 shows the same text as page 2 — the turn painted nothing new');
  });
});

describe('scrolled-mode parity', { ...skipAll }, () => {
  test('scrolled mode renders the same text as paginated, with no clipping', async () => {
    const spec = longSection(30);
    const geometry = { pageWidth: 700, pageHeight: 560 };

    await paginateSynthetic(spec, { mode: 'paginated', ...geometry });
    const paginatedText = await page.evaluate(() => window.harness.paginatorSectionText());

    await paginateSynthetic(spec, { mode: 'scrolled', ...geometry });
    const scrolledText = await page.evaluate(() => window.harness.paginatorSectionText());

    const normalize = (t) => t.replace(/\s+/g, ' ').trim();
    assert.equal(normalize(scrolledText), normalize(paginatedText), 'scrolled and paginated text differ');

    // The frame's own rendered textContent must carry the whole section — a mode
    // that clipped would render less than it measured.
    const frame = contentFrame();
    const renderedText = await frame.evaluate(() =>
      document.body.textContent.replace(/\s+/g, ' ').trim(),
    );
    assert.ok(
      renderedText.includes('30.'),
      'the last paragraph is missing from the scrolled render — content was clipped',
    );
  });
});

describe('chunk eviction', { ...skipAll }, () => {
  test('realized chunks stay bounded across a seek pass and re-realize on return', async () => {
    const state = await paginateSynthetic(longSection(120), {
      mode: 'paginated',
      pageWidth: 700,
      pageHeight: 560,
      windowChunks: 2,
    });
    await page.evaluate(() => window.harness.refine());
    const diag0 = await page.evaluate(() => window.harness.paginatorDiagnostics());
    assert.ok(diag0.totalChunks > 5, `expected many chunks, got ${diag0.totalChunks}`);

    const total = (await page.evaluate(() => window.harness.chapterProgress())).totalPages;
    let peakRealized = 0;
    // Seek across the whole chapter; realized-chunk count must not grow with it.
    for (let p = 0; p < total; p += Math.max(1, Math.floor(total / 20))) {
      await page.evaluate((n) => window.harness.goToPage(n), p);
      const diag = await page.evaluate(() => window.harness.paginatorDiagnostics());
      peakRealized = Math.max(peakRealized, diag.realizedChunks);
    }
    // A window of ±2 around the active chunk: realized stays a small constant,
    // never approaching the total. The generous bound proves it is bounded, not
    // that it grew to parity as the un-evicting prototype did.
    assert.ok(
      peakRealized < diag0.totalChunks,
      `realized chunks (${peakRealized}) reached the total (${diag0.totalChunks}) — nothing was evicted`,
    );
    assert.ok(peakRealized <= 8, `realized-chunk window is not bounded: peaked at ${peakRealized}`);

    // Returning to the top re-realizes the first chunk and lands on page 0.
    const landed = await page.evaluate(() => window.harness.goToPage(0));
    assert.equal(landed, 0);
    const back = await page.evaluate(() => window.harness.paginatorDiagnostics());
    assert.ok(back.realizedChunks >= 1, 'the first chunk did not re-realize on return');
  });
});

describe('corpus timing budgets (nice-to-have)', { ...skipAll, ...skipCorpus }, () => {
  test('rendering and re-layout of the largest real section stay within reference ceilings', async () => {
    const opened = await page.evaluate(() => window.harness.openBook('/corpus/gutenberg-pride-and-prejudice.epub'));
    if (opened === null) {
      console.log('  corpus book could not be opened — skipped');
      return;
    }
    await page.evaluate(() => window.harness.createPaginator());
    const render = await page.evaluate(async () => {
      const t0 = performance.now();
      await window.harness.paginateSection('item8', { mode: 'paginated', pageWidth: 700, pageHeight: 560 });
      const renderMs = performance.now() - t0;
      const t1 = performance.now();
      await window.harness.refine();
      return { renderMs, relayoutMs: performance.now() - t1 };
    });
    // Generous multiples of the recorded ceilings (render ≈20.2 ms, re-layout
    // ≈9.6 ms on that machine): this is a regression tripwire on much slower CI,
    // not a benchmark. It only fails on an order-of-magnitude regression.
    assert.ok(render.renderMs < 20.2 * 20, `render took ${render.renderMs.toFixed(1)} ms`);
    assert.ok(render.relayoutMs < 9.6 * 30, `re-layout took ${render.relayoutMs.toFixed(1)} ms`);
  });
});

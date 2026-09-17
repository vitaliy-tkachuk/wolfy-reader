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
        const root = document.getElementById('wolfy-reader-content');
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

describe('the render-input cache', { ...skipAll }, () => {
  // A 1×1 PNG, base64 — enough to prove an image resource is minted once and
  // reused, not re-decoded and re-base64'd, across same-section reflows.
  const PNG =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

  function imageSection() {
    const base = longSection(30, 'cache-proof');
    return {
      ...base,
      source: base.source.replace('</body>', '<p><img src="pic.png" alt="pic"/></p></body>'),
      resources: { 'pic.png': { mediaType: 'image/png', base64: PNG } },
    };
  }

  const GEOMETRY = { mode: 'paginated', pageWidth: 700, pageHeight: 560 };

  const counters = () => page.evaluate(() => window.harness.renderCounters());
  const frameCsp = () =>
    contentFrame().evaluate(
      () => document.querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute('content'),
    );
  const frameImageSrc = () =>
    contentFrame().evaluate(() => {
      const img = document.querySelector('img');
      return img === null ? null : img.getAttribute('src');
    });

  test('appearance and mode reflows reuse the sanitized document and minted data: URLs', async () => {
    await page.evaluate(() => window.harness.createPaginator());
    await page.evaluate(([s, r]) => window.harness.paginateCounted(s, r), [imageSection(), GEOMETRY]);
    assert.deepEqual(await counters(), { sectionLoads: 1, resourceLoads: 1 }, 'first render decodes once');

    const cspBefore = await frameCsp();
    const srcBefore = await frameImageSrc();
    assert.ok(srcBefore !== null && srcBefore.startsWith('data:image/png;base64,'), 'the image is served as data:');

    // A reflowing appearance tick re-assembles the srcdoc (the theme rides it),
    // but the section-invariant inputs must be reused — no re-decode, no
    // re-sanitize, no image re-base64.
    await page.evaluate(() =>
      window.harness.paginatorApplyAppearance('#wolfy-reader-content{font-size:24px}'),
    );
    assert.deepEqual(await counters(), { sectionLoads: 1, resourceLoads: 1 }, 'a font-size tick re-decoded the section');

    // Security posture unchanged: the image is still the same data: URL (never
    // blob:), and the CSP nonce is minted fresh per render, cache hit or not.
    const srcAfter = await frameImageSrc();
    assert.equal(srcAfter, srcBefore, 'the reflow must reuse the exact minted data: URL');
    const cspAfter = await frameCsp();
    assert.notEqual(cspAfter, cspBefore, 'the CSP nonce must be fresh on every render, even a cache hit');
    assert.match(cspAfter, /script-src 'nonce-/, 'the CSP still names a script nonce');

    // A mode switch reflows through the same path and must also hit the cache.
    await page.evaluate(() => window.harness.paginatorSwitchMode('scrolled'));
    assert.deepEqual(await counters(), { sectionLoads: 1, resourceLoads: 1 }, 'a mode switch re-decoded the section');

    // A different section invalidates: the frame shows the new section's text.
    await page.evaluate(
      ([s, r]) => window.harness.paginateSynthetic(s, r),
      [longSection(5, 'cache-other'), GEOMETRY],
    );
    const swapped = await contentFrame().evaluate(() => document.body.textContent.includes('5. The paginator'));
    assert.ok(swapped, 'a new section must render its own content, not the cached one');
  });
});

describe('decoration realization window', { ...skipAll }, () => {
  test('a decoration in the last chunk realizes only its target chunk', async () => {
    await paginateSynthetic(longSection(120, 'decorate-tail'), {
      mode: 'paginated',
      pageWidth: 700,
      pageHeight: 560,
      windowChunks: 2,
    });
    await page.evaluate(() => window.harness.refine());
    await page.evaluate(() => window.harness.goToPage(0));
    const before = await page.evaluate(() => window.harness.paginatorDiagnostics());
    assert.ok(before.totalChunks > 5, `expected many chunks, got ${before.totalChunks}`);
    assert.ok(before.realizedChunks < before.totalChunks, 'the eviction window must be active before decorating');

    // Anchor the decoration near the section's end — the last chunk. Locating it
    // must realize that chunk alone, not force-realize every chunk on the walk.
    const after = await page.evaluate(async () => {
      const text = await window.harness.paginatorSectionText();
      return window.harness.paginatorDecorateAt('tail', text.length - 120, 'hl');
    });
    assert.ok(
      after.realizedChunks <= before.realizedChunks + 2,
      `decorating the tail realized ${after.realizedChunks} chunks (was ${before.realizedChunks}) — earlier chunks were force-realized`,
    );
    assert.ok(
      after.realizedChunks < after.totalChunks,
      'decorating the tail must not realize the whole section',
    );
  });
});

describe('corpus timing budgets (nice-to-have)', { ...skipAll, ...skipCorpus }, () => {
  // The ceiling is expressed in machine units, not milliseconds. A millisecond
  // ceiling measured on one laptop says nothing on a shared 2-core runner, where
  // the same commit has measured 574 ms and 1139 ms for identical work. So the
  // page first times a fixed text-layout loop — the machine unit — and the
  // paginator's cost is asserted as a multiple of it: machine speed cancels, a
  // paginator regression does not.
  //
  // The calibration deliberately does not use the paginator. A ratio between two
  // paginate calls would move with both, so a uniform slowdown would divide out
  // and the guard would be blind to exactly the regression it exists to catch.
  //
  // Sampled on an M-series laptop: unit 3.4-4.6 ms, render 61-86 units, re-layout
  // 0.9-3.9 units. On ubuntu-latest: unit 6.5-11.0 ms, render 75-100 units,
  // re-layout 0.9-5.1 units. Calibration removes most of the machine difference —
  // 830 ms there and 250 ms here are ~75u and ~70u — but not all of it: the paginate
  // path includes frame round-trips that do not scale with pure layout speed, so the
  // ratio itself still drifts ~30% between runners. The thresholds clear the widest
  // observation by ~2.5x. An order-of-magnitude tripwire, not a benchmark;
  // `npm run bench` is where real numbers live.
  const RENDER_UNITS = 250;
  const RELAYOUT_UNITS = 25;

  test('rendering and re-layout of the largest real section stay within reference ceilings', async () => {
    const opened = await page.evaluate(() => window.harness.openBook('/corpus/gutenberg-pride-and-prejudice.epub'));
    if (opened === null) {
      console.log('  corpus book could not be opened — skipped');
      return;
    }
    await page.evaluate(() => window.harness.createPaginator());
    const measured = await page.evaluate(async () => {
      // A fixed text-layout workload: rewrite a paragraph and force layout by
      // reading its box. Same subsystem the paginator leans on, no paginator
      // involved. The median of three absorbs a stray scheduling hiccup.
      const calibrationMs = () => {
        const host = document.createElement('div');
        host.style.cssText = 'position:absolute;left:-9999px;top:0;width:640px;font:16px/1.5 serif;';
        document.body.append(host);
        const para = '<p>' + 'the quick brown fox jumps over the lazy dog '.repeat(40) + '</p>';
        const t0 = performance.now();
        for (let i = 0; i < 40; i += 1) {
          host.innerHTML = para;
          void host.getBoundingClientRect().height;
        }
        const ms = performance.now() - t0;
        host.remove();
        return ms;
      };
      const time = async (fn) => {
        const t = performance.now();
        await fn();
        return performance.now() - t;
      };
      calibrationMs(); // warm-up, discarded
      const unit = [calibrationMs(), calibrationMs(), calibrationMs()].sort((a, b) => a - b)[1];
      const request = { mode: 'paginated', pageWidth: 700, pageHeight: 560 };
      const renderMs = await time(() => window.harness.paginateSection('item8', request));
      // relayout(), not refine(): refine returns immediately once the state is
      // firm, so timing it measures an early return rather than a re-layout.
      const relayoutMs = await time(() => window.harness.relayout());
      return { unit, renderMs, relayoutMs };
    });

    const renderUnits = measured.renderMs / measured.unit;
    const relayoutUnits = measured.relayoutMs / measured.unit;
    const report =
      `unit=${measured.unit.toFixed(1)}ms render=${measured.renderMs.toFixed(1)}ms (${renderUnits.toFixed(1)}u) ` +
      `re-layout=${measured.relayoutMs.toFixed(1)}ms (${relayoutUnits.toFixed(1)}u)`;
    // Printed on success too: the ratios from real runners are the only evidence
    // for tightening these thresholds later.
    console.log(`  timing: ${report}`);
    assert.ok(renderUnits < RENDER_UNITS, `render exceeded ${RENDER_UNITS} machine units — ${report}`);
    assert.ok(relayoutUnits < RELAYOUT_UNITS, `re-layout exceeded ${RELAYOUT_UNITS} machine units — ${report}`);
  });
});

describe('publisher box model on html/body', { ...skipAll }, () => {
  // Regression: Gutenberg's stylesheet sets body{margin-left:10%;margin-right:10%}
  // (under @media screen), which outranks the frame's body{margin:0} reset. The
  // chunks are positioned inside the body box, so every page painted shifted right
  // by the margin and clipped by the same amount on the right edge. The paginator
  // owns page geometry, so the frame pins html/body/root to a zero-inset box.
  test('a body margin from the book does not shift or clip the page', async () => {
    const spec = longSection(10, 'body-margin');
    spec.source = spec.source.replace(
      '<body>',
      '<head><style>@media screen{body{margin-left:10%;margin-right:10%;padding:2em;border:5px solid red;max-width:20em}}</style></head><body>',
    );
    const pageWidth = 700;
    const columnGap = 40;
    for (const mode of ['paginated', 'scrolled']) {
      await paginateSynthetic(spec, { mode, pageWidth, pageHeight: 560, columnGap });
      const frame = contentFrame();
      const boxes = await frame.evaluate(() => {
        const body = document.body.getBoundingClientRect();
        const root = document.getElementById('wolfy-reader-content').getBoundingClientRect();
        const chunk = document.querySelector('.wolfy-reader-chunk').getBoundingClientRect();
        return { body: { left: body.left, width: body.width }, root: { left: root.left, width: root.width }, chunk: { left: chunk.left, width: chunk.width } };
      });
      assert.equal(boxes.body.left, 0, `${mode}: the body was shifted by the book's margin`);
      assert.equal(boxes.root.left, 0, `${mode}: the root was shifted`);
      assert.equal(boxes.root.width, pageWidth, `${mode}: the root was narrowed`);
      if (mode === 'paginated') {
        assert.equal(boxes.chunk.left, columnGap, 'the first column does not start at the edge margin');
        assert.equal(boxes.chunk.width, pageWidth - 2 * columnGap, 'the column does not fit inside both edge margins');
      } else {
        assert.equal(boxes.chunk.left, 0);
        assert.equal(boxes.chunk.width, pageWidth);
      }
    }
  });
});

describe('tall image containment', { ...skipAll }, () => {
  // Regression: the reset capped replaced elements at the column width only. A
  // portrait cover (Gutenberg wraps it in <svg viewBox width="100%" height="100%">)
  // sized to the column width was far taller than the page, and a monolithic box
  // does not fragment across columns, so the page clipped its lower half.
  test('an image taller than the page is capped at the page height', async () => {
    const pageWidth = 700;
    const pageHeight = 560;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1824 2726" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">' +
      '<rect width="1824" height="2726" fill="#345"/></svg>';
    const spec = {
      id: 'tall-cover',
      source:
        '<html xmlns="http://www.w3.org/1999/xhtml"><body>' +
        `<div>${svg}</div><p><img src="tall.png" alt="tall"/></p></body></html>`,
      // A 1×3 PNG scales to 700×2100 at column width; a real portrait cover's shape.
      resources: {
        'tall.png': {
          mediaType: 'image/png',
          base64:
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAADCAIAAADdv/LVAAAAEUlEQVR4nGNgYGD4z8DAAABKAAX/2hTn5AAAAABJRU5ErkJggg==',
        },
      },
    };
    await paginateSynthetic(spec, { mode: 'paginated', pageWidth, pageHeight });
    await page.evaluate(() => window.harness.refine());
    const boxes = await contentFrame().evaluate(() => {
      const root = document.getElementById('wolfy-reader-content').getBoundingClientRect();
      const measure = (el) => {
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height, width: r.width };
      };
      return { root: measure({ getBoundingClientRect: () => root }), svg: measure(document.querySelector('svg')), img: measure(document.querySelector('img')) };
    });
    for (const [name, box] of [['svg', boxes.svg], ['img', boxes.img]]) {
      assert.ok(box.height > 0, `${name} did not render`);
      assert.ok(box.height <= pageHeight + 1, `${name} is ${box.height}px tall on a ${pageHeight}px page`);
    }
    assert.ok(boxes.svg.bottom <= boxes.root.bottom + 1, `the cover's bottom (${boxes.svg.bottom}) is below the page (${boxes.root.bottom})`);
  });
});

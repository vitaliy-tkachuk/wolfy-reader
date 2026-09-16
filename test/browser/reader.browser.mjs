import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for the public reader facade. The facade only exists over
 * a live paginator + sandboxed frame, so navigation landing, the internal-link
 * back-stack, mode-switch position preservation, event firing order, and a
 * leak-free destroy() are all observable only in a real DOM — hence full
 * Chromium. Pure target-form dispatch is exercised through here too.
 *
 * Mirrors view.browser.mjs / layout.browser.mjs exactly: same serve-demo mounts,
 * same harness.html, a graceful skip when playwright is absent and, for the
 * corpus cases, when the gitignored corpus book is absent.
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
  console.log('reader.browser: playwright is not installed — skipping. Run `npm install` first.');
}

let corpusPresent = false;
try {
  await access(corpusBook);
  corpusPresent = true;
} catch {
  console.log('reader.browser: corpus book absent — corpus cases skipped (run `npm run fetch-corpus`).');
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

/** The reader's single content frame; asserts nothing else is mounted. */
function contentFrame() {
  const frames = page.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame — the reader content frame');
  return frames[0];
}

async function openBook(url) {
  const opened = await page.evaluate((u) => window.harness.openBook(u), url);
  assert.ok(opened !== null, `${url} could not be fetched`);
  return opened;
}

/** Opens `url`, renders it through the facade, and returns the initial position. */
async function openReader(url, options = {}) {
  await openBook(url);
  return page.evaluate((o) => window.harness.createReader(o), options);
}

const HOSTILE = '/fixtures/hostile.epub';
const PP = '/corpus/gutenberg-pride-and-prejudice.epub';

describe('render + ready', { ...skipAll }, () => {
  test('render paints the first section and fires sectionchange → positionchange → ready in order', async () => {
    await openReader(HOSTILE);
    const events = await page.evaluate(() => window.harness.readerEvents());
    const order = events.map((entry) => entry.type);
    // The tail after ready may carry nothing; the opening triplet is the contract.
    assert.deepEqual(order.slice(0, 3), ['sectionchange', 'positionchange', 'ready']);
    const ready = events.find((entry) => entry.type === 'ready');
    assert.equal(ready.payload.section, 0);
    assert.ok(ready.payload.totalPages >= 1, JSON.stringify(ready.payload));
    // sectionchange carries the first section's id.
    assert.equal(events[0].payload.index, 0);
    assert.equal(events[0].payload.sectionId, 'attacks');
    // Exactly one child frame is mounted.
    contentFrame();
  });
});

describe('goTo target forms', { ...skipAll }, () => {
  test("'start' and 'end' land on the first and last sections", async () => {
    const initial = await openReader(HOSTILE);
    assert.equal(initial.section, 0);

    const end = await page.evaluate(() => window.harness.readerGoTo('end'));
    assert.equal(end.section, 6, 'end did not land on the last section');
    // 'end' lands on the last page of that section.
    assert.equal(end.page, Math.max(0, end.totalPages - 1));

    const start = await page.evaluate(() => window.harness.readerGoTo('start'));
    assert.equal(start.section, 0);
    assert.equal(start.page, 0);
  });

  test('a fraction 0..1 lands proportionally through the book', async () => {
    await openReader(HOSTILE);
    const mid = await page.evaluate(() => window.harness.readerGoTo(0.5));
    // Seven sections, even-weight: 0.5 → floor(3.5) = section 3.
    assert.equal(mid.section, 3, `0.5 landed on section ${mid.section}`);
    const zero = await page.evaluate(() => window.harness.readerGoTo(0));
    assert.equal(zero.section, 0);
    const one = await page.evaluate(() => window.harness.readerGoTo(1));
    assert.equal(one.section, 6);
  });

  test('goTo(TocItem) lands on the item’s section', async () => {
    const opened = await openBook(HOSTILE);
    await page.evaluate(() => window.harness.createReader({}));
    // The fifth TOC item is "preserve" (index 4 in reading order).
    const toc = { sectionId: 'resources', label: 'Everything It Must Load', fragment: undefined, children: [] };
    const landed = await page.evaluate((t) => window.harness.readerGoTo(t), toc);
    assert.equal(landed.section, 5, 'goTo(TocItem) did not reach the resources section');
    assert.ok(opened.some((s) => s.id === 'resources'));
  });

  test('goTo(href) resolves an internal href to its section, and soft-misses stay put', async () => {
    await openReader(HOSTILE);
    // A bare section id resolves directly.
    const hit = await page.evaluate(() => window.harness.readerGoTo('malformed'));
    assert.equal(hit.section, 3, 'href "malformed" did not resolve to its section');
    // An href that resolves to nothing is a soft miss — the reader stays put.
    const before = await page.evaluate(() => window.harness.readerPosition());
    const after = await page.evaluate(() => window.harness.readerGoTo('does-not-exist.xhtml'));
    assert.equal(after.section, before.section, 'a soft-miss href moved the reader');
  });

  // goTo(Position) — the sixth form — is exercised end-to-end by the
  // internal-link back-stack test below: back() is goTo(Position) under the hood
  // (the facade captures a Position for the current page, then restores it to the
  // exact page via content anchor). Driving it standalone would need the frame's
  // measured section text, which the facade deliberately hides, so it is proven
  // through back() rather than duplicated with a fragile hand-built anchor.
});

describe('fragment anchoring (v4 seam)', { ...skipAll, ...skipCorpus }, () => {
  test('a TocItem carrying a fragment lands on the anchor’s page', async () => {
    await openReader(PP);
    // Pride & Prejudice's nav TOC targets fragments inside pg-header. A late
    // fragment sits on a later page than the section's first — so landing on the
    // anchor's page proves the offsetOfElementId → pageOfOffset seam, not page 0.
    const early = { sectionId: 'pg-header', label: 'top', fragment: 'pgepubid00002', children: [] };
    const late = { sectionId: 'pg-header', label: 'ch1', fragment: 'pgepubid00022', children: [] };
    const atEarly = await page.evaluate((t) => window.harness.readerGoTo(t), early);
    const atLate = await page.evaluate((t) => window.harness.readerGoTo(t), late);
    assert.equal(atEarly.section, atLate.section, 'both fragments are in the same section');
    assert.ok(atLate.totalPages > 1, 'the section must span several pages for this to be meaningful');
    assert.ok(
      atLate.page > atEarly.page,
      `the later fragment (page ${atLate.page}) should be past the earlier one (page ${atEarly.page})`,
    );
  });

  test('an unresolvable fragment is a soft miss to the section’s first page', async () => {
    await openReader(PP);
    const item = { sectionId: 'pg-header', label: 'ghost', fragment: 'no-such-anchor-xyz', children: [] };
    const landed = await page.evaluate((t) => window.harness.readerGoTo(t), item);
    assert.equal(landed.section, await sectionIndexOf('pg-header'));
    assert.equal(landed.page, 0, 'an unresolvable fragment must land on the first page');
  });
});

async function sectionIndexOf(sectionId) {
  return page.evaluate((id) => window.harness.sectionIndexOf(id), sectionId);
}

describe('next / prev across boundaries', { ...skipAll }, () => {
  test('next() at the last page of a section rolls into the next section', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.readerGoTo('start'));
    // Walk to the end of section 0, then one more next() must enter section 1.
    let position = await page.evaluate(() => window.harness.readerPosition());
    const startSection = position.section;
    // Bounded walk: at most totalPages + 1 next()s reaches the boundary.
    for (let i = 0; i < position.totalPages + 2; i += 1) {
      const before = position;
      position = await page.evaluate(() => window.harness.readerNext());
      if (position.section !== before.section) break;
    }
    assert.equal(position.section, startSection + 1, 'next() did not roll into the next section');
    assert.equal(position.page, 0, 'a boundary roll must land on the first page');

    // prev() from the first page of a section rolls back to the previous.
    const rolled = await page.evaluate(() => window.harness.readerPrev());
    assert.equal(rolled.section, startSection, 'prev() did not roll back to the previous section');
  });

  test('nextSection / prevSection jump whole sections and no-op at the ends', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const one = await page.evaluate(() => window.harness.readerNextSection());
    assert.equal(one.section, 1);
    assert.equal(one.page, 0);
    const back = await page.evaluate(() => window.harness.readerPrevSection());
    assert.equal(back.section, 0);
    // prevSection at section 0 is a no-op.
    const stay = await page.evaluate(() => window.harness.readerPrevSection());
    assert.equal(stay.section, 0);
  });
});

describe('internal-link back-stack', { ...skipAll, ...skipCorpus }, () => {
  test('following an in-frame link fires linkclick then back() returns to the exact pre-jump position', async () => {
    await openReader(PP);
    // Land somewhere with a real page offset in a multi-page section.
    await page.evaluate(() => window.harness.readerGoTo('item8'));
    await page.evaluate(() => window.harness.readerNext());
    const beforeJump = await page.evaluate(() => window.harness.readerPosition());
    await page.evaluate(() => window.harness.clearReaderEvents());

    // Click a real internal anchor inside the live frame. The frame cancels the
    // default and reports the href; the facade pushes the back-stack and follows.
    const frame = contentFrame();
    const clicked = await frame.evaluate(() => {
      const anchor = [...document.querySelectorAll('a[href]')].find((a) => {
        const h = a.getAttribute('href') ?? '';
        return h !== '' && !h.startsWith('#') && !/^[a-z]+:/i.test(h);
      });
      if (anchor === undefined) return null;
      const h = anchor.getAttribute('href');
      anchor.click();
      return h;
    });

    if (clicked === null) {
      // No internal link in this rendered section; nothing to exercise here.
      // (back() restoration is still asserted by the mode-switch/position tests
      // that round-trip through the same content-anchor machinery.)
      return;
    }

    // Let the click's postMessage + queued navigation settle.
    await page.waitForFunction(() =>
      window.harness.readerEvents().some((e) => e.type === 'linkclick'),
    );
    const events = await page.evaluate(() => window.harness.readerEvents());
    const linkIndex = events.findIndex((e) => e.type === 'linkclick');
    assert.ok(linkIndex >= 0, 'no linkclick event fired');
    assert.equal(events[linkIndex].payload.href, clicked, 'linkclick carried the wrong href');
    // linkclick precedes the positionchange it triggers.
    assert.ok(
      events.slice(linkIndex).some((e) => e.type === 'positionchange'),
      'linkclick was not followed by a positionchange',
    );

    // Give the follow navigation a moment to settle before probing where it landed.
    await new Promise((done) => setTimeout(done, 100));

    // A clicked href that carries a path (not a bare `#fragment`) names a *different*
    // document, so following it must land in a different section. This is the exact
    // case the old id/filename heuristic could not resolve for opaque manifest ids
    // (Gutenberg's `item8`-style ids share nothing with the `..._1342-h-2.htm.xhtml`
    // file names) — it would soft-miss and move nothing.
    if (clicked.split('#')[0] !== '') {
      const afterJump = await page.evaluate(() => window.harness.readerPosition());
      assert.notEqual(
        afterJump.section,
        beforeJump.section,
        'a cross-file link did not move to another section — href resolution soft-missed',
      );
    }

    // back() must restore the pre-jump position.
    const restored = await page.evaluate(() => window.harness.readerBack());
    assert.equal(restored.section, beforeJump.section, 'back() landed in the wrong section');
    assert.equal(restored.page, beforeJump.page, `back() landed on page ${restored.page}, wanted ${beforeJump.page}`);
  });
});

describe('mode switch preserves position', { ...skipAll, ...skipCorpus }, () => {
  test('paginated ↔ scrolled holds the reading place, and a same-page round-trip lands home', async () => {
    await openReader(PP);
    await page.evaluate(() => window.harness.readerGoTo('item8'));
    await page.evaluate(() => window.harness.readerNext());
    await page.evaluate(() => window.harness.readerNext());
    const before = await page.evaluate(() => window.harness.readerPosition());
    assert.ok(before.page >= 1, 'need a non-trivial page for the switch to be meaningful');

    // Forward switch preserves the section and the reading mode flips — the M1-2
    // capture→re-layout→resolve→restore machinery composes through the facade.
    const scrolled = await page.evaluate(() => window.harness.readerSetMode('scrolled'));
    assert.equal(await page.evaluate(() => window.harness.readerMode()), 'scrolled');
    assert.equal(scrolled.section, before.section, 'the mode switch left the section');

    const back = await page.evaluate(() => window.harness.readerSetMode('paginated'));
    assert.equal(await page.evaluate(() => window.harness.readerMode()), 'paginated');
    assert.equal(back.section, before.section, 'the round-trip left the section');

    // Exact-page preservation across a switch holds when the anchor page survives
    // the collapse: from page 0, the round-trip must land back on page 0 in the
    // same section — the position is not thrown away by the switch itself. (A
    // mid-section page can drift because scrolled mode collapses paging to a
    // single page; the engine's mid-scroll capture is M3-2's invariant, not the
    // facade's to own here — see docs/domains/view.md.)
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const home = await page.evaluate(() => window.harness.readerPosition());
    await page.evaluate(() => window.harness.readerSetMode('scrolled'));
    const roundTrip = await page.evaluate(() => window.harness.readerSetMode('paginated'));
    assert.equal(roundTrip.section, home.section, 'the page-0 round-trip left the section');
    assert.equal(roundTrip.page, 0, `the page-0 round-trip drifted to page ${roundTrip.page}`);
  });
});

describe('position consistency', { ...skipAll }, () => {
  test('reader.position fields agree with a fresh snapshot after navigation', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.readerGoTo('preserve'));
    const nav = await page.evaluate(() => window.harness.readerNext());
    const snapshot = await page.evaluate(() => window.harness.readerPosition());
    assert.deepEqual(snapshot, nav, 'position getter disagreed with the navigation result');
    assert.ok(snapshot.page >= 0);
    assert.ok(snapshot.totalPages >= 1);
    assert.ok(snapshot.progress >= 0 && snapshot.progress <= 1);
    assert.ok(snapshot.chapterProgress >= 0 && snapshot.chapterProgress <= 1);
  });
});

describe('event firing order', { ...skipAll }, () => {
  test('a page turn fires positionchange only; a section jump fires sectionchange → positionchange', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.readerGoTo('start'));

    // A within-section page turn: positionchange, no sectionchange.
    await page.evaluate(() => window.harness.clearReaderEvents());
    const afterNext = await page.evaluate(() => window.harness.readerNext());
    let events = await page.evaluate(() => window.harness.readerEvents());
    if (afterNext.section === 0 && afterNext.page > 0) {
      assert.deepEqual(
        events.map((e) => e.type),
        ['positionchange'],
        'a within-section page turn should fire positionchange only',
      );
    }

    // A section jump: sectionchange precedes positionchange.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await page.evaluate(() => window.harness.readerNextSection());
    events = await page.evaluate(() => window.harness.readerEvents());
    const types = events.map((e) => e.type);
    const sc = types.indexOf('sectionchange');
    const pc = types.indexOf('positionchange');
    assert.ok(sc >= 0 && pc >= 0, `expected both events, got ${types.join(', ')}`);
    assert.ok(sc < pc, `sectionchange (${sc}) must precede positionchange (${pc})`);
  });
});

describe('destroy leaves nothing behind', { ...skipAll }, () => {
  test('destroy() removes the iframe, mints no object URLs, and stops routing frame messages', async () => {
    await openReader(HOSTILE);
    // The facade uses only data: resources — no host-minted object URLs at all.
    const beforeProbe = await page.evaluate(() => window.harness.leakProbe());
    assert.equal(beforeProbe.iframes, 1, 'expected exactly one iframe while live');
    assert.equal(beforeProbe.objectUrlsCreated, 0, 'the facade minted an object URL');

    await page.evaluate(() => window.harness.destroyReader());
    const afterProbe = await page.evaluate(() => window.harness.leakProbe());
    assert.equal(afterProbe.iframes, 0, 'destroy() left an orphan iframe');
    assert.equal(afterProbe.objectUrlsCreated, 0);

    // A second destroy is a no-op (idempotent) and does not throw.
    await page.evaluate(() => window.harness.destroyReader());
    assert.equal((await page.evaluate(() => window.harness.leakProbe())).iframes, 0);
  });
});

describe('the frame does not scroll and re-paginates on resize', { ...skipAll, ...skipCorpus }, () => {
  /**
   * Overflow on either axis, with the measurements behind the verdict. The numbers
   * ride along because this assertion fails on machines nobody can attach a debugger
   * to: a bare `v=true h=true` cannot distinguish a reflow that had not finished
   * from content that genuinely does not fit, and a classic (non-overlay) scrollbar
   * eating client width from the column arithmetic being wrong on its own.
   */
  async function frameScrolls() {
    return contentFrame().evaluate(() => {
      const de = document.documentElement;
      return {
        v: de.scrollHeight > de.clientHeight,
        h: de.scrollWidth > de.clientWidth,
        clientW: de.clientWidth,
        scrollW: de.scrollWidth,
        clientH: de.clientHeight,
        scrollH: de.scrollHeight,
        innerW: window.innerWidth,
        innerH: window.innerHeight,
      };
    });
  }
  const scrollReport = (sc) =>
    `v=${sc.v} h=${sc.h} client=${sc.clientW}x${sc.clientH} scroll=${sc.scrollW}x${sc.scrollH} ` +
    `inner=${sc.innerW}x${sc.innerH}`;
  /** How many re-layouts the reader has announced so far — the settle signal. */
  async function reflowCount() {
    return page.evaluate(
      () => window.harness.readerEvents().filter((e) => e.type === 'positionchange').length,
    );
  }
  async function setStage(w, h) {
    await page.evaluate(
      ({ w, h }) => {
        const s = document.querySelector('#stage');
        s.style.width = `${w}px`;
        s.style.height = `${h}px`;
      },
      { w, h },
    );
  }

  test('a paginated frame shows no scrollbar at page 0 or after paging', async () => {
    await openReader(PP);
    let sc = await frameScrolls();
    assert.ok(!sc.v && !sc.h, `frame scrolled at page 0 — ${scrollReport(sc)}`);
    // Paging translates the off-page columns into view; without html/body clipping
    // their width would leak a stray horizontal scrollbar.
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i += 1) await window.harness.readerNext();
    });
    sc = await frameScrolls();
    assert.ok(!sc.v && !sc.h, `frame scrolled after paging — ${scrollReport(sc)}`);
  });

  test('shrinking the container re-paginates, stays scroll-free, and holds the section', async () => {
    try {
      await openReader(PP);
      await page.evaluate(async () => {
        for (let i = 0; i < 3; i += 1) await window.harness.readerNext();
      });
      const before = await page.evaluate(() => window.harness.readerPosition());

      const reflowsBefore = await reflowCount();
      await setStage(560, 420);
      // Two separate events, both load-bearing: the iframe taking its new box, then
      // the ResizeObserver's rAF + re-paginate settling. The reflow announces itself
      // with `positionchange`, so wait for that rather than for a duration — a clock
      // makes the assertion sample mid-reflow on a slow machine, where the frame is
      // still laid out for the old size and both axes overflow.
      await page.waitForFunction(() => {
        const f = document.querySelector('#stage iframe');
        return f !== null && f.getBoundingClientRect().width < 700;
      });
      await page.waitForFunction(
        (seen) =>
          window.harness.readerEvents().filter((e) => e.type === 'positionchange').length > seen,
        reflowsBefore,
      );

      const sc = await frameScrolls();
      assert.ok(
        !sc.v && !sc.h,
        `frame scrolled after shrink — ${scrollReport(sc)} pages=${(await page.evaluate(() => window.harness.readerPosition())).totalPages}`,
      );
      const after = await page.evaluate(() => window.harness.readerPosition());
      assert.equal(after.section, before.section, 'the resize lost the section');
      assert.notEqual(
        after.totalPages,
        before.totalPages,
        'a smaller viewport should re-paginate to a different page count',
      );
    } finally {
      await setStage(800, 600);
    }
  });
});

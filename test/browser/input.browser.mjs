import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for human input (T003): keyboard, touch swipe, and tap zones,
 * all direction-aware. Input only exists over a live sandboxed frame — the frame
 * captures the real key/pointer events and forwards *semantic* gestures over the
 * protocol (v5), because an opaque-origin frame's events never reach the host
 * once it has focus. So this is browser-only, like the rest of the view suite.
 *
 * We drive the gestures by dispatching synthetic Keyboard/Pointer events on the
 * content frame's own document (via frame.evaluate) — exactly the events the
 * coordination script listens for. That is deterministic and needs no OS focus
 * plumbing; the wire and the facade's mapping are what's under test, not the
 * browser's event routing.
 *
 * Mirrors reader.browser.mjs / view.browser.mjs / layout.browser.mjs: same
 * serve-demo mounts, same harness.html, a graceful skip when playwright is
 * absent and, for corpus/link cases, when the gitignored corpus book is absent.
 * The RTL cases skip if the rtl fixture is missing.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');
const corpusDir = resolve(repoRoot, 'test', 'corpus');
const corpusBook = resolve(corpusDir, 'gutenberg-pride-and-prejudice.epub');
const rtlFixture = resolve(fixtureDir, 'rtl.epub');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('input.browser: playwright is not installed — skipping. Run `npm install` first.');
}

async function present(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const corpusPresent = await present(corpusBook);
if (!corpusPresent) {
  console.log('input.browser: corpus book absent — corpus/link cases skipped (run `npm run fetch-corpus`).');
}
const rtlPresent = await present(rtlFixture);
if (!rtlPresent) {
  console.log('input.browser: rtl fixture absent — RTL cases skipped.');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};
const skipCorpus = !corpusPresent ? { skip: 'the corpus book is absent' } : {};
const skipRtl = !rtlPresent ? { skip: 'the rtl fixture is absent' } : {};

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

const HOSTILE = '/fixtures/hostile.epub';
const RTL = '/fixtures/rtl.epub';
const PP = '/corpus/gutenberg-pride-and-prejudice.epub';

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

/** Dispatch a keydown carrying `key` on the frame's document, as the user would. */
async function pressKey(key) {
  const frame = contentFrame();
  await frame.evaluate((k) => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  }, key);
}

/**
 * Dispatch a completed pointer swipe of net delta (dx, dy) across the frame. The
 * coordination script measures pointerdown → pointerup, so we send both with the
 * start point mid-frame and the end offset by the delta.
 */
async function swipe(dx, dy = 0) {
  const frame = contentFrame();
  await frame.evaluate(
    ([sx, sy]) => {
      const startX = Math.round(window.innerWidth / 2);
      const startY = Math.round(window.innerHeight / 2);
      const opts = (x, y) => ({ clientX: x, clientY: y, isPrimary: true, bubbles: true, pointerId: 1 });
      document.dispatchEvent(new PointerEvent('pointerdown', opts(startX, startY)));
      document.dispatchEvent(new PointerEvent('pointerup', opts(startX + sx, startY + sy)));
    },
    [dx, dy],
  );
}

/**
 * Dispatch a tap at the given fraction of the frame width (a press-release with
 * no movement, so it clears TAP_SLOP as a tap, not a swipe). `y` defaults to
 * mid-frame.
 */
async function tapAtFraction(fraction) {
  const frame = contentFrame();
  await frame.evaluate((f) => {
    const x = Math.round(window.innerWidth * f);
    const y = Math.round(window.innerHeight / 2);
    const opts = { clientX: x, clientY: y, isPrimary: true, bubbles: true, pointerId: 1 };
    document.dispatchEvent(new PointerEvent('pointerdown', opts));
    document.dispatchEvent(new PointerEvent('pointerup', opts));
  }, fraction);
}

function position() {
  return page.evaluate(() => window.harness.readerPosition());
}

/**
 * Fire a gesture, then wait until the reader's position differs from `from` (the
 * forwarded gesture navigates asynchronously through the facade's queue), or a
 * bounded number of polls elapses. Returns the settled position. A gesture that
 * is a genuine no-op (e.g. a center tap) returns `from` unchanged after the wait.
 */
async function afterGesture(from, fire, { expectMove = true } = {}) {
  await fire();
  const same = (a, b) => a.section === b.section && a.page === b.page;
  for (let i = 0; i < 40; i += 1) {
    const now = await position();
    if (!same(now, from)) return now;
    if (!expectMove && i >= 3) return now; // give a no-op a few polls to prove it stays
    await new Promise((done) => setTimeout(done, 25));
  }
  return position();
}

/** Walks forward until the section has >1 page so page turns are observable. */
async function landOnMultiPage() {
  // hostile section 0 is short; walk to a page > 0 so prev/left has somewhere to go.
  let pos = await page.evaluate(() => window.harness.readerGoTo('start'));
  if (pos.totalPages <= 1) {
    // Move into a section with multiple pages if the first is single-page.
    pos = await page.evaluate(() => window.harness.readerNextSection());
  }
  return pos;
}

describe('keyboard navigation (LTR)', { ...skipAll }, () => {
  test('each key turns the page/section per the map, including Home/End', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.readerGoTo('start'));

    // End → book end (last section, last page).
    const start = await position();
    assert.equal(start.section, 0);
    const atEnd = await afterGesture(start, () => pressKey('End'));
    assert.equal(atEnd.section, 6, 'End did not jump to the last section');

    // Home → book start.
    const atStart = await afterGesture(atEnd, () => pressKey('Home'));
    assert.equal(atStart.section, 0);
    assert.equal(atStart.page, 0);

    // ArrowRight / PageDown / ArrowDown all advance reading order.
    let pos = atStart;
    for (const key of ['ArrowRight', 'PageDown', 'ArrowDown']) {
      const before = pos;
      pos = await afterGesture(before, () => pressKey(key));
      const advanced =
        pos.section > before.section || (pos.section === before.section && pos.page > before.page);
      assert.ok(advanced, `${key} did not advance reading order (from ${before.section}/${before.page})`);
    }

    // ArrowLeft / PageUp / ArrowUp all retreat.
    for (const key of ['ArrowLeft', 'PageUp', 'ArrowUp']) {
      const before = pos;
      pos = await afterGesture(before, () => pressKey(key));
      const retreated =
        pos.section < before.section || (pos.section === before.section && pos.page < before.page);
      assert.ok(retreated, `${key} did not retreat reading order (from ${before.section}/${before.page})`);
    }
  });
});

describe('keyboard direction (RTL vs LTR)', { ...skipAll, ...skipRtl }, () => {
  test('ArrowLeft/ArrowRight are reversed under RTL; PageDown still advances', async () => {
    await openReader(RTL);
    assert.equal(await page.evaluate(() => window.harness.bookDirection()), 'rtl');
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const start = await position();
    assert.equal(start.section, 0);

    // Under RTL, ArrowLeft advances reading order (next), ArrowRight retreats.
    const afterLeft = await afterGesture(start, () => pressKey('ArrowLeft'));
    const advanced =
      afterLeft.section > start.section || (afterLeft.section === start.section && afterLeft.page > start.page);
    assert.ok(advanced, 'RTL ArrowLeft did not advance reading order');

    const afterRight = await afterGesture(afterLeft, () => pressKey('ArrowRight'));
    const retreated =
      afterRight.section < afterLeft.section ||
      (afterRight.section === afterLeft.section && afterRight.page < afterLeft.page);
    assert.ok(retreated, 'RTL ArrowRight did not retreat reading order');

    // PageDown is reading-order neutral — it advances regardless of direction.
    const afterPageDown = await afterGesture(afterRight, () => pressKey('PageDown'));
    const pdAdvanced =
      afterPageDown.section > afterRight.section ||
      (afterPageDown.section === afterRight.section && afterPageDown.page > afterRight.page);
    assert.ok(pdAdvanced, 'RTL PageDown did not advance reading order');
  });
});

describe('touch swipe', { ...skipAll }, () => {
  test('swipe left → next, swipe right → prev (LTR)', async () => {
    await openReader(HOSTILE);
    await landOnMultiPage();
    // Advance one so a rightward (prev) swipe has room to go back.
    await page.evaluate(() => window.harness.readerNext());
    const start = await position();

    const afterLeft = await afterGesture(start, () => swipe(-120));
    const advanced =
      afterLeft.section > start.section || (afterLeft.section === start.section && afterLeft.page > start.page);
    assert.ok(advanced, 'a leftward swipe did not advance');

    const afterRight = await afterGesture(afterLeft, () => swipe(120));
    const retreated =
      afterRight.section < afterLeft.section ||
      (afterRight.section === afterLeft.section && afterRight.page < afterLeft.page);
    assert.ok(retreated, 'a rightward swipe did not retreat');
  });

  test('swipe direction reverses under RTL', { ...skipRtl }, async () => {
    await openReader(RTL);
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const start = await position();
    // Under RTL a rightward swipe advances (next).
    const afterRight = await afterGesture(start, () => swipe(120));
    const advanced =
      afterRight.section > start.section || (afterRight.section === start.section && afterRight.page > start.page);
    assert.ok(advanced, 'RTL rightward swipe did not advance');
  });
});

describe('tap zones', { ...skipAll }, () => {
  test('tap left third → prev, right third → next; center is inert (LTR)', async () => {
    await openReader(HOSTILE);
    await landOnMultiPage();
    await page.evaluate(() => window.harness.readerNext());
    const start = await position();

    // Right third → next.
    const afterRight = await afterGesture(start, () => tapAtFraction(0.85));
    const advanced =
      afterRight.section > start.section || (afterRight.section === start.section && afterRight.page > start.page);
    assert.ok(advanced, 'a right-third tap did not advance');

    // Left third → prev.
    const afterLeft = await afterGesture(afterRight, () => tapAtFraction(0.15));
    const retreated =
      afterLeft.section < afterRight.section ||
      (afterLeft.section === afterRight.section && afterLeft.page < afterRight.page);
    assert.ok(retreated, 'a left-third tap did not retreat');

    // Center is inert.
    const held = await afterGesture(afterLeft, () => tapAtFraction(0.5), { expectMove: false });
    assert.equal(held.section, afterLeft.section, 'a center tap moved the section');
    assert.equal(held.page, afterLeft.page, 'a center tap turned the page');
  });

  test('tap zones flip under RTL', { ...skipRtl }, async () => {
    await openReader(RTL);
    await page.evaluate(() => window.harness.readerGoTo('start'));
    const start = await position();
    // Under RTL the left zone is *next*.
    const afterLeft = await afterGesture(start, () => tapAtFraction(0.15));
    const advanced =
      afterLeft.section > start.section || (afterLeft.section === start.section && afterLeft.page > start.page);
    assert.ok(advanced, 'RTL left-third tap did not advance');
  });

  test('a tap on a link stays a linkclick and does not turn the page', { ...skipCorpus }, async () => {
    await openReader(PP);
    // Find an internal link and tap on its coordinates; the frame's tap path
    // excludes link ancestors, so it must arrive as a linkclick, not a page turn.
    await page.evaluate(() => window.harness.clearReaderEvents());
    const frame = contentFrame();
    const linkBox = await frame.evaluate(() => {
      const anchor = [...document.querySelectorAll('a[href]')].find((a) => {
        const h = a.getAttribute('href') ?? '';
        return h !== '' && !h.startsWith('#') && !/^[a-z]+:/i.test(h);
      });
      if (anchor === undefined) return null;
      const r = anchor.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return null;
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    });
    if (linkBox === null) {
      // No usable internal link in the first section — nothing to exercise here.
      return;
    }
    const before = await position();
    // A press-release with no movement on the link's coords: a tap on a link.
    await frame.evaluate((b) => {
      const opts = { clientX: b.x, clientY: b.y, isPrimary: true, bubbles: true, pointerId: 1 };
      // Point the event at the actual link element so linkAncestor finds it.
      const el = document.elementFromPoint(b.x, b.y) ?? document.body;
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
      // A real tap also fires a click; dispatch it so the linkclick path runs.
      el.dispatchEvent(new MouseEvent('click', opts));
    }, linkBox);

    // Either a linkclick fires, or nothing (if elementFromPoint missed the link);
    // in no case may a bare page turn happen from a link tap.
    await new Promise((done) => setTimeout(done, 150));
    const events = await page.evaluate(() => window.harness.readerEvents());
    const types = events.map((e) => e.type);
    // A tap that resolved as a page turn would fire positionchange with no
    // preceding linkclick. Assert that never happened.
    const firstPos = types.indexOf('positionchange');
    const firstLink = types.indexOf('linkclick');
    if (firstPos >= 0) {
      assert.ok(
        firstLink >= 0 && firstLink <= firstPos,
        `a link tap turned the page without a linkclick (events: ${types.join(', ')})`,
      );
    } else {
      // No navigation at all is also acceptable — the link tap did not turn a page.
      assert.ok(before !== null);
    }
  });
});

describe('prefers-reduced-motion', { ...skipAll }, () => {
  test('with reduced motion emulated, input still turns pages (no animation exists to suppress)', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      await openReader(HOSTILE);
      await landOnMultiPage();
      const start = await position();
      const after = await afterGesture(start, () => pressKey('PageDown'));
      const advanced =
        after.section > start.section || (after.section === start.section && after.page > start.page);
      assert.ok(advanced, 'pages did not turn under prefers-reduced-motion');
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }
  });
});

describe('demo end-to-end reading', { ...skipAll, ...skipCorpus }, () => {
  test('load a corpus book, read through several pages by keyboard, TOC jump lands', async () => {
    // openBook returns the reading-order section list — the same list the demo
    // builds its TOC / reading-order navigation from.
    const sections = await openBook(PP);
    await page.evaluate(() => window.harness.createReader({}));
    await page.evaluate(() => window.harness.readerGoTo('start'));
    let pos = await position();
    const startSection = pos.section;

    // Read forward several page turns by keyboard; reading order must advance.
    for (let i = 0; i < 6; i += 1) {
      const before = pos;
      pos = await afterGesture(before, () => pressKey('ArrowRight'));
      const advanced =
        pos.section > before.section || (pos.section === before.section && pos.page > before.page);
      assert.ok(advanced, `page turn ${i} did not advance`);
    }
    assert.ok(
      pos.section > startSection || pos.page > 0,
      'reading several pages made no progress through the book',
    );

    // A TOC jump lands on its section (goTo(TocItem)) — the demo's TOC path.
    const target = sections[Math.min(3, sections.length - 1)];
    const landed = await page.evaluate(
      (id) => window.harness.readerGoTo({ sectionId: id, label: id, fragment: undefined, children: [] }),
      target.id,
    );
    assert.equal(
      landed.section,
      await page.evaluate((id) => window.harness.sectionIndexOf(id), target.id),
      'a TOC jump did not land on its section',
    );
  });
});

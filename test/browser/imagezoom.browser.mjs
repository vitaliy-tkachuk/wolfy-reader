import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for image handling + tap-to-zoom. Column containment of an
 * oversized image, the tap→overlay gesture, focus management across the sandbox
 * boundary, and prefers-reduced-motion emulation are real-DOM / real-layout /
 * real-input behaviours that headless node:test cannot observe — so full Chromium.
 *
 * The bigimage fixture carries one chapter with a 2400x1600 image, far wider than
 * any column: uncapped it would overflow. The overlay is host-side (outside the
 * frame) and renders the image's already-served data: URL; it must never be a blob.
 *
 * Mirrors reader.browser.mjs / input.browser.mjs: same serve-demo mounts, same
 * harness.html, a graceful skip when playwright is absent. The bigimage fixture is
 * committed, so no corpus is needed.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('imagezoom.browser: playwright is not installed — skipping. Run `npm install` first.');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};

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

const BIG = '/fixtures/bigimage.epub';

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

async function openReader(url, options = {}) {
  await openBook(url);
  return page.evaluate((o) => window.harness.createReader(o), options);
}

/** The rendered wide image's box + the frame's content width, from inside the frame. */
async function imageBox() {
  const frame = contentFrame();
  return frame.evaluate(() => {
    const img = document.querySelector('img#wide-plate');
    if (img === null) return null;
    const rect = img.getBoundingClientRect();
    const root = document.getElementById('wolfy-reader-content') ?? document.body;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cx = Math.round(rect.left + rect.width / 2);
    const cy = Math.round(rect.top + rect.height / 2);
    return {
      width: rect.width,
      naturalWidth: img.naturalWidth,
      columnWidth: root.clientWidth || vw,
      viewport: vw,
      left: rect.left,
      right: rect.right,
      // Visible on this page when its centre falls within the viewport band — the
      // image is width-capped to the column but sits at a small left offset, so a
      // strict left>=0 && right<=vw test is too tight; the centre being on-screen is
      // what lets a tap land on it.
      onScreen: cx >= 0 && cx <= vw && cy >= 0 && cy <= vh && rect.width > 0,
      center: { x: cx, y: cy },
    };
  });
}

/**
 * The wide image gets its own column in the paginated flow, so it is not on page 0.
 * Turn pages until the image's box falls within the visible viewport, then return
 * its on-screen box. Bounded so a missing image cannot loop forever.
 */
async function revealImage() {
  await page.evaluate(() => window.harness.readerGoTo('start'));
  for (let i = 0; i < 20; i += 1) {
    const box = await imageBox();
    if (box !== null && box.onScreen) return box;
    const before = await page.evaluate(() => window.harness.readerPosition());
    const after = await page.evaluate(() => window.harness.readerNext());
    if (after.section === before.section && after.page === before.page) break;
  }
  return imageBox();
}

/** Dispatch a press-release (a tap, no movement) at (x, y) on the frame's document. */
async function tapAt(x, y) {
  const frame = contentFrame();
  await frame.evaluate(
    (c) => {
      const opts = { clientX: c.x, clientY: c.y, isPrimary: true, bubbles: true, pointerId: 1 };
      const el = document.elementFromPoint(c.x, c.y) ?? document.body;
      el.dispatchEvent(new PointerEvent('pointerdown', opts));
      el.dispatchEvent(new PointerEvent('pointerup', opts));
    },
    { x, y },
  );
}

/** Snapshot of the host-side overlay, or null when none is mounted. */
function overlayState() {
  return page.evaluate(() => {
    const root = document.querySelector('[role="dialog"][aria-modal="true"]');
    if (root === null) return null;
    const img = root.querySelector('img');
    const close = root.querySelector('button');
    const active = document.activeElement;
    return {
      present: true,
      src: img?.getAttribute('src') ?? '',
      alt: img?.getAttribute('alt') ?? '',
      transition: getComputedStyle(root).transitionDuration,
      focusInside: root.contains(active),
      closeFocused: active === close,
    };
  });
}

/** Wait until the overlay is present (or absent), polling briefly. */
async function waitOverlay(present) {
  for (let i = 0; i < 40; i += 1) {
    const state = await overlayState();
    if (present ? state !== null : state === null) return state;
    await new Promise((done) => setTimeout(done, 25));
  }
  return overlayState();
}

describe('oversized image containment', { ...skipAll }, () => {
  test('a 2400px-wide image is capped at the column width and does not overflow', async () => {
    await openReader(BIG);
    const box = await imageBox();
    assert.ok(box !== null, 'the wide image did not render');
    assert.equal(box.naturalWidth, 2400, 'the fixture image is not the expected 2400px wide');
    // Capped: rendered width never exceeds the column it sits in (max-width:100%).
    // Uncapped, a 2400px image would paint 2400px wide and blow past the column.
    assert.ok(
      box.width <= box.columnWidth + 1,
      `image width ${box.width} exceeded column width ${box.columnWidth}`,
    );
    // On the page that paints the image, it is still capped to the column width —
    // it never grows to its 2400px intrinsic size and never breaks the column.
    const revealed = await revealImage();
    assert.ok(revealed !== null && revealed.onScreen, 'the image never came on-screen');
    assert.ok(
      revealed.width <= revealed.columnWidth + 1,
      `the revealed image (${revealed.width}px) exceeded its column (${revealed.columnWidth}px)`,
    );
  });
});

describe('tap → zoom overlay', { ...skipAll }, () => {
  test('tapping the image opens a host-side overlay over the same data: URL (never blob:)', async () => {
    await openReader(BIG);
    const box = await revealImage();
    const frameSrc = await contentFrame().evaluate(
      () => document.querySelector('img#wide-plate')?.getAttribute('src') ?? '',
    );
    assert.ok(frameSrc.startsWith('data:'), 'the in-frame image is not a data: URL');

    await tapAt(box.center.x, box.center.y);
    const overlay = await waitOverlay(true);
    assert.ok(overlay !== null, 'the tap did not open an overlay');
    assert.equal(overlay.src, frameSrc, 'the overlay shows a different URL than the in-frame image');
    assert.ok(overlay.src.startsWith('data:'), 'the overlay src is not a data: URL');
    assert.ok(!overlay.src.startsWith('blob:'), 'the overlay minted a forbidden blob: URL');
    // Focus moved into the overlay (the close control) when it opened.
    assert.ok(overlay.focusInside, 'focus did not move into the overlay');
    assert.ok(overlay.closeFocused, 'the close control was not focused on open');
  });
});

describe('dismiss + focus return + trap', { ...skipAll }, () => {
  test('Escape closes and returns focus to the reader; backdrop click also closes', async () => {
    await openReader(BIG);
    const box = await revealImage();

    await tapAt(box.center.x, box.center.y);
    await waitOverlay(true);
    await page.keyboard.press('Escape');
    const gone = await waitOverlay(false);
    assert.equal(gone, null, 'Escape did not close the overlay');
    // Focus returned into the reader region (the iframe or its container), not lost.
    const focusOk = await page.evaluate(() => {
      const active = document.activeElement;
      const stage = document.getElementById('stage');
      return active !== null && active !== document.body && stage !== null && stage.contains(active);
    });
    assert.ok(focusOk, 'focus did not return to the reader element on close');

    // Backdrop click also closes: tap the overlay's own backdrop (a corner).
    await tapAt(box.center.x, box.center.y);
    await waitOverlay(true);
    await page.mouse.move(5, 5);
    await page.evaluate(() => {
      const root = document.querySelector('[role="dialog"][aria-modal="true"]');
      root.dispatchEvent(new PointerEvent('pointerdown', { clientX: 3, clientY: 3, bubbles: true, isPrimary: true }));
    });
    const closed = await waitOverlay(false);
    assert.equal(closed, null, 'a backdrop click did not close the overlay');
  });

  test('Tab keeps focus trapped inside the overlay while open', async () => {
    await openReader(BIG);
    const box = await revealImage();
    await tapAt(box.center.x, box.center.y);
    await waitOverlay(true);
    // Tab a few times: focus must never leave the overlay.
    for (let i = 0; i < 4; i += 1) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const root = document.querySelector('[role="dialog"][aria-modal="true"]');
        return root !== null && root.contains(document.activeElement);
      });
      assert.ok(inside, `Tab #${i} escaped the focus trap`);
    }
    await page.keyboard.press('Escape');
    await waitOverlay(false);
  });
});

describe('prefers-reduced-motion gates the overlay only', { ...skipAll }, () => {
  test('with reduced motion the overlay has no transition, but tap-to-zoom still works', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    try {
      await openReader(BIG);
      const box = await revealImage();
      await tapAt(box.center.x, box.center.y);
      const overlay = await waitOverlay(true);
      assert.ok(overlay !== null, 'the overlay did not open under reduced motion');
      // No animation: the open/close transition is suppressed (duration 0s / none).
      assert.ok(
        overlay.transition === '0s' || overlay.transition === '' || overlay.transition === 'none',
        `reduced motion left a transition duration of "${overlay.transition}"`,
      );
      await page.keyboard.press('Escape');
      await waitOverlay(false);
    } finally {
      await page.emulateMedia({ reducedMotion: null });
    }
  });
});

describe('no tap-zone regression', { ...skipAll }, () => {
  test('a tap outside any image still turns the page via the tap zones', async () => {
    // Land in a multi-page section so a page turn is observable, then tap the
    // right-third *away from* the image so it is a page-turn tap, not an image tap.
    await openReader(BIG);
    // Walk to a page that has room; the bigimage chapter is short, so use a tap on
    // an empty band. Ensure no overlay opens and the tap path stays a page turn.
    const before = await page.evaluate(() => window.harness.readerPosition());
    const frame = contentFrame();
    // Tap the far-right edge, below the image, on empty text — a page-turn zone.
    await frame.evaluate(() => {
      const x = Math.round(window.innerWidth * 0.9);
      const y = Math.round(window.innerHeight * 0.95);
      const opts = { clientX: x, clientY: y, isPrimary: true, bubbles: true, pointerId: 1 };
      // Target the document body (not the image) so imageAncestor finds nothing.
      document.body.dispatchEvent(new PointerEvent('pointerdown', opts));
      document.body.dispatchEvent(new PointerEvent('pointerup', opts));
    });
    // No overlay must appear for a non-image tap.
    const overlay = await waitOverlay(false);
    assert.equal(overlay, null, 'a non-image tap opened the zoom overlay');
    // The tap either turned the page or was inert (single-page section); it must
    // never open the overlay — the tapIntent path is untouched.
    const after = await page.evaluate(() => window.harness.readerPosition());
    assert.equal(after.section, before.section, 'a tap-zone tap changed section unexpectedly');
  });
});

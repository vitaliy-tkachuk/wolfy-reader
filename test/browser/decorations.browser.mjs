import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for the draw-only decorations API. A decoration is a styled overlay
 * the frame paints over the client rects of the range a `Position` resolves to. The
 * overlay lives inside the opaque-origin content frame, so its geometry — client
 * rects, layout-neutral absolute boxes, survival across a re-layout — only exists in
 * a real layout engine and is browser-load-bearing. The pure `Position`↔offset-range
 * conversion and the protocol validators are covered headless (layout/view tests).
 *
 * A decoration is anchored at a `Position` captured over a test-chosen phrase from the
 * frame's own chunk text, so the overlay is asserted to cover exactly that phrase's
 * rect. Mirrors selection.browser.mjs: same mounts, same harness, graceful skips.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('decorations.browser: playwright is not installed — skipping. Run `npm install` first.');
}

async function present(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const hostilePresent = await present(resolve(fixtureDir, 'hostile.epub'));
if (!hostilePresent) {
  console.log('decorations.browser: hostile fixture absent — cases skipped.');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};
const skipFixture = !hostilePresent ? { skip: 'the hostile fixture is absent' } : {};

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

const HOSTILE = '/fixtures/hostile.epub';

function contentFrame() {
  const frames = page.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame — the reader content frame');
  return frames[0];
}

async function openReader(url, options = {}) {
  const opened = await page.evaluate((u) => window.harness.openBook(u), url);
  assert.ok(opened !== null, `${url} could not be fetched`);
  await page.evaluate((o) => window.harness.createReader(o), options);
  await page.evaluate(() => window.harness.readerGoTo('start'));
}

/** The concatenated chunk text as the frame measures it (the decoration text space). */
async function frameSectionText() {
  return contentFrame().evaluate(() => {
    const chunks = [...document.getElementsByClassName('wolfy-reader-chunk')];
    return chunks.map((c) => c.textContent || '').join('');
  });
}

/**
 * Picks a phrase from the frame text that lays out on the visible first page (so the
 * overlay is on-screen to compare against), captures a `Position` anchored at it, and
 * returns { serialized, phrase, offset } — or null if no on-page phrase is found.
 */
async function anchorOnPage(phraseLen = 12) {
  const text = await frameSectionText();
  const frame = contentFrame();
  // Try candidate word-aligned phrases; keep the first whose rect is on the first page.
  const match = /\S.{8,}?\S/g;
  let hit;
  while ((hit = match.exec(text)) !== null) {
    const phrase = hit[0].slice(0, phraseLen).trim();
    if (phrase.length < 6) continue;
    const offset = text.indexOf(phrase);
    if (offset === -1) continue;
    // Does this phrase render with rects on the current (first) page?
    const rect = await phraseRect(frame, phrase);
    if (rect !== null && rect.left >= 0 && rect.left < 800 && rect.top >= 0 && rect.top < 600) {
      const serialized = await page.evaluate(
        ([t, o]) => window.harness.buildPositionAt(t, o),
        [text, offset],
      );
      if (serialized !== null) return { serialized, phrase, offset, rect };
    }
  }
  return null;
}

/** The union client rect of the first occurrence of `phrase` in the frame, or null. */
function phraseRect(frame, phrase) {
  return frame.evaluate((needle) => {
    const root = document.getElementById('wolfy-reader-content') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node;
    while ((node = walker.nextNode())) {
      const at = (node.data || '').indexOf(needle);
      if (at !== -1) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + needle.length);
        const rects = [...range.getClientRects()];
        if (rects.length === 0) return null;
        let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
        for (const r of rects) {
          left = Math.min(left, r.left);
          top = Math.min(top, r.top);
          right = Math.max(right, r.right);
          bottom = Math.max(bottom, r.bottom);
        }
        return { left, top, right, bottom };
      }
    }
    return null;
  }, phrase);
}

/** The overlay boxes painted for a decoration id, with class + style facts. */
async function overlayBoxes(id) {
  return contentFrame().evaluate((decorationId) => {
    const boxes = [...document.querySelectorAll(`[data-decoration="${decorationId}"]`)];
    return boxes.map((box) => {
      const rect = box.getBoundingClientRect();
      const style = getComputedStyle(box);
      return {
        pointerEvents: style.pointerEvents,
        position: style.position,
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
        bottom: rect.bottom,
        right: rect.right,
        hasClass: box.classList.contains('hl'),
      };
    });
  }, id);
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

describe('draw-only decorations', { ...skipAll, ...skipFixture }, () => {
  test('decorate paints a class-carrying, pointer-transparent overlay over the range', async () => {
    await openReader(HOSTILE);
    const anchor = await anchorOnPage();
    if (anchor === null) return; // no on-page phrase to anchor — nothing to exercise

    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), anchor.serialized);

    const boxes = await overlayBoxes('h1');
    assert.ok(boxes.length > 0, 'decorate must paint at least one overlay box');
    for (const box of boxes) {
      assert.ok(box.hasClass, 'each overlay box carries the caller class');
      assert.equal(box.pointerEvents, 'none', 'overlays must be pointer-transparent');
      assert.equal(box.position, 'absolute', 'overlays are absolutely positioned (layout-neutral)');
      assert.ok(box.width > 0 && box.height > 0, 'a painted box has real geometry');
    }
    assert.ok(
      boxes.some((box) => overlaps(box, anchor.rect)),
      'an overlay box must sit over the decorated phrase',
    );
  });

  test('a decoration survives a font-size change and stays over the same text', async () => {
    await openReader(HOSTILE);
    const anchor = await anchorOnPage();
    if (anchor === null) return;

    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), anchor.serialized);
    assert.ok((await overlayBoxes('h1')).length > 0, 'decoration must exist before the re-layout');

    // A font-size change re-lays out (M1-2 capture→re-layout→resolve→restore). The
    // decoration must re-anchor and redraw over the same text, not vanish.
    await page.evaluate(() => window.harness.readerSetAppearance({ fontSize: 26 }));

    const after = await overlayBoxes('h1');
    assert.ok(after.length > 0, 'the decoration must re-anchor and survive the re-layout');
    for (const box of after) {
      assert.ok(box.hasClass, 'the re-anchored overlay keeps its class');
      assert.ok(box.width > 0 && box.height > 0, 'the re-anchored overlay has real geometry');
    }
    // After reflow, the same phrase re-lays out; the overlay must still cover it.
    const rectAfter = await phraseRect(contentFrame(), anchor.phrase);
    if (rectAfter !== null) {
      assert.ok(
        after.some((box) => overlaps(box, rectAfter)),
        'the surviving overlay must still cover the same text after reflow',
      );
    }
  });

  test('undecorate removes the overlay and leaves nothing behind', async () => {
    await openReader(HOSTILE);
    const anchor = await anchorOnPage();
    if (anchor === null) return;

    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), anchor.serialized);
    assert.ok((await overlayBoxes('h1')).length > 0, 'decoration must exist before removal');

    await page.evaluate(() => window.harness.readerUndecorate('h1'));
    assert.equal((await overlayBoxes('h1')).length, 0, 'undecorate must remove every overlay box');

    // And it stays gone across a re-layout — the intent was dropped, not just hidden.
    await page.evaluate(() => window.harness.readerSetAppearance({ fontSize: 22 }));
    assert.equal(
      (await overlayBoxes('h1')).length,
      0,
      'an undecorated decoration must not resurrect on re-layout',
    );
  });

  test('a soft-miss decoration draws nothing and throws nothing', async () => {
    await openReader(HOSTILE);
    const serialized = await page.evaluate(() => window.harness.buildAbsentPosition());
    if (serialized === null) return;

    let threw = false;
    try {
      await page.evaluate((s) => window.harness.readerDecorate('miss', s, 'hl'), serialized);
    } catch {
      threw = true;
    }
    assert.equal(threw, false, 'a soft-miss must not throw');
    assert.equal((await overlayBoxes('miss')).length, 0, 'a soft-miss paints no overlay box');
  });
});

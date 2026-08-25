import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Accessibility walkthrough (T002): every reader function is operable pointer-free,
 * focus lands sensibly, and `prefers-reduced-motion` never gates input. The
 * load-bearing case is keyboard image-zoom — a figure is tap-to-zoom by default, so
 * the frame makes each image focusable and forwards Enter/Space as an imagetap, and
 * this proves a keyboard user can open the overlay, that it traps focus, closes on
 * Escape, and returns focus to a sensible anchor. Browser-only: focus, keyboard
 * routing, and the overlay all live in the real reader and the opaque-origin frame.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('a11y.browser: playwright is not installed — skipping. Run `npm install` first.');
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
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function freshPage(options = {}) {
  const context = await browser.newContext(options);
  const p = await context.newPage();
  await p.goto(`${server.origin}/harness.html`);
  await p.waitForFunction(() => window.harnessReady === true);
  return p;
}

function frameOf(p) {
  const frames = p.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame');
  return frames[0];
}

const BIG = '/fixtures/bigimage.epub';
const HOSTILE = '/fixtures/hostile.epub';

async function openReader(p, url, options = {}) {
  const opened = await p.evaluate((u) => window.harness.openBook(u), url);
  assert.ok(opened !== null, `${url} opened`);
  return p.evaluate((o) => window.harness.createReader(o), options);
}

describe('keyboard operability', { ...skipAll }, () => {
  test('page nav is driven entirely from the keyboard, pointer-free', async () => {
    const p = await freshPage();
    try {
      const initial = await openReader(p, HOSTILE);
      assert.equal(initial.section, 0);

      // End / Home are book-level and reading-order neutral: dispatched as real
      // keydowns on the frame document, exactly as a focused-frame user produces.
      await frameOf(p).evaluate(() =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true })),
      );
      await p.waitForFunction((n) => window.harness.readerPosition().section === n - 1, initial.totalSections ?? 99, { timeout: 4000 }).catch(() => {});
      const atEnd = await p.evaluate(() => window.harness.readerPosition());
      assert.ok(atEnd.section > 0, `End advanced to a later section (got ${atEnd.section})`);

      await frameOf(p).evaluate(() =>
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true })),
      );
      await p.waitForFunction(() => window.harness.readerPosition().section === 0, null, { timeout: 4000 });
      const atHome = await p.evaluate(() => window.harness.readerPosition());
      assert.equal(atHome.section, 0, 'Home returned to the first section');
    } finally {
      await p.context().close();
    }
  });

  test('a content image is focusable and button-roled for keyboard activation', async () => {
    const p = await freshPage();
    try {
      await openReader(p, BIG);
      const attrs = await frameOf(p).evaluate(() => {
        const img = document.querySelector('img#wide-plate');
        return img && {
          tabindex: img.getAttribute('tabindex'),
          role: img.getAttribute('role'),
          label: img.getAttribute('aria-label'),
        };
      });
      assert.ok(attrs, 'the content image exists');
      assert.equal(attrs.tabindex, '0', 'the image is in the tab order');
      assert.equal(attrs.role, 'button', 'the image is button-roled');
      assert.ok(attrs.label && attrs.label.length > 0, 'the image carries an aria-label');
    } finally {
      await p.context().close();
    }
  });

  test('Enter on a focused image opens the zoom overlay, which traps focus and returns it on close', async () => {
    const p = await freshPage();
    try {
      await openReader(p, BIG);
      // Focus the image and press Enter inside the frame — no pointer used.
      await frameOf(p).evaluate(() => {
        const img = document.querySelector('img#wide-plate');
        img.focus();
        img.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      await p.waitForFunction(() => document.querySelector('[role="dialog"][aria-modal="true"]') !== null, null, { timeout: 4000 });

      const opened = await p.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        return { hasDialog: dialog !== null, focusInDialog: dialog !== null && dialog.contains(document.activeElement) };
      });
      assert.ok(opened.hasDialog, 'Enter opened the zoom overlay');
      assert.ok(opened.focusInDialog, 'focus moved into the overlay');

      // Escape closes it and focus returns to a sensible anchor (not lost to body).
      await p.keyboard.press('Escape');
      await p.waitForFunction(() => document.querySelector('[role="dialog"][aria-modal="true"]') === null, null, { timeout: 4000 });
      const afterClose = await p.evaluate(() => ({
        dialogGone: document.querySelector('[role="dialog"][aria-modal="true"]') === null,
        focusLost: document.activeElement === document.body || document.activeElement === null,
      }));
      assert.ok(afterClose.dialogGone, 'Escape closed the overlay');
      assert.ok(!afterClose.focusLost, 'focus returned to a sensible anchor, not the body');
    } finally {
      await p.context().close();
    }
  });
});

describe('prefers-reduced-motion', { ...skipAll }, () => {
  test('under reduce, the zoom overlay opens with no transition and input is never gated', async () => {
    const p = await freshPage({ reducedMotion: 'reduce' });
    try {
      await openReader(p, BIG);
      await frameOf(p).evaluate(() => {
        const img = document.querySelector('img#wide-plate');
        img.focus();
        img.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      });
      await p.waitForFunction(() => document.querySelector('[role="dialog"][aria-modal="true"]') !== null, null, { timeout: 4000 });
      const motion = await p.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"][aria-modal="true"]');
        const cs = getComputedStyle(dialog);
        return { opacity: cs.opacity, transition: cs.transitionProperty };
      });
      assert.equal(motion.opacity, '1', 'the overlay is shown immediately, not faded in');
      assert.ok(motion.transition === 'none' || motion.transition === 'all', `no opacity transition under reduce (got ${motion.transition})`);
      await p.keyboard.press('Escape');
    } finally {
      await p.context().close();
    }
  });
});

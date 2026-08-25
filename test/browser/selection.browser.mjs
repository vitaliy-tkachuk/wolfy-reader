import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for selection events (T002). A text selection lives *inside* the
 * opaque-origin content frame's document — the host cannot read the frame's
 * `Selection` — so the coordination script observes it, computes the selection's
 * UTF-16 offset range over the tiled section text, and forwards a semantic
 * `{ start, end, text }` payload (protocol v6). The facade turns that range into a
 * `Position` and emits `selection`. Real selection only exists over a live
 * document across the sandbox boundary, so this is browser-only.
 *
 * We create the selection by driving `window.getSelection()` inside the frame and
 * firing the pointer/mouse release the coordination script forwards on — exactly
 * the events a real drag would produce, without OS pointer plumbing.
 *
 * Mirrors input.browser.mjs / reader.browser.mjs: same serve-demo mounts, same
 * harness.html, a graceful skip when playwright is absent.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('selection.browser: playwright is not installed — skipping. Run `npm install` first.');
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
  console.log('selection.browser: hostile fixture absent — cases skipped.');
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

/** The reader's single content frame; asserts nothing else is mounted. */
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

/**
 * Selects `count` characters of text starting at the first text node in the frame
 * whose content is long enough, then fires the release the coordination script
 * forwards on. Returns the exact selected string (as the frame sees it) or null if
 * no suitable text node exists.
 */
async function selectRange(count) {
  const frame = contentFrame();
  const text = await frame.evaluate((n) => {
    const root = document.getElementById('wolfyreader-content') || document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let node = null;
    while ((node = walker.nextNode())) {
      if ((node.data || '').trim().length >= n) break;
    }
    if (node === null) return null;
    const start = node.data.search(/\S/);
    const range = document.createRange();
    range.setStart(node, start);
    range.setEnd(node, Math.min(start + n, node.data.length));
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    return selection.toString();
  }, count);
  if (text === null) return null;
  // Fire the release the coordination script forwards on in a later task, so the
  // `selectionchange` addRange queued has already settled (it fires async).
  await frame.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(() => {
          document.dispatchEvent(
            new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }),
          );
          done();
        }, 20);
      }),
  );
  return text;
}

async function events() {
  return page.evaluate(() => window.harness.readerEvents());
}

/** Waits until a `selection` event has been recorded, or a bounded number of polls. */
async function waitForSelection() {
  for (let i = 0; i < 40; i += 1) {
    const log = await events();
    const found = log.find((e) => e.type === 'selection');
    if (found !== undefined) return found;
    await new Promise((done) => setTimeout(done, 25));
  }
  return undefined;
}

describe('selection events', { ...skipAll, ...skipFixture }, () => {
  test('a real selection emits `selection` with the text and a resolvable Position', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.clearReaderEvents());

    const selected = await selectRange(12);
    if (selected === null) {
      // No text node long enough in the first section — nothing to exercise.
      return;
    }
    const event = await waitForSelection();
    assert.ok(event !== undefined, 'no selection event fired for a real selection');
    assert.equal(event.payload.text, selected, 'the emitted text must equal the selected string');
    assert.ok(
      typeof event.payload.position?.serialized === 'string',
      'the selection payload must carry a Position',
    );

    // The Position resolves back against the section: navigating to it lands on the
    // section the selection was made in, without a throw (soft-miss philosophy).
    const before = await page.evaluate(() => window.harness.readerPosition());
    const landed = await page.evaluate(
      (s) => window.harness.readerGoToSerialized(s),
      event.payload.position.serialized,
    );
    assert.equal(landed.section, before.section, 'the selection Position resolved to a different section');
  });

  test('a collapsed selection (a bare click) fires no `selection` event', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.clearReaderEvents());

    const frame = contentFrame();
    await frame.evaluate(() => {
      const selection = window.getSelection();
      selection.removeAllRanges();
      // A bare click collapses the selection at a point.
      const root = document.getElementById('wolfyreader-content') || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      const node = walker.nextNode();
      if (node !== null) selection.collapse(node, 0);
      return new Promise((done) => {
        setTimeout(() => {
          document.dispatchEvent(
            new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }),
          );
          done();
        }, 20);
      });
    });

    await new Promise((done) => setTimeout(done, 150));
    const log = await events();
    assert.ok(
      log.every((e) => e.type !== 'selection'),
      'a collapsed selection must not emit a selection event',
    );
  });

  test('a selection whose rects are empty forwards no payload', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.clearReaderEvents());

    const frame = contentFrame();
    // Inject a zero-width empty-inline span (the getClientRects() gotcha) and select
    // it exactly. Its empty rect list must trip the frame's guard: no payload.
    const injected = await frame.evaluate(() => {
      const root = document.getElementById('wolfyreader-content') || document.body;
      const chunk = root.querySelector('.wolfyreader-chunk') || root;
      const anchor = document.createElement('span');
      anchor.id = 'empty-anchor-probe';
      chunk.appendChild(anchor);
      const range = document.createRange();
      range.selectNodeContents(anchor);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const rects = range.getClientRects().length;
      const collapsed = selection.isCollapsed;
      return new Promise((done) => {
        setTimeout(() => {
          document.dispatchEvent(
            new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }),
          );
          done({ rects, collapsed });
        }, 20);
      });
    });
    // The empty span selection is either collapsed or has no rects — both guarded.
    assert.ok(injected.rects === 0 || injected.collapsed, 'the probe must have empty rects or be collapsed');

    await new Promise((done) => setTimeout(done, 150));
    const log = await events();
    assert.ok(
      log.every((e) => e.type !== 'selection'),
      'an empty-rect selection must not emit a selection event',
    );
  });
});

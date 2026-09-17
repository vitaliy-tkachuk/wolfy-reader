import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for selection events. A text selection lives *inside* the
 * opaque-origin content frame's document — the host cannot read the frame's
 * `Selection` — so the coordination script observes it, computes the selection's
 * UTF-16 offset range over the tiled section text, and forwards a semantic
 * `{ start, end, text }` payload (protocol v6). The facade turns that range into a
 * `Position` and emits `selection`. Real selection only exists over a live
 * document across the sandbox boundary, so this is browser-only.
 *
 * The geometry cases (protocol v11) prove the coordinate space a host anchors a
 * popover in: `rect`/`rects` are frame-viewport px, which equal the container's
 * padding-box px because the frame fills it with no border — asserted, not
 * assumed — and are clipped to the visible page. `Range.getClientRects`, the
 * sandbox mapping and scroll offsets do not exist headlessly.
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
const corpusDir = resolve(repoRoot, 'test', 'corpus');
const corpusPresent = await present(resolve(corpusDir, 'gutenberg-alice-in-wonderland.epub'));
if (!corpusPresent) {
  console.log('selection.browser: corpus book absent — geometry cases skipped (run `npm run fetch-corpus`).');
}

const skipAll = playwright === null ? { skip: 'playwright is not installed' } : {};
const skipFixture = !hostilePresent ? { skip: 'the hostile fixture is absent' } : {};
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

const HOSTILE = '/fixtures/hostile.epub';
const ALICE = '/corpus/gutenberg-alice-in-wonderland.epub';

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
    const root = document.getElementById('wolfy-reader-content') || document.body;
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

  test('the selection Position anchors over the whole selection, not a fixed prefix', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.clearReaderEvents());

    // A selection longer than the old default quote (32 graphemes). The emitted
    // Position must quote the whole span so a host highlighting it via decorate
    // paints the entire selection, not only its first few words.
    const selected = await selectRange(60);
    if (selected === null || selected.length < 40) {
      // No text node long enough in the first section — nothing to exercise.
      return;
    }
    const event = await waitForSelection();
    assert.ok(event !== undefined, 'no selection event fired for a real selection');

    const exact = event.payload.position?.anchor?.exact ?? '';
    const graphemes = (s) =>
      [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s)].length;
    // The quote spans the whole selection (its length, in graphemes), not the old
    // fixed 32-grapheme default. The window may word-snap at the front, so assert on
    // length rather than an exact-string match.
    assert.ok(
      exact.length > 32,
      `the anchored quote (${exact.length}) must span past the old 32-grapheme cap`,
    );
    assert.ok(
      Math.abs(graphemes(exact) - graphemes(selected)) <= 2,
      `the quote (${graphemes(exact)}g) must span the whole selection (${graphemes(selected)}g)`,
    );
  });

  test('a collapsed selection (a bare click) fires no `selection` event', async () => {
    await openReader(HOSTILE);
    await page.evaluate(() => window.harness.clearReaderEvents());

    const frame = contentFrame();
    await frame.evaluate(() => {
      const selection = window.getSelection();
      selection.removeAllRanges();
      // A bare click collapses the selection at a point.
      const root = document.getElementById('wolfy-reader-content') || document.body;
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
      const root = document.getElementById('wolfy-reader-content') || document.body;
      const chunk = root.querySelector('.wolfy-reader-chunk') || root;
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

// --- geometry ---------------------------------------------------------------

/** Fires the release the coordination script forwards a settled selection on. */
async function releaseSelection(frame) {
  await frame.evaluate(
    () =>
      new Promise((done) => {
        setTimeout(() => {
          document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          done();
        }, 20);
      }),
  );
}

/** The stage's padding box in page coordinates — what a host positions a popover against. */
async function stagePaddingBox() {
  return page.evaluate(() => {
    const stage = document.querySelector('#stage');
    const box = stage.getBoundingClientRect();
    return {
      left: box.left + stage.clientLeft,
      top: box.top + stage.clientTop,
      width: stage.clientWidth,
      height: stage.clientHeight,
    };
  });
}

/**
 * Selects, inside the frame, the first text run that satisfies `pick` — the source
 * of a `(range, root) => boolean` evaluated in the frame over each text node's
 * trimmed range, with the root box alongside. Returns the selected text plus the
 * range's raw client-rect count, or null if nothing matched.
 */
async function selectWhere(frame, pickSource) {
  return frame.evaluate((source) => {
    const pick = new Function('range', 'root', `return (${source})(range, root);`);
    const rootEl = document.getElementById('wolfy-reader-content') || document.body;
    const root = rootEl.getBoundingClientRect();
    const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
    let node = null;
    while ((node = walker.nextNode())) {
      const data = node.data || '';
      if (data.trim().length < 20) continue;
      const range = document.createRange();
      range.setStart(node, data.search(/\S/));
      range.setEnd(node, data.trimEnd().length);
      if (range.getClientRects().length === 0) continue;
      if (!pick(range, root)) continue;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return { text: selection.toString(), rawRects: range.getClientRects().length };
    }
    return null;
  }, pickSource);
}

const inside = (box, outer, tolerance = 0.02) =>
  box.x >= outer.x - tolerance &&
  box.y >= outer.y - tolerance &&
  box.x + box.width <= outer.x + outer.width + tolerance &&
  box.y + box.height <= outer.y + outer.height + tolerance;

const union = (rects) => {
  const left = Math.min(...rects.map((r) => r.x));
  const top = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

const near = (a, b, tolerance = 0.02) => Math.abs(a - b) <= tolerance;
const sameBox = (a, b) =>
  near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);

/** Opens Alice at a mid-book chapter page, with the event log cleared. */
async function openAliceChapter() {
  await openReader(ALICE);
  await page.evaluate(() => window.harness.readerGoTo(0.2));
  await page.evaluate(() => window.harness.clearReaderEvents());
  return contentFrame();
}

describe('selection geometry', { ...skipAll, ...skipCorpus }, () => {
  test('the frame fills the container padding box, so frame px are container px', async () => {
    await openReader(ALICE);
    const stage = await stagePaddingBox();
    const frame = await page.evaluate(() => {
      const box = document.querySelector('#stage iframe').getBoundingClientRect();
      return { left: box.left, top: box.top, width: box.width, height: box.height };
    });
    // The coordinate-space invariant every case below rests on: ContentHost mounts
    // the iframe as display:block; border:0; width:100%; height:100%, so the frame's
    // viewport origin is the container's padding-box origin. If the mount style ever
    // gains a border or inset, the frame must subtract it — this is the tripwire.
    for (const key of ['left', 'top', 'width', 'height']) {
      assert.ok(
        near(frame[key], stage[key], 0.5),
        `iframe ${key} ${frame[key]} != container padding box ${stage[key]}`,
      );
    }
  });

  test('a single-line selection reports one box the host can hit-test back to the text', async () => {
    const frame = await openAliceChapter();
    const picked = await selectWhere(
      frame,
      `(range, root) => {
        const rects = range.getClientRects();
        if (rects.length !== 1) return false;
        const r = rects[0];
        return r.left >= root.left && r.right <= root.right && r.top >= root.top && r.bottom <= root.bottom;
      }`,
    );
    assert.ok(picked !== null, 'no single-line text run on the page');
    await releaseSelection(frame);
    const event = await waitForSelection();
    assert.ok(event !== undefined, 'no selection event fired');
    const { rect, rects, text } = event.payload;
    assert.equal(text, picked.text);
    assert.equal(rects.length, 1, `expected one line box, got ${rects.length}`);
    assert.ok(sameBox(rect, rects[0]), 'a single line box is its own bounding box');
    assert.ok(rect.width > 0 && rect.height > 0, 'the box has area');

    const stage = await stagePaddingBox();
    assert.ok(
      inside(rect, { x: 0, y: 0, width: stage.width, height: stage.height }),
      'the box lies within the container',
    );

    // Map the box into the page by adding the container's padding-box origin: the
    // element at its centre is the reader's iframe.
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const hitInPage = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return el === document.querySelector('#stage iframe') ? 'iframe' : (el?.tagName ?? 'null');
      },
      [stage.left + cx, stage.top + cy],
    );
    assert.equal(hitInPage, 'iframe', 'the box centre must land on the reader frame');
    // ... and inside the frame the same point (frame-viewport px, unchanged) hits the
    // element holding the selected text — the coordinate space is proven both ways.
    const hitInFrame = await frame.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.textContent ?? '',
      [cx, cy],
    );
    assert.ok(
      hitInFrame.includes(picked.text),
      `the frame element at the box centre does not hold the selection: ${hitInFrame.slice(0, 60)}`,
    );
  });

  test('a multi-line selection reports one box per line and their exact union', async () => {
    const frame = await openAliceChapter();
    const picked = await selectWhere(
      frame,
      `(range, root) => {
        const rects = range.getClientRects();
        if (rects.length < 2) return false;
        for (const r of rects) {
          if (r.left < root.left || r.right > root.right || r.top < root.top || r.bottom > root.bottom) return false;
        }
        return true;
      }`,
    );
    assert.ok(picked !== null, 'no wrapped paragraph fully on the page');
    await releaseSelection(frame);
    const event = await waitForSelection();
    assert.ok(event !== undefined, 'no selection event fired');
    const { rect, rects } = event.payload;
    assert.ok(rects.length >= 2, `expected at least two line boxes, got ${rects.length}`);
    assert.equal(rects.length, picked.rawRects, 'every line box is on the page, so none is clipped away');
    for (const line of rects) {
      assert.ok(inside(line, rect), `line box ${JSON.stringify(line)} escapes ${JSON.stringify(rect)}`);
    }
    assert.ok(
      sameBox(rect, union(rects)),
      `rect ${JSON.stringify(rect)} is not the union ${JSON.stringify(union(rects))}`,
    );
    for (let i = 1; i < rects.length; i += 1) {
      assert.ok(rects[i].y >= rects[i - 1].y - 0.02, 'line boxes must arrive in document order');
    }
  });

  test('scrolled mode reports where the text is on screen, not in the document', async () => {
    await openReader(ALICE);
    await page.evaluate(() => window.harness.readerGoTo(0.2));
    await page.evaluate(() => window.harness.readerSetMode('scrolled'));
    const frame = contentFrame();
    const scrolledBy = await frame.evaluate(() => {
      const scroller = document.scrollingElement || document.documentElement;
      window.scrollTo(0, scroller.scrollTop + 500);
      return scroller.scrollTop;
    });
    assert.ok(scrolledBy > 400, `the frame did not scroll (scrollTop ${scrolledBy})`);
    await page.evaluate(() => window.harness.clearReaderEvents());

    const picked = await selectWhere(
      frame,
      `(range) => {
        const rects = range.getClientRects();
        if (rects.length !== 1) return false;
        const r = rects[0];
        const viewport = document.documentElement;
        return r.top >= 0 && r.bottom <= viewport.clientHeight && r.left >= 0 && r.right <= viewport.clientWidth;
      }`,
    );
    assert.ok(picked !== null, 'no single-line text run in the scrolled viewport');
    const onScreen = await frame.evaluate(() => {
      const r = window.getSelection().getRangeAt(0).getClientRects()[0];
      return { top: r.top, documentTop: r.top + window.scrollY };
    });
    await releaseSelection(frame);
    const event = await waitForSelection();
    assert.ok(event !== undefined, 'no selection event fired');
    const { rect } = event.payload;
    const stage = await stagePaddingBox();
    assert.ok(
      rect.y >= 0 && rect.y + rect.height <= stage.height,
      `rect.y ${rect.y} is off the container (height ${stage.height})`,
    );
    assert.ok(near(rect.y, onScreen.top), `rect.y ${rect.y} is not the on-screen top ${onScreen.top}`);
    assert.ok(
      !near(rect.y, onScreen.documentTop, 1),
      `rect.y ${rect.y} is a document coordinate (${onScreen.documentTop})`,
    );
    await page.evaluate(() => window.harness.readerSetMode('paginated'));
  });

  test('a selection running into off-page columns is clipped to the visible page', async () => {
    const frame = await openAliceChapter();
    // Keyboard-extend past the page: the range runs from the first text run on the
    // page to the last text run of the same chunk, whose columns lay out to the right
    // of the root box and are invisible.
    const spanned = await frame.evaluate(() => {
      const rootEl = document.getElementById('wolfy-reader-content') || document.body;
      const root = rootEl.getBoundingClientRect();
      const walker = document.createTreeWalker(rootEl, NodeFilter.SHOW_TEXT, null);
      let first = null;
      let node = null;
      while ((node = walker.nextNode())) {
        if ((node.data || '').trim().length < 20) continue;
        const r = document.createRange();
        r.selectNodeContents(node);
        const box = r.getBoundingClientRect();
        if (box.width > 0 && box.left >= root.left && box.right <= root.right) {
          first = node;
          break;
        }
      }
      if (first === null) return null;
      let chunk = first.parentNode;
      while (chunk !== null && !(chunk.classList && chunk.classList.contains('wolfy-reader-chunk'))) {
        chunk = chunk.parentNode;
      }
      if (chunk === null) return null;
      const tail = document.createTreeWalker(chunk, NodeFilter.SHOW_TEXT, null);
      let last = null;
      while ((node = tail.nextNode())) if ((node.data || '').trim().length > 0) last = node;
      const range = document.createRange();
      range.setStart(first, first.data.search(/\S/));
      range.setEnd(last, last.data.length);
      const raw = Array.from(range.getClientRects());
      const visible = raw.filter(
        (r) =>
          Math.min(r.right, root.right) - Math.max(r.left, root.left) > 0 &&
          Math.min(r.bottom, root.bottom) - Math.max(r.top, root.top) > 0,
      ).length;
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return {
        raw: raw.length,
        visible,
        root: { x: root.left, y: root.top, width: root.width, height: root.height },
      };
    });
    assert.ok(spanned !== null, 'could not build a selection across the chunk');
    assert.ok(
      spanned.visible < spanned.raw,
      `the selection never left the page (${spanned.visible} of ${spanned.raw} rects visible)`,
    );
    await releaseSelection(frame);
    const event = await waitForSelection();
    assert.ok(event !== undefined, 'no selection event fired');
    const { rect, rects, text, position } = event.payload;
    assert.ok(text.length > 0 && typeof position?.serialized === 'string', 'text and Position still ride the event');
    assert.equal(rects.length, spanned.visible, `expected the ${spanned.visible} on-page line boxes, got ${rects.length}`);
    for (const line of rects) {
      assert.ok(inside(line, spanned.root), `line box ${JSON.stringify(line)} lies outside the root box`);
    }
    assert.ok(sameBox(rect, union(rects)), 'rect is the union of the kept boxes');
    assert.ok(inside(rect, spanned.root), 'the bounding box lies inside the root box');
  });

  test('a selection with no line on the visible page still fires, with empty geometry', async () => {
    const frame = await openAliceChapter();
    const picked = await selectWhere(
      frame,
      `(range, root) => {
        const r = range.getBoundingClientRect();
        return r.width > 0 && r.left >= root.right;
      }`,
    );
    assert.ok(picked !== null, 'no text run on a later page of this chunk');
    await releaseSelection(frame);
    const event = await waitForSelection();
    assert.ok(event !== undefined, 'a selection off the visible page must still fire');
    const { rect, rects, text, position } = event.payload;
    assert.equal(text, picked.text);
    assert.ok(typeof position?.serialized === 'string', 'the Position still rides the event');
    assert.deepEqual(rects, []);
    assert.deepEqual(rect, { x: 0, y: 0, width: 0, height: 0 });
  });
});

// --- clearing ---------------------------------------------------------------

/**
 * Collapses the live selection at a point and fires the release — what a bare click
 * in the page does. Dispatched without a preceding pointerdown, so the frame's
 * gesture tracker sees no tap and no page turns: the clear is observed on its own.
 */
async function collapseSelection(frame) {
  await frame.evaluate(() => {
    const selection = window.getSelection();
    selection.removeAllRanges();
    const root = document.getElementById('wolfy-reader-content') || document.body;
    const node = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null).nextNode();
    if (node !== null) selection.collapse(node, 0);
    return new Promise((done) => {
      setTimeout(() => {
        document.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }));
        done();
      }, 20);
    });
  });
}

const countOf = (log, type) => log.filter((e) => e.type === type).length;
const typesOf = (log) => log.map((e) => e.type);
const settle = () => new Promise((done) => setTimeout(done, 150));

/** Waits until the log holds at least `n` events of `type`, or a bounded number of polls. */
async function waitForCount(type, n) {
  for (let i = 0; i < 40; i += 1) {
    const log = await events();
    if (countOf(log, type) >= n) return log;
    await new Promise((done) => setTimeout(done, 25));
  }
  return events();
}

/** Selects the first sizeable text run in the frame and waits for the `selection` it reports. */
async function selectAndReport(frame, nth = 1) {
  const picked = await selectWhere(frame, '() => true');
  assert.ok(picked !== null, 'no text run to select');
  await releaseSelection(frame);
  const log = await waitForCount('selection', nth);
  assert.equal(countOf(log, 'selection'), nth, `selection #${nth} was not reported`);
}

describe('selection clearing', { ...skipAll, ...skipCorpus }, () => {
  test('a bare click after a reported selection fires one selectionclear; a second click none', async () => {
    const frame = await openAliceChapter();
    await selectAndReport(frame);
    await page.evaluate(() => window.harness.clearReaderEvents());

    await collapseSelection(frame);
    let log = await waitForCount('selectionclear', 1);
    await settle();
    log = await events();
    assert.deepEqual(typesOf(log), ['selectionclear'], 'exactly one clear, nothing else');
    assert.deepEqual(log[0].payload, {}, 'the clear carries no fields');

    // Nothing is reported now, so the same click is silent: the clear is a
    // transition, not a state.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await collapseSelection(frame);
    await settle();
    assert.deepEqual(typesOf(await events()), []);
  });

  test('a release that beats the queued selectionchange still clears exactly once', async () => {
    const frame = await openAliceChapter();
    await selectAndReport(frame);
    await page.evaluate(() => window.harness.clearReaderEvents());
    // Collapse and release in the same task: selectionchange is queued behind
    // both, which is what a synthetic mouse.click (or a real click under load)
    // looks like to the frame.
    await frame.evaluate(() => {
      const selection = window.getSelection();
      const root = document.getElementById('wolfy-reader-content') || document.body;
      const node = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null).nextNode();
      selection.removeAllRanges();
      if (node !== null) selection.collapse(node, 0);
      document.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }));
    });
    await waitForCount('selectionclear', 1);
    await settle();
    // The late selectionchange marks the (collapsed) selection dirty; the next
    // release has nothing reported and must stay silent.
    await frame.evaluate(() => {
      document.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }));
    });
    await settle();
    assert.deepEqual(typesOf(await events()), ['selectionclear']);
  });

  test('a replacement selection is not a clear: selection twice, selectionclear never', async () => {
    const frame = await openAliceChapter();
    await selectAndReport(frame, 1);
    // A different range (the first wrapped run) replaces the reported one.
    const picked = await selectWhere(frame, '(range) => range.getClientRects().length >= 2');
    assert.ok(picked !== null, 'no wrapped text run to select');
    await releaseSelection(frame);
    const log = await waitForCount('selection', 2);
    await settle();
    const final = await events();
    assert.equal(countOf(final, 'selection'), 2, 'the replacement must be reported');
    assert.equal(countOf(final, 'selectionclear'), 0, 'a replacement must not clear');
    assert.equal(countOf(log, 'selectionclear'), 0);
  });

  test('a section change clears once, before sectionchange', async () => {
    const frame = await openAliceChapter();
    await selectAndReport(frame);
    await page.evaluate(() => window.harness.clearReaderEvents());
    await page.evaluate(() => window.harness.readerNextSection());
    assert.deepEqual(typesOf(await events()), ['selectionclear', 'sectionchange', 'positionchange']);
    // The new document starts unreported: a click in it is silent.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await collapseSelection(contentFrame());
    await settle();
    assert.deepEqual(typesOf(await events()), []);
  });

  test('a page turn keeps the selection: no clear, and a later click still clears once', async () => {
    await openReader(ALICE);
    await page.evaluate(() => window.harness.readerGoTo(0.2));
    // Stay off the section's last page so next() turns a page rather than rolling.
    const at = await page.evaluate(() => window.harness.readerPosition());
    if (at.page >= at.totalPages - 1) await page.evaluate(() => window.harness.readerPrev());
    await page.evaluate(() => window.harness.clearReaderEvents());
    const frame = contentFrame();
    await selectAndReport(frame);
    await page.evaluate(() => window.harness.clearReaderEvents());

    const before = await page.evaluate(() => window.harness.readerPosition());
    const after = await page.evaluate(() => window.harness.readerNext());
    assert.equal(after.section, before.section, 'the turn must stay within the section');
    assert.notEqual(after.page, before.page, 'the page must have turned');
    assert.deepEqual(typesOf(await events()), ['positionchange'], 'a page turn is not a clear');

    // The selection object survived the translate, so the reader still holds it
    // reported: the eventual click clears exactly once.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await collapseSelection(frame);
    await waitForCount('selectionclear', 1);
    await settle();
    assert.deepEqual(typesOf(await events()), ['selectionclear']);
  });

  test('a mode switch rebuilds the document: one clear before positionchange, then silence', async () => {
    const frame = await openAliceChapter();
    await selectAndReport(frame);
    await page.evaluate(() => window.harness.clearReaderEvents());
    await page.evaluate(() => window.harness.readerSetMode('scrolled'));
    assert.deepEqual(typesOf(await events()), ['selectionclear', 'positionchange']);

    // Nothing is reported in the fresh document, so neither a click there nor the
    // switch back announces anything.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await collapseSelection(contentFrame());
    await settle();
    await page.evaluate(() => window.harness.readerSetMode('paginated'));
    assert.deepEqual(typesOf(await events()), ['positionchange']);
  });

  test('an appearance change clears only when it rebuilds the document', async () => {
    const frame = await openAliceChapter();
    await selectAndReport(frame);
    await page.evaluate(() => window.harness.clearReaderEvents());
    // A reflowing knob re-renders the section into a fresh document.
    await page.evaluate(() => window.harness.readerSetAppearance({ fontSize: 22 }));
    assert.deepEqual(typesOf(await events()), ['selectionclear', 'positionchange']);

    // The same value again is a no-op in the paginator (nothing re-assembled), so a
    // freshly reported selection must survive it untouched.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await selectAndReport(contentFrame());
    await page.evaluate(() => window.harness.clearReaderEvents());
    await page.evaluate(() => window.harness.readerSetAppearance({ fontSize: 22 }));
    assert.deepEqual(typesOf(await events()), ['positionchange'], 'a no-op change must not clear');
    // A colour-only change also rides the srcdoc, so it rebuilds too — and clears.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await page.evaluate(() => window.harness.readerSetAppearance({ theme: 'sepia' }));
    assert.deepEqual(typesOf(await events()), ['selectionclear', 'positionchange']);
  });
});

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

const corpusDir = resolve(repoRoot, 'test', 'corpus');
const corpusPresent = await present(resolve(corpusDir, 'gutenberg-alice-in-wonderland.epub'));
if (!corpusPresent) {
  console.log('decorations.browser: corpus book absent — tap cases skipped (run `npm run fetch-corpus`).');
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
 * overlay is on-screen to compare against) and satisfies `accept(rect)`, captures a
 * `Position` anchored at it, and returns { serialized, phrase, offset, rect, text } —
 * or null if no such on-page phrase is found.
 */
async function anchorOnPage(phraseLen = 12, accept = () => true) {
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
    if (rect !== null && rect.left >= 0 && rect.left < 800 && rect.top >= 0 && rect.top < 600 && accept(rect)) {
      const serialized = await page.evaluate(
        ([t, o]) => window.harness.buildPositionAt(t, o),
        [text, offset],
      );
      if (serialized !== null) return { serialized, phrase, offset, rect, text };
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

// --- decoration taps --------------------------------------------------------

/**
 * The content frame's box in page coordinates. The frame fills the reader element
 * with no border or inset, so a point in frame-viewport (container padding-box) px
 * maps to the page by adding this origin — which is what `page.mouse` needs.
 */
async function frameOrigin() {
  const iframe = await page.$('iframe');
  assert.ok(iframe !== null, 'the reader frame must be mounted');
  const box = await iframe.boundingBox();
  assert.ok(box !== null, 'the reader frame must have a box');
  return box;
}

/**
 * A real pointer press-release at a frame-viewport point (dx/dy = 0, well within
 * TAP_SLOP). The sandboxed frame is a separate compositing surface: a mouse event
 * dispatched before its freshly-committed document has produced a frame is routed
 * nowhere, so the click waits for the document to paint first.
 */
async function clickInFrame(x, y) {
  await framePainted();
  const origin = await frameOrigin();
  await page.mouse.click(origin.x + x, origin.y + y);
}

/** Resolves once the content frame has painted twice — its hit-test region is then live. */
function framePainted() {
  return contentFrame().evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done(true)))),
  );
}

/**
 * A frame-viewport point at `xFraction` of the frame width that sits on neither a
 * link nor an image — plain prose or empty page — scanning down the frame. Null if
 * the column is nothing but links (not the case for any fixture used here).
 */
function plainPointAt(xFraction) {
  return contentFrame().evaluate((f) => {
    const x = Math.round(window.innerWidth * f);
    for (let y = 40; y < window.innerHeight - 40; y += 20) {
      let node = document.elementFromPoint(x, y);
      let plain = node !== null;
      while (node && node.nodeType === 1) {
        const name = node.localName;
        if ((name === 'a' && node.hasAttribute('href')) || name === 'img' || name === 'image') plain = false;
        node = node.parentNode;
      }
      if (plain) return { x, y };
    }
    return null;
  }, xFraction);
}

function events() {
  return page.evaluate(() => window.harness.readerEvents());
}

function position() {
  return page.evaluate(() => window.harness.readerPosition());
}

/** Polls the event log until an event of `type` is recorded, or gives up after a bounded wait. */
async function waitForEvent(type) {
  for (let i = 0; i < 40; i += 1) {
    const found = (await events()).find((e) => e.type === type);
    if (found !== undefined) return found;
    await new Promise((done) => setTimeout(done, 25));
  }
  return undefined;
}

/** A bounded wait for events that must NOT arrive; returns the log afterwards. */
async function settledEvents() {
  await new Promise((done) => setTimeout(done, 300));
  return events();
}

/** The centre of a decoration's first painted box, in frame-viewport px. */
async function boxCentre(id) {
  const boxes = await overlayBoxes(id);
  assert.ok(boxes.length > 0, `decoration ${id} must have a painted box to tap`);
  const box = boxes[0];
  return { x: box.left + box.width / 2, y: box.top + box.height / 2, box };
}

function assertGeometry(entry, id) {
  assert.equal(entry.id, id, 'the tapped decoration id is reported');
  assert.equal(entry.className, 'hl', 'the tapped decoration class is reported');
  assert.ok(entry.rects.length > 0, 'a visible decoration reports its line boxes');
  for (const r of entry.rects) {
    assert.ok(r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0, `rect within the container: ${JSON.stringify(r)}`);
    assert.ok(r.x + r.width <= 800 + 1 && r.y + r.height <= 600 + 1, `rect clipped to the page: ${JSON.stringify(r)}`);
  }
  assert.ok(entry.rect.width > 0 && entry.rect.height > 0, 'the bounding box has area');
}

/**
 * Opens the corpus book on its first prose section. The book opens on a cover page
 * with no text to decorate or tap, so step forward until a section carries prose.
 */
async function openProse(options = {}) {
  await openReader(ALICE, options);
  for (let i = 0; i < 6; i += 1) {
    if ((await frameSectionText()).trim().length > 2000) return;
    await page.evaluate(() => window.harness.readerNextSection());
  }
  assert.fail('no prose section found in the corpus book');
}

describe('decoration taps', { ...skipAll, ...skipCorpus }, () => {
  test('a tap on a decoration reports it and turns no page, even in an edge zone', async () => {
    await openProse();
    // A phrase starting in the left third: a plain tap there would be a page-turn.
    const anchor = await anchorOnPage(12, (rect) => rect.left < 200);
    assert.ok(anchor !== null, 'an on-page phrase in the left tap zone is needed');
    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), anchor.serialized);
    const { x, y, box } = await boxCentre('h1');
    const tapX = Math.min(x, box.left + 8);
    assert.ok(tapX < 800 / 3, `the tap point (${tapX}) must lie in the left tap zone`);

    const before = await position();
    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(tapX, y);

    const event = await waitForEvent('decorationtap');
    assert.ok(event !== undefined, 'a tap on a decoration must emit decorationtap');
    assert.equal(event.payload.decorations.length, 1);
    assertGeometry(event.payload.decorations[0], 'h1');
    assert.ok(Math.abs(event.payload.x - tapX) <= 1 && Math.abs(event.payload.y - y) <= 1, 'x/y are the tap point in container px');
    // The tap point lies inside the reported geometry.
    const inside = event.payload.decorations[0].rects.some(
      (r) => tapX >= r.x && tapX <= r.x + r.width && y >= r.y && y <= r.y + r.height,
    );
    assert.ok(inside, 'the tap point must fall inside one of the reported boxes');

    const log = await settledEvents();
    assert.ok(log.every((e) => e.type !== 'tap'), 'a decoration tap is not also a plain tap');
    assert.ok(log.every((e) => e.type !== 'positionchange'), 'a decoration tap must not navigate');
    const after = await position();
    assert.deepEqual({ s: after.section, p: after.page }, { s: before.section, p: before.page }, 'the page must not turn');
  });

  test('overlapping decorations are all reported, most recently decorated first', async () => {
    await openProse();
    const anchor = await anchorOnPage(12);
    assert.ok(anchor !== null, 'an on-page phrase is needed');
    const later = await page.evaluate(
      ([t, o]) => window.harness.buildPositionAt(t, o),
      [anchor.text, anchor.offset + 4],
    );
    assert.ok(later !== null);
    await page.evaluate((s) => window.harness.readerDecorate('a', s, 'hl'), anchor.serialized);
    await page.evaluate((s) => window.harness.readerDecorate('b', s, 'hl'), later);

    // A point inside both first boxes.
    const a = (await overlayBoxes('a'))[0];
    const b = (await overlayBoxes('b'))[0];
    const left = Math.max(a.left, b.left);
    const right = Math.min(a.right, b.right);
    const top = Math.max(a.top, b.top);
    const bottom = Math.min(a.bottom, b.bottom);
    assert.ok(right > left && bottom > top, 'the two decorations must overlap on the page');
    const x = (left + right) / 2;
    const y = (top + bottom) / 2;

    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(x, y);
    let event = await waitForEvent('decorationtap');
    assert.ok(event !== undefined, 'a tap on two decorations must emit decorationtap');
    assert.deepEqual(event.payload.decorations.map((d) => d.id), ['b', 'a'], 'most recently decorated first');
    for (const entry of event.payload.decorations) assertGeometry(entry, entry.id);

    // Re-issuing `a` makes it the most recent again.
    await page.evaluate((s) => window.harness.readerDecorate('a', s, 'hl'), anchor.serialized);
    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(x, y);
    event = await waitForEvent('decorationtap');
    assert.ok(event !== undefined);
    assert.deepEqual(event.payload.decorations.map((d) => d.id), ['a', 'b'], 'a re-issued decoration is the most recent');
  });

  test('a plain tap reports `tap` before the zone navigation; the centre band navigates nothing', async () => {
    await openProse();
    const centre = await plainPointAt(0.5);
    assert.ok(centre !== null, 'a plain point in the centre band is needed');
    const before = await position();
    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(centre.x, centre.y);
    const tap = await waitForEvent('tap');
    assert.ok(tap !== undefined, 'a plain tap must emit tap');
    assert.ok(Math.abs(tap.payload.x - centre.x) <= 1 && Math.abs(tap.payload.y - centre.y) <= 1, 'x/y are container px');
    assert.deepEqual(Object.keys(tap.payload).sort(), ['x', 'y'], 'the payload is the tap point only');
    let log = await settledEvents();
    assert.ok(log.every((e) => e.type !== 'positionchange' && e.type !== 'decorationtap'), 'a centre tap navigates nothing');
    const held = await position();
    assert.deepEqual({ s: held.section, p: held.page }, { s: before.section, p: before.page });

    // An edge tap: tap first, then the page turns.
    const edge = await plainPointAt(0.85);
    assert.ok(edge !== null, 'a plain point in the right tap zone is needed');
    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(edge.x, edge.y);
    assert.ok((await waitForEvent('positionchange')) !== undefined, 'an edge tap must turn the page');
    log = await events();
    const types = log.map((e) => e.type);
    assert.ok(types.indexOf('tap') !== -1, 'the edge tap must also be reported');
    assert.ok(types.indexOf('tap') < types.indexOf('positionchange'), `tap precedes the navigation (${types.join(', ')})`);
    const after = await position();
    assert.notDeepEqual({ s: after.section, p: after.page }, { s: held.section, p: held.page }, 'the edge tap moved the reader');
  });

  test('a drag past TAP_SLOP is neither a tap nor a decoration tap', async () => {
    await openProse();
    const anchor = await anchorOnPage(12);
    assert.ok(anchor !== null);
    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), anchor.serialized);
    const { x, y } = await boxCentre('h1');
    const origin = await frameOrigin();

    await page.evaluate(() => window.harness.clearReaderEvents());
    // A vertical drag of 24px starting on the decoration: past TAP_SLOP (10), not a
    // horizontal-dominant swipe, so nothing is reported and nothing navigates.
    await framePainted();
    await page.mouse.move(origin.x + x, origin.y + y);
    await page.mouse.down();
    await page.mouse.move(origin.x + x, origin.y + y + 12);
    await page.mouse.move(origin.x + x, origin.y + y + 24);
    await page.mouse.up();

    const log = await settledEvents();
    assert.ok(log.every((e) => e.type !== 'tap'), 'a drag must not report a tap');
    assert.ok(log.every((e) => e.type !== 'decorationtap'), 'a drag must not report a decoration tap');
    assert.ok(log.every((e) => e.type !== 'positionchange'), 'a vertical drag must not navigate');
  });

  test('with a selection reported, tapping a decoration clears the selection first', async () => {
    await openProse();
    const anchor = await anchorOnPage(12);
    assert.ok(anchor !== null);
    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), anchor.serialized);
    const { x, y } = await boxCentre('h1');

    // Select text in a node other than the decorated one, then fire the release the
    // frame forwards on, so a `selection` stands reported.
    await page.evaluate(() => window.harness.clearReaderEvents());
    const selected = await contentFrame().evaluate((avoid) => {
      const root = document.getElementById('wolfy-reader-content') || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let node = null;
      while ((node = walker.nextNode())) {
        if ((node.data || '').trim().length >= 12 && node.data.indexOf(avoid) === -1) break;
      }
      if (node === null) return null;
      const start = node.data.search(/\S/);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, Math.min(start + 12, node.data.length));
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return new Promise((done) => {
        setTimeout(() => {
          document.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }));
          done(selection.toString());
        }, 20);
      });
    }, anchor.phrase);
    assert.ok(selected !== null, 'a second text node to select in is needed');
    assert.ok((await waitForEvent('selection')) !== undefined, 'the selection must be reported first');

    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(x, y);
    assert.ok((await waitForEvent('decorationtap')) !== undefined, 'the decoration tap must be reported');
    const types = (await events()).map((e) => e.type).filter((t) => t === 'selectionclear' || t === 'decorationtap');
    assert.deepEqual(types, ['selectionclear', 'decorationtap'], 'selectionclear precedes decorationtap');
  });

  test('tapping a highlight that is itself still selected reports the tap, then the clear', async () => {
    await openProse();
    // Select a phrase, report it, then decorate that exact span — the demo's flow.
    const selected = await contentFrame().evaluate(() => {
      const root = document.getElementById('wolfy-reader-content') || document.body;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      let node = null;
      let seen = 0;
      while ((node = walker.nextNode())) {
        if ((node.data || '').trim().length >= 14) {
          if (seen === 1) break;
          seen += 1;
        }
      }
      if (node === null) return null;
      const start = node.data.search(/\S/);
      const range = document.createRange();
      range.setStart(node, start);
      range.setEnd(node, start + 14);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const text = [...document.getElementsByClassName('wolfy-reader-chunk')].map((c) => c.textContent || '').join('');
      const rect = range.getBoundingClientRect();
      return new Promise((done) => {
        setTimeout(() => {
          document.dispatchEvent(new PointerEvent('pointerup', { isPrimary: true, bubbles: true, pointerId: 1 }));
          done({ text, phrase: selection.toString(), x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
        }, 20);
      });
    });
    assert.ok(selected !== null, 'a text node to select in is needed');
    assert.ok((await waitForEvent('selection')) !== undefined, 'the selection must be reported first');
    const serialized = await page.evaluate(
      ([t, p]) => window.harness.buildPositionAt(t, t.indexOf(p)),
      [selected.text, selected.phrase],
    );
    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), serialized);

    // Chromium collapses a selection the press landed inside only after `click`, so
    // the tap reports first and the collapse's own selectionchange carries the clear.
    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(selected.x, selected.y);
    assert.ok((await waitForEvent('decorationtap')) !== undefined, 'the decoration tap must be reported');
    assert.ok((await waitForEvent('selectionclear')) !== undefined, 'the collapsed selection must be cleared');
    const types = (await events()).map((e) => e.type).filter((t) => t === 'selectionclear' || t === 'decorationtap');
    assert.deepEqual(types, ['decorationtap', 'selectionclear'], 'one tap, then exactly one clear');
  });

  test('with tap zones disabled, taps and decoration taps are still reported', async () => {
    await openProse({ input: { tapZones: false } });
    const edge = await plainPointAt(0.85);
    assert.ok(edge !== null);
    const before = await position();
    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(edge.x, edge.y);
    assert.ok((await waitForEvent('tap')) !== undefined, 'tap is a report, not navigation, so it fires without zones');
    const log = await settledEvents();
    assert.ok(log.every((e) => e.type !== 'positionchange'), 'no zone navigation with tap zones off');
    const after = await position();
    assert.deepEqual({ s: after.section, p: after.page }, { s: before.section, p: before.page });

    const anchor = await anchorOnPage(12);
    assert.ok(anchor !== null);
    await page.evaluate((s) => window.harness.readerDecorate('h1', s, 'hl'), anchor.serialized);
    const { x, y } = await boxCentre('h1');
    await page.evaluate(() => window.harness.clearReaderEvents());
    await clickInFrame(x, y);
    const event = await waitForEvent('decorationtap');
    assert.ok(event !== undefined, 'decorationtap fires without zones too');
    assert.equal(event.payload.decorations[0].id, 'h1');
  });
});

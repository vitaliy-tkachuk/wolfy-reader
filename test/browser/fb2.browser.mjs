import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * FB2's footnote acceptance: a footnote link, when clicked inside the sandboxed
 * frame, jumps to the note body (a different section) and `back()` returns to the
 * pre-jump position — all on the reader's existing internal-link back-stack, with
 * no view/reader change. The decoder's only job is rewriting the FB2 `#note1` into
 * a `nb0#note1` href the reader can follow across sections; this proves it does.
 * Load-bearing in a browser because the link-click interception, the postMessage
 * round-trip, and the back-stack all live in the real reader + opaque-origin frame.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixturesDir = resolve(repoRoot, 'test', 'fixtures');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('fb2.browser: playwright is not installed — skipping. Run `npm install` first.');
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
      { prefix: '/fixtures', dir: fixturesDir },
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

function contentFrame() {
  const frames = page.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame — the reader content frame');
  return frames[0];
}

const FB2 = '/fixtures/fb2/basic.fb2';

describe('FB2 footnote jump + back', { ...skipAll }, () => {
  test('a footnote link jumps to the notes section and back() returns', async () => {
    const sections = await page.evaluate((u) => window.harness.openBook(u), FB2);
    assert.ok(sections !== null, 'the FB2 fixture opened');
    // s0 (chapter one), s1 (chapter two), nb0 (notes body).
    assert.deepEqual(sections.map((s) => s.id), ['s0', 's1', 'nb0']);

    const initial = await page.evaluate(() => window.harness.createReader({}));
    assert.equal(initial.section, 0, 'opens on the first chapter');

    // The footnote anchor is in the first paragraph of chapter one.
    const hasAnchor = await contentFrame().evaluate(() => document.querySelector('a[href="nb0#note1"]') !== null);
    assert.ok(hasAnchor, 'the footnote anchor carries the rewritten cross-section href');

    // Click it inside the frame; the reader intercepts, pushes the back-stack, and
    // follows the link to the notes section (index 2).
    await contentFrame().evaluate(() => document.querySelector('a[href="nb0#note1"]').click());
    await page.waitForFunction(() => window.harness.readerPosition().section === 2, null, { timeout: 5000 });

    const atNote = await page.evaluate(() => window.harness.readerPosition());
    assert.equal(atNote.section, 2, 'the jump landed on the notes section');
    const noteText = await contentFrame().evaluate(() => document.body.textContent);
    assert.ok(noteText.includes('This is the footnote body'), 'the note body is rendered');

    // back() returns to the pre-jump chapter.
    const back = await page.evaluate(() => window.harness.readerBack());
    assert.equal(back.section, 0, 'back() returned to chapter one');
  });

  test('the cover and inline image resolve to data: resources in the frame', async () => {
    await page.evaluate((u) => window.harness.openBook(u), FB2);
    await page.evaluate(() => window.harness.createReader({}));
    // Move to chapter two, which carries the inline image.
    await page.evaluate(() => window.harness.readerGoTo('end'));
    await page.waitForFunction(() => window.harness.readerPosition().section === 2 || window.harness.readerPosition().section === 1);
    // Land specifically on chapter two (section 1).
    await page.evaluate(() => window.harness.readerGoTo({ label: 'Chapter Two', sectionId: 's1', children: [] }));
    const imgSrc = await contentFrame().evaluate(() => {
      const img = document.querySelector('img');
      return img ? img.getAttribute('src') : null;
    });
    assert.ok(imgSrc && imgSrc.startsWith('data:image/png'), `the image resolved to a data: URL (got ${imgSrc})`);
  });
});

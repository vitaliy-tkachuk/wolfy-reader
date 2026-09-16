import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * The TTS enablers compose: `reader.sentences()` returns sentence ranges
 * whose Positions both resolve and highlight through the existing draw-only
 * `decorate` machinery, and stepping sentence-to-sentence moves the highlight. This
 * is the browser proof that the segmentation, the content-anchored Position, and the
 * decoration overlay compose end to end inside the opaque-origin frame — the exact
 * primitive a host builds text-to-speech on. The library speaks nothing; it draws.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('tts.browser: playwright is not installed — skipping. Run `npm install` first.');
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

function contentFrame() {
  const frames = page.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame');
  return frames[0];
}

async function boxCount(id) {
  return contentFrame().evaluate(
    (decorationId) => document.querySelectorAll(`[data-decoration="${decorationId}"]`).length,
    id,
  );
}

const HOSTILE = '/fixtures/hostile.epub';

describe('TTS enablers compose', { ...skipAll }, () => {
  test('sentences() yields resolvable ranges that highlight and step via decorate', async () => {
    const opened = await page.evaluate((u) => window.harness.openBook(u), HOSTILE);
    assert.ok(opened !== null, 'the fixture opened');
    await page.evaluate(() => window.harness.createReader({}));

    const sentences = await page.evaluate(() => window.harness.readerSentences());
    assert.ok(sentences.length >= 2, `expected multiple sentences, got ${sentences.length}`);
    assert.ok(sentences[0].text.trim().length > 0, 'the first sentence has text');

    // Highlight the first sentence — the decoration draws overlay boxes over the
    // range its Position resolves to.
    await page.evaluate(([pos]) => window.harness.readerDecorate('tts', pos, 'wr-tts'), [sentences[0].position]);
    const first = await boxCount('tts');
    assert.ok(first > 0, `the first sentence highlighted (${first} boxes)`);

    // Step to the next sentence: move the single highlight forward.
    await page.evaluate(() => window.harness.readerUndecorate('tts'));
    assert.equal(await boxCount('tts'), 0, 'the previous highlight cleared');
    await page.evaluate(([pos]) => window.harness.readerDecorate('tts', pos, 'wr-tts'), [sentences[1].position]);
    const second = await boxCount('tts');
    assert.ok(second > 0, `the highlight moved to the second sentence (${second} boxes)`);
  });

  test('a sentence Position is jumpable via goTo', async () => {
    await page.evaluate((u) => window.harness.openBook(u), HOSTILE);
    await page.evaluate(() => window.harness.createReader({}));
    const sentences = await page.evaluate(() => window.harness.readerSentences());
    // Jump to a mid-section sentence; it resolves to a page (no throw, position stays
    // in-section).
    const landed = await page.evaluate((pos) => window.harness.readerGoToSerialized(pos), sentences[Math.min(3, sentences.length - 1)].position);
    assert.equal(landed.section, 0, 'the sentence jump stayed in the section');
  });
});

import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for the appearance system's theme half. Themes, the cascade fight
 * with publisher CSS, and `prefers-color-scheme` are computed-style / rendering
 * behaviour inside the opaque-origin sandboxed frame that only a real browser can
 * assert — hence full Chromium. The pure mapping/merge/serialization logic lives
 * in the headless test/appearance.test.ts.
 *
 * Mirrors reader.browser.mjs: same serve-demo mounts, same harness.html, and a
 * graceful skip when playwright is absent. These cases render a synthetic in-memory
 * section straight through the facade, so no corpus book is needed.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');
const corpusDir = resolve(repoRoot, 'test', 'corpus');

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('appearance.browser: playwright is not installed — skipping. Run `npm install` first.');
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
      { prefix: '/corpus', dir: corpusDir },
      { prefix: '/', dir: browserDir },
    ],
  });
  browser = await playwright.chromium.launch({ channel: 'chromium' });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/** A fresh page (so a `colorScheme` emulation does not leak between cases). */
async function freshPage(colorScheme) {
  const context = await browser.newContext(colorScheme === undefined ? {} : { colorScheme });
  const p = await context.newPage();
  await p.goto(`${server.origin}/harness.html`);
  await p.waitForFunction(() => window.harnessReady === true);
  return p;
}

/** The reader's single content frame; asserts nothing else is mounted. */
function contentFrame(p) {
  const frames = p.mainFrame().childFrames();
  assert.equal(frames.length, 1, 'expected exactly one child frame — the reader content frame');
  return frames[0];
}

/** Computed background/color of the frame's content root, as rgb() strings. */
async function rootColors(p) {
  return contentFrame(p).evaluate(() => {
    const root = document.getElementById('wolfyreader-content');
    const style = getComputedStyle(root);
    return { background: style.backgroundColor, color: style.color };
  });
}

/** A plain paragraph section — no publisher styling, so the theme owns everything. */
const PLAIN = {
  id: 'plain',
  mediaType: 'application/xhtml+xml',
  source:
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>' +
    '<body><p>Hello, themed world. This is a paragraph of readable prose.</p></body></html>',
};

/**
 * A hostile section: its own CSS forces black-on-white on `body` and `*`. A dark
 * theme must still win the reading surface — the theme variables the book never
 * names cannot be clobbered.
 */
const HOSTILE_CSS = {
  id: 'hostile-css',
  mediaType: 'application/xhtml+xml',
  source:
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title>' +
    '<style>html,body{background:#ffffff !important;color:#000000 !important}' +
    '*{background:#ffffff;color:#000000}</style></head>' +
    '<body><p>Publisher CSS tries to force black on white here.</p></body></html>',
};

async function openThemed(p, spec, options) {
  const opened = await p.evaluate(
    ([s, o]) => window.harness.createReaderWithSection(s, o),
    [spec, options],
  );
  return opened;
}

describe('per-theme content colours', { ...skipAll }, () => {
  test('light / dark / sepia each set the content root background and colour', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, { theme: 'light' });
      const light = await rootColors(p);
      assert.equal(light.background, 'rgb(255, 255, 255)', 'light background');
      assert.equal(light.color, 'rgb(26, 26, 26)', 'light colour');

      await p.evaluate(() => window.harness.readerSetAppearance({ theme: 'dark' }));
      const dark = await rootColors(p);
      assert.equal(dark.background, 'rgb(18, 18, 18)', 'dark background');
      assert.equal(dark.color, 'rgb(230, 230, 230)', 'dark colour');

      await p.evaluate(() => window.harness.readerSetAppearance({ theme: 'sepia' }));
      const sepia = await rootColors(p);
      assert.equal(sepia.background, 'rgb(244, 236, 216)', 'sepia background');
      assert.equal(sepia.color, 'rgb(91, 70, 54)', 'sepia colour');
    } finally {
      await p.context().close();
    }
  });
});

describe('custom theme', { ...skipAll }, () => {
  test('caller-supplied --wr-* properties take effect end to end', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {
        theme: 'custom',
        customProperties: { '--wr-background': 'rgb(10, 20, 30)', '--wr-color': 'rgb(200, 210, 220)' },
      });
      const colors = await rootColors(p);
      assert.equal(colors.background, 'rgb(10, 20, 30)', 'custom background did not take effect');
      assert.equal(colors.color, 'rgb(200, 210, 220)', 'custom colour did not take effect');
    } finally {
      await p.context().close();
    }
  });
});

describe('publisher CSS does not clobber the theme variables', { ...skipAll }, () => {
  test('a dark theme wins the reading surface even against body/*{color;background !important}', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, HOSTILE_CSS, { theme: 'dark' });
      const colors = await rootColors(p);
      // The publisher forces #fff/#000; the theme owns the content root's surface
      // through variables the book cannot reach, so dark still wins there.
      assert.equal(colors.background, 'rgb(18, 18, 18)', 'publisher CSS clobbered the theme background');
      assert.equal(colors.color, 'rgb(230, 230, 230)', 'publisher CSS clobbered the theme colour');
    } finally {
      await p.context().close();
    }
  });
});

describe('prefers-color-scheme', { ...skipAll }, () => {
  test('with no theme forced, the OS dark mode renders dark content', async () => {
    const p = await freshPage('dark');
    try {
      await openThemed(p, PLAIN, {});
      const colors = await rootColors(p);
      assert.equal(colors.background, 'rgb(18, 18, 18)', 'OS dark mode did not render dark');
      assert.equal(colors.color, 'rgb(230, 230, 230)');
    } finally {
      await p.context().close();
    }
  });

  test('a forced light theme overrides the OS dark preference', async () => {
    const p = await freshPage('dark');
    try {
      await openThemed(p, PLAIN, { theme: 'light' });
      const colors = await rootColors(p);
      assert.equal(colors.background, 'rgb(255, 255, 255)', 'a forced theme did not override the media query');
      assert.equal(colors.color, 'rgb(26, 26, 26)');
    } finally {
      await p.context().close();
    }
  });

  test('with no theme forced, the OS light mode renders light content', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {});
      const colors = await rootColors(p);
      assert.equal(colors.background, 'rgb(255, 255, 255)', 'OS light mode did not render light');
    } finally {
      await p.context().close();
    }
  });
});

describe('a colour change preserves the reading place', { ...skipAll }, () => {
  test('setAppearance holds the section and page across a theme swap', async () => {
    const p = await freshPage('light');
    try {
      const before = await openThemed(p, PLAIN, { theme: 'light' });
      const after = await p.evaluate(() => window.harness.readerSetAppearance({ theme: 'dark' }));
      assert.equal(after.section, before.section, 'the theme swap left the section');
      assert.equal(after.page, before.page, 'the theme swap moved the page');
      // And the colours actually changed — the swap did apply.
      const colors = await rootColors(p);
      assert.equal(colors.background, 'rgb(18, 18, 18)');
    } finally {
      await p.context().close();
    }
  });
});

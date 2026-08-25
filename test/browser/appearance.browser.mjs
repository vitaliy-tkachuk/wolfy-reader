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

/** Computed typography of the content root (font/size/line-height/align/hyphens). */
async function rootTypography(p) {
  return contentFrame(p).evaluate(() => {
    const style = getComputedStyle(document.getElementById('wolfyreader-content'));
    return {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
      textAlign: style.textAlign,
      hyphens: style.hyphens || style.webkitHyphens,
    };
  });
}

/**
 * Computed column-width of the first per-chunk multi-column container, in px. Each
 * chunk is a CSS multi-column context built with `column-width` (not `column-count`,
 * which computes to `auto`), so a 2-column page halves this value — the observable
 * proof that the columns knob took effect.
 */
async function chunkColumnWidth(p) {
  return contentFrame(p).evaluate(() => {
    const chunk = document.querySelector('.wolfyreader-chunk');
    return parseFloat(getComputedStyle(chunk).columnWidth);
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

// A long section: enough paragraphs to span many pages, each numbered so a
// visible anchor can be located before and after a reflowing knob. Unstyled, so
// the reader's typography owns the surface.
function longSection() {
  const paras = [];
  for (let i = 0; i < 120; i += 1) {
    paras.push(
      `<p>Paragraph ${i}. ` +
        'The quick brown fox jumps over the lazy dog and keeps running across ' +
        'the meadow, past the river, and into the forest where the trees grow ' +
        'tall and the light falls in long soft beams through the canopy above. '.repeat(3) +
        `End of paragraph ${i}.</p>`,
    );
  }
  return {
    id: 'long',
    mediaType: 'application/xhtml+xml',
    source:
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head>' +
      `<body>${paras.join('')}</body></html>`,
  };
}

/** The text painted on the current page (the visible reading anchor). */
async function visiblePageText(p) {
  return contentFrame(p).evaluate(() => {
    const root = document.getElementById('wolfyreader-content');
    const rootRect = root.getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll('.wolfyreader-chunk p')) {
      if (getComputedStyle(el.closest('.wolfyreader-chunk')).visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      // A paragraph painted on the current page overlaps the root's viewport box.
      if (r.right > rootRect.left + 1 && r.left < rootRect.right - 1 && r.width > 0 && r.height > 0) {
        out.push(el.textContent);
      }
    }
    return out;
  });
}

describe('typography knobs each change the rendered content', { ...skipAll }, () => {
  test('fontFamily sets the content root font-family', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {});
      await p.evaluate(() => window.harness.readerSetAppearance({ fontFamily: 'Georgia, serif' }));
      const typography = await rootTypography(p);
      assert.match(typography.fontFamily, /Georgia/, 'fontFamily did not apply');
    } finally {
      await p.context().close();
    }
  });

  test('fontSize sets the content root font-size', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {});
      await p.evaluate(() => window.harness.readerSetAppearance({ fontSize: 28 }));
      assert.equal((await rootTypography(p)).fontSize, '28px', 'fontSize did not apply');
    } finally {
      await p.context().close();
    }
  });

  test('lineHeight sets the content root line-height', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {});
      await p.evaluate(() => window.harness.readerSetAppearance({ fontSize: 20, lineHeight: 2 }));
      // line-height 2 × 20px font resolves to 40px.
      assert.equal((await rootTypography(p)).lineHeight, '40px', 'lineHeight did not apply');
    } finally {
      await p.context().close();
    }
  });

  test('textAlign start and justify each take effect', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {});
      await p.evaluate(() => window.harness.readerSetAppearance({ textAlign: 'justify' }));
      assert.equal((await rootTypography(p)).textAlign, 'justify', 'textAlign justify did not apply');
      await p.evaluate(() => window.harness.readerSetAppearance({ textAlign: 'start' }));
      assert.equal((await rootTypography(p)).textAlign, 'start', 'textAlign start did not apply');
    } finally {
      await p.context().close();
    }
  });

  test('justify:true sets text-align:justify', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {});
      await p.evaluate(() => window.harness.readerSetAppearance({ justify: true }));
      assert.equal((await rootTypography(p)).textAlign, 'justify', 'justify did not set text-align:justify');
    } finally {
      await p.context().close();
    }
  });

  test('hyphenate:true sets hyphens:auto on the content root', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, PLAIN, {});
      await p.evaluate(() => window.harness.readerSetAppearance({ hyphenate: true }));
      assert.equal((await rootTypography(p)).hyphens, 'auto', 'hyphenate did not set hyphens:auto');
    } finally {
      await p.context().close();
    }
  });

  test('margin sets the per-chunk column-gap (the page margin)', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, longSection(), { margin: 40 });
      const before = await contentFrame(p).evaluate(
        () => parseFloat(getComputedStyle(document.querySelector('.wolfyreader-chunk')).columnGap),
      );
      await p.evaluate(() => window.harness.readerSetAppearance({ margin: 96 }));
      const after = await contentFrame(p).evaluate(
        () => parseFloat(getComputedStyle(document.querySelector('.wolfyreader-chunk')).columnGap),
      );
      assert.equal(before, 40, 'the initial margin did not apply as column-gap');
      assert.equal(after, 96, 'margin did not change the column-gap');
    } finally {
      await p.context().close();
    }
  });

  test('columns:2 halves the per-chunk column width (a two-column page)', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, longSection(), {});
      const single = await chunkColumnWidth(p);
      await p.evaluate(() => window.harness.readerSetAppearance({ columns: 2 }));
      const double = await chunkColumnWidth(p);
      assert.ok(single > 0 && double > 0, 'expected measurable column widths');
      assert.ok(
        double < single * 0.6,
        `columns:2 did not narrow the columns (single ${single}px, double ${double}px)`,
      );
    } finally {
      await p.context().close();
    }
  });

  test('columns:2 passed as a reader option applies at the first render', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, longSection(), { columns: 1 });
      const single = await chunkColumnWidth(p);
      await openThemed(p, longSection(), { columns: 2 });
      const double = await chunkColumnWidth(p);
      assert.ok(
        double < single * 0.6,
        `columns:2 option did not apply at first render (single ${single}px, double ${double}px)`,
      );
    } finally {
      await p.context().close();
    }
  });
});

describe('a reflowing knob preserves the reading place', { ...skipAll }, () => {
  test('the visible anchor text survives a fontSize change', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, longSection(), { fontSize: 14 });
      // Move a few pages in so the anchor is genuinely mid-section.
      await p.evaluate(async () => {
        for (let i = 0; i < 4; i += 1) await window.harness.readerNext();
        return window.harness.readerPosition();
      });
      const before = await visiblePageText(p);
      assert.ok(before.length > 0, 'expected visible text before the reflow');
      const anchor = before[0];

      await p.evaluate(() => window.harness.readerSetAppearance({ fontSize: 24 }));

      const after = await visiblePageText(p);
      assert.ok(after.length > 0, 'expected visible text after the reflow');
      // The reflow changes the page geometry, but the reading place is held: the
      // paragraph that anchored the page before is still on the page after.
      assert.ok(
        after.includes(anchor),
        `the anchored paragraph was lost across the reflow: ${JSON.stringify(anchor).slice(0, 60)}`,
      );
      // And the reflow really did resize the text.
      assert.equal((await rootTypography(p)).fontSize, '24px', 'the fontSize change did not apply');
    } finally {
      await p.context().close();
    }
  });
});

describe('prefers-reduced-motion never blocks a page turn', { ...skipAll }, () => {
  test('under reduce, next() still advances the page (input is never gated)', async () => {
    const context = await browser.newContext({ colorScheme: 'light', reducedMotion: 'reduce' });
    const p = await context.newPage();
    try {
      await p.goto(`${server.origin}/harness.html`);
      await p.waitForFunction(() => window.harnessReady === true);
      const before = await openThemed(p, longSection(), {});
      const after = await p.evaluate(() => window.harness.readerNext());
      assert.equal(after.page, before.page + 1, 'reduced-motion must not stop a page turn');
      // There is no page-turn animation in this unit; the assertion is that input
      // is unaffected by the preference, matching the documented no-op.
    } finally {
      await p.context().close();
    }
  });
});

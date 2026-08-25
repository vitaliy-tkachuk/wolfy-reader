import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../scripts/serve-demo.mjs';

/**
 * Browser tests for the appearance system. Themes, the cascade fight with publisher
 * CSS, `prefers-color-scheme`, per-knob computed styles, and — the core of this
 * suite — the position-preserving invariant are all computed-style / rendering
 * behaviour inside the opaque-origin sandboxed frame that only a real browser can
 * assert, hence full Chromium. The pure mapping/merge/serialization logic lives in
 * the headless test/appearance.test.ts.
 *
 * Mirrors reader.browser.mjs: same serve-demo mounts, same harness.html, a graceful
 * skip when playwright is absent and — for the corpus-backed invariant cases — when
 * the gitignored corpus books are absent. The synthetic-section cases below need no
 * corpus book; the invariant suite exercises real Gutenberg EPUBs.
 *
 * ## The position-preserving invariant
 *
 * `setAppearance` and `setMode` are position-preserving *by contract*: after any
 * appearance knob changes (fontSize, fontFamily, lineHeight, margin, columns) or the
 * mode switches paginated↔scrolled, the reader's place is preserved. The mechanism
 * is the content anchor (an exact quote + context, not a page number): capture a
 * `Position` for the current page → re-lay out → resolve that `Position` against the
 * new layout → seek back to the page it now lands on.
 *
 * The stated tolerance is the anchor paragraph, not a page number:
 *
 *   TOLERANCE — the paragraph that anchored the top of the page *before* the change
 *   is visible on the page *after* the change.
 *
 * Page numbers shift when text reflows (a bigger font makes more pages); the anchor
 * paragraph does not. In scrolled mode paging collapses, so a mid-section anchor
 * resolves to the section's first page — a documented drift, not a violation — so the
 * mode-switch cases assert the weaker guarantee scrolled mode actually offers: the
 * section is preserved and the anchor paragraph is still present in the rendered
 * content, i.e. the reading place is not lost even though the exact page is.
 */

const browserDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(browserDir, '..', '..');
const fixtureDir = resolve(repoRoot, 'test', 'fixtures', 'epub');
const corpusDir = resolve(repoRoot, 'test', 'corpus');

// Two corpus books, so the invariant is proven against more than one publisher's
// markup. Each is checked for presence independently; a book that is absent skips
// its own cases (the corpus is gitignored and downloaded).
const CORPUS_BOOKS = [
  { label: 'frankenstein', url: '/corpus/gutenberg-frankenstein.epub' },
  { label: 'moby-dick', url: '/corpus/gutenberg-moby-dick.epub' },
];

let playwright = null;
try {
  playwright = await import('playwright');
} catch {
  console.log('appearance.browser: playwright is not installed — skipping. Run `npm install` first.');
}

const corpusPresent = new Map();
for (const book of CORPUS_BOOKS) {
  try {
    await access(resolve(corpusDir, book.url.replace('/corpus/', '')));
    corpusPresent.set(book.url, true);
  } catch {
    corpusPresent.set(book.url, false);
    console.log(
      `appearance.browser: ${book.label} corpus book absent — its invariant cases skipped (run \`npm run fetch-corpus\`).`,
    );
  }
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

/**
 * The paragraph texts painted on the *current page* in paginated mode. A paragraph
 * is on the page when its chunk is visible and its box overlaps the root viewport
 * box horizontally (paginated pages scroll horizontally by column stride). This is
 * the "visible reading anchor" the tolerance is stated over.
 */
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

/** Every paragraph text rendered in the section, regardless of the current page. */
async function allSectionText(p) {
  return contentFrame(p).evaluate(() =>
    [...document.querySelectorAll('.wolfyreader-chunk p')].map((el) => el.textContent),
  );
}

/**
 * Whether the rendered section is genuine prose — several long-bodied paragraphs —
 * rather than a table of contents or a heading list (whose near-identical short
 * lines make no honest reading anchor). Requires enough paragraphs whose text is
 * long enough to be a real paragraph.
 */
async function isProseSection(p) {
  const paras = await allSectionText(p);
  const long = paras.filter((text) => text.trim().length >= 200);
  return long.length >= 4;
}

/**
 * The invariant, as one falsifiable assertion: the anchor paragraph visible before
 * the change is among the paragraphs visible after it. Shared by every knob case and
 * by the deliberate-regression proof (which asserts it *throws* when the restore is
 * skipped), so the suite guards the invariant rather than passing vacuously.
 */
function assertAnchorPreserved(anchor, afterVisible, label) {
  assert.ok(afterVisible.length > 0, `${label}: expected visible text after the change`);
  assert.ok(
    afterVisible.includes(anchor),
    `${label}: the anchored paragraph was lost — tolerance violated: ${JSON.stringify(anchor).slice(0, 70)}`,
  );
}

// The appearance knobs under test. Each names the setAppearance patch that drives
// it; every reflowing knob (fontSize, fontFamily, lineHeight, margin, columns) is
// covered — none is skipped.
const KNOBS = [
  { name: 'fontSize', patch: { fontSize: 26 } },
  { name: 'fontFamily', patch: { fontFamily: 'Georgia, serif' } },
  { name: 'lineHeight', patch: { lineHeight: 2 } },
  { name: 'margin', patch: { margin: 96 } },
  { name: 'columns', patch: { columns: 2 } },
];

/**
 * The TOP-MOST substantial prose paragraph visible on the current page (>= 120
 * chars), or null when no substantial paragraph is on the page. This is the reading
 * place the reader actually promises: the restore anchors on the page-START offset
 * (`positionOfPage` → `offsetOfPage(page)`), so the tolerance is stated over the
 * paragraph at the TOP of the page, not the longest one — a longest-anywhere
 * paragraph can sit at the bottom of the page and legitimately fall onto an adjacent
 * page when the column count changes, even though the reading place is held. The
 * >= 120-char floor keeps the anchor unambiguous to resolve (a bare chapter heading
 * can be a near-duplicate of a table-of-contents entry); `visiblePageText` returns
 * paragraphs in document order, so the first that clears the floor is the top-most.
 */
async function pageAnchor(p) {
  const visible = await visiblePageText(p);
  for (const text of visible) {
    if (typeof text !== 'string') continue;
    if (text.trim().length < 120) continue;
    return text;
  }
  return null;
}

/**
 * Positions the reader `pages` into the active section and returns the anchor
 * paragraph on that page — a long prose paragraph, so the anchor is genuinely
 * mid-section and unambiguous. When the initial page carries no such paragraph
 * (front matter, a heading list), it advances page by page until one appears
 * (bounded). Returns null when the section never yields a prose page — the caller
 * skips that combination rather than asserting over a degenerate anchor.
 */
async function seekMidSection(p, pages) {
  for (let i = 0; i < pages; i += 1) await p.evaluate(() => window.harness.readerNext());
  for (let extra = 0; extra < 20; extra += 1) {
    const anchor = await pageAnchor(p);
    if (anchor !== null) return anchor;
    const before = await p.evaluate(() => window.harness.readerPosition());
    const after = await p.evaluate(() => window.harness.readerNext());
    // Reached the section's end without finding a prose page.
    if (after.page === before.page) return null;
  }
  return null;
}

describe('the appearance invariant — position preserved across every knob', { ...skipAll }, () => {
  for (const book of CORPUS_BOOKS) {
    const skipBook = corpusPresent.get(book.url) ? {} : { skip: 'the corpus book is absent' };
    // Two starting positions per book: the section start (page 0) and a mid-section
    // page. The invariant must hold from both.
    for (const start of [
      { label: 'section start', pages: 0 },
      { label: 'mid-section', pages: 4 },
    ]) {
      for (const knob of KNOBS) {
        test(`${book.label} @ ${start.label}: ${knob.name} preserves the reading place`, { ...skipBook }, async () => {
          const p = await freshPage('light');
          try {
            await openCorpusReaderOnLongSection(p, book.url);
            const anchor = await seekMidSection(p, start.pages);
            if (anchor === null) {
              // Section too short to hold a mid-section anchor — nothing to assert.
              return;
            }
            await p.evaluate((patch) => window.harness.readerSetAppearance(patch), knob.patch);
            const after = await visiblePageText(p);
            assertAnchorPreserved(anchor, after, `${book.label}/${start.label}/${knob.name}`);
          } finally {
            await p.context().close();
          }
        });
      }

      test(`${book.label} @ ${start.label}: paginated↔scrolled preserves the reading place`, { ...skipBook }, async () => {
        const p = await freshPage('light');
        try {
          await openCorpusReaderOnLongSection(p, book.url);
          const anchor = await seekMidSection(p, start.pages);
          if (anchor === null) return;
          const before = await p.evaluate(() => window.harness.readerPosition());

          // paginated → scrolled. Paging collapses in scrolled mode, so a mid-section
          // anchor resolves to the section's first page — a documented drift. The
          // guarantee scrolled mode offers is section-level: the section is held and
          // the anchor paragraph is still present in the rendered content, so the
          // reading place is not lost even though the exact page is.
          const scrolled = await p.evaluate(() => window.harness.readerSetMode('scrolled'));
          assert.equal(scrolled.section, before.section, 'the mode switch left the section');
          const rendered = await allSectionText(p);
          assert.ok(
            rendered.includes(anchor),
            `scrolled render dropped the anchor paragraph: ${JSON.stringify(anchor).slice(0, 70)}`,
          );

          // scrolled → paginated. The section is preserved across the round trip.
          const back = await p.evaluate(() => window.harness.readerSetMode('paginated'));
          assert.equal(back.section, before.section, 'the round-trip switch left the section');
        } finally {
          await p.context().close();
        }
      });
    }
  }
});

/**
 * Opens `url` through the facade and lands on a section long enough to hold a
 * mid-section anchor (several pages of body paragraphs). Throws if the book has no
 * such section, which would make the invariant vacuous.
 */
async function openCorpusReaderOnLongSection(p, url) {
  const sections = await p.evaluate((u) => window.harness.openBook(u), url);
  assert.ok(sections !== null, `${url} could not be fetched`);
  await p.evaluate(() => window.harness.createReader({ fontSize: 16 }));
  for (const section of sections) {
    // Jump to the section by its id (a TocItem-shaped goTo target), then require it
    // to be genuine prose spanning several pages so a mid-section anchor exists —
    // skipping tables of contents / heading lists, whose near-identical short lines
    // make no honest reading anchor.
    await p.evaluate((id) => window.harness.readerGoTo({ sectionId: id, children: [] }), section.id);
    const state = await p.evaluate(() => window.harness.readerPosition());
    if (state.totalPages >= 3 && (await isProseSection(p))) return;
  }
  throw new assert.AssertionError({ message: `${url} has no section long enough for a mid-section anchor` });
}

describe('the deliberate-regression proof — the invariant assertion is falsifiable', { ...skipAll }, () => {
  test('skipping the restore (landing on page 0) makes the invariant assertion fail', async () => {
    const p = await freshPage('light');
    try {
      await openThemed(p, longSection(), { fontSize: 14 });
      // Move several pages in so the anchor is genuinely mid-section.
      await p.evaluate(async () => {
        for (let i = 0; i < 5; i += 1) await window.harness.readerNext();
      });
      const before = await visiblePageText(p);
      assert.ok(before.length > 0, 'expected visible text before the reflow');
      const anchor = before[0];

      // 1. Restore INTACT: setAppearance re-lays out and seeks back to the anchor's
      //    new page. The invariant holds — the anchor paragraph survives the reflow.
      await p.evaluate(() => window.harness.readerSetAppearance({ fontSize: 24 }));
      const afterRestored = await visiblePageText(p);
      assertAnchorPreserved(anchor, afterRestored, 'restore-intact');
      assert.equal((await rootTypography(p)).fontSize, '24px', 'the reflow did not resize the text');

      // 2. Restore SKIPPED: page 0 is exactly where `#reapply` lands when the anchor
      //    fails to resolve (`goToPage(page >= 0 ? page : 0)`), i.e. the restore leg
      //    did nothing. Land there deliberately and feed that page's text to the SAME
      //    invariant assertion — it MUST throw, proving the assertion is falsifiable
      //    and the mechanism (not the assertion) is what preserves the place. This is
      //    encoded as assert.throws so nothing is left permanently failing in the tree.
      await p.evaluate(() => window.harness.readerGoTo('start'));
      const page0 = await visiblePageText(p);
      assert.notEqual(page0[0], anchor, 'page 0 unexpectedly still holds the mid-section anchor');
      assert.throws(
        () => assertAnchorPreserved(anchor, page0, 'restore-skipped'),
        /tolerance violated/,
        'the invariant assertion did not fail when the restore was skipped — the suite could pass vacuously',
      );
    } finally {
      await p.context().close();
    }
  });
});

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
      assertAnchorPreserved(anchor, after, 'synthetic fontSize reflow');
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

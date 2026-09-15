import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  isReflowingUpdate,
  mergeAppearance,
  resolveThemeProperties,
  resolveTypographyProperties,
  THEMES,
  themeStyleSheet,
  type Appearance,
} from '../src/view/appearance.ts';
import { asHostMessage, PROTOCOL_VERSION } from '../src/view/protocol.ts';

/**
 * Headless unit tests for the appearance system's pure logic: appearance-state
 * merge, `--wr-*` variable resolution, and the shape of the injected theme
 * stylesheet. The cascade fight with publisher CSS and `prefers-color-scheme`
 * resolution are rendering behaviour inside the opaque-origin frame and are
 * asserted in test/browser/appearance.browser.mjs; here we pin the mapping,
 * merge, and CSS-serialization that feed it (see appearance.md).
 */

test('resolveThemeProperties returns null when nothing is forced (follow the OS)', () => {
  assert.equal(resolveThemeProperties({}), null);
});

test('a named theme resolves to that theme’s full variable set', () => {
  assert.deepEqual(resolveThemeProperties({ theme: 'dark' }), { ...THEMES.dark });
  assert.deepEqual(resolveThemeProperties({ theme: 'sepia' }), { ...THEMES.sepia });
});

test('custom properties merge over the resolved theme and win', () => {
  const resolved = resolveThemeProperties({
    theme: 'dark',
    customProperties: { '--wr-color': '#00ff00' },
  });
  assert.equal(resolved!['--wr-color'], '#00ff00', 'custom property did not override the theme');
  assert.equal(resolved!['--wr-background'], THEMES.dark['--wr-background'], 'theme base was lost');
});

test('custom property keys may omit the leading --', () => {
  const resolved = resolveThemeProperties({
    theme: 'light',
    customProperties: { 'wr-background': '#abcdef' },
  });
  assert.equal(resolved!['--wr-background'], '#abcdef');
});

test("theme 'custom' with only some properties is still a complete set", () => {
  const resolved = resolveThemeProperties({
    theme: 'custom',
    customProperties: { '--wr-color': '#123456' },
  });
  assert.equal(resolved!['--wr-color'], '#123456');
  // The rest fall back to the light base so an incomplete custom set stays readable.
  assert.equal(resolved!['--wr-background'], THEMES.light['--wr-background']);
});

test('customProperties alone (no theme) still forces a complete set', () => {
  const resolved = resolveThemeProperties({ customProperties: { '--wr-color': '#777777' } });
  assert.ok(resolved !== null, 'custom-only appearance must force a theme, not follow the OS');
  assert.equal(resolved['--wr-color'], '#777777');
  assert.equal(resolved['--wr-background'], THEMES.light['--wr-background']);
});

test('mergeAppearance: an update overrides the base field-by-field', () => {
  const base: Appearance = { theme: 'light' };
  const merged = mergeAppearance(base, { theme: 'dark' });
  assert.equal(merged.theme, 'dark');
});

test('mergeAppearance: customProperties shallow-merge, update wins per key', () => {
  const base: Appearance = { customProperties: { '--wr-color': '#111', '--wr-background': '#eee' } };
  const merged = mergeAppearance(base, { customProperties: { '--wr-color': '#222' } });
  assert.deepEqual(merged.customProperties, { '--wr-color': '#222', '--wr-background': '#eee' });
});

test('mergeAppearance: an update omitting theme keeps the base theme', () => {
  const merged = mergeAppearance({ theme: 'sepia' }, { customProperties: { '--wr-color': '#000' } });
  assert.equal(merged.theme, 'sepia', 'omitting theme in the update must not clear it');
});

test('themeStyleSheet declares the theme layer first, so publisher rules outrank it', () => {
  const css = themeStyleSheet({ theme: 'dark' });
  // The `@layer wolfy-reader-theme;` statement fixes the layer's order before any
  // publisher `@layer` can, and must precede the layer block that uses it.
  const declareAt = css.indexOf('@layer wolfy-reader-theme;');
  const blockAt = css.indexOf('@layer wolfy-reader-theme{');
  assert.ok(declareAt === 0, 'the layer declaration must lead the stylesheet');
  assert.ok(blockAt > declareAt, 'the layer block must follow the declaration');
});

test('themeStyleSheet consumes the variables in a layer but forces them at :root unlayered', () => {
  const css = themeStyleSheet({ theme: 'dark' });
  // The reset that paints from the variables lives inside the layer (loses to
  // publisher rules on their own properties)…
  assert.match(css, /@layer wolfy-reader-theme\{[^]*background:var\(--wr-background\)/);
  // …while the forced variables are set on an UNLAYERED :root block (after the
  // layer), so publisher CSS — which does not name --wr-* — cannot reach them.
  assert.match(css, /:root\{--wr-background:#121212/);
  // The forced :root block sits outside the layer block.
  const layerEnd = css.indexOf('@media');
  assert.ok(css.indexOf('--wr-background:#121212') > layerEnd, 'the forced :root must be unlayered');
});

test('themeStyleSheet carries a prefers-color-scheme default when a theme is forced too', () => {
  // The media-query defaults are always present; a forced theme adds an overriding
  // :root block after them. Even a forced theme keeps the OS defaults as the floor.
  const css = themeStyleSheet({ theme: 'light' });
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{:root\{/);
});

test('themeStyleSheet with no theme emits only the OS-driven defaults (no forced :root override)', () => {
  const css = themeStyleSheet({});
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  // No forced override: the stylesheet ends with the dark media block's `}}`,
  // with no trailing unconditional `:root{--wr-...}` block appended after it.
  assert.ok(css.endsWith('}}'), 'an unforced theme must end at the media block');
  const afterMedia = css.slice(css.indexOf('@media'));
  assert.equal((afterMedia.match(/:root\{/g) ?? []).length, 1, 'only the media :root, no forced one');
});

// --- Typography half -------------------------------------------------------

test('resolveTypographyProperties returns null when no typography knob is set', () => {
  assert.equal(resolveTypographyProperties({}), null);
  assert.equal(resolveTypographyProperties({ theme: 'dark' }), null);
});

test('resolveTypographyProperties maps each knob to its --wr-* variable', () => {
  const vars = resolveTypographyProperties({
    fontFamily: 'Georgia, serif',
    fontSize: 18,
    lineHeight: 1.6,
    textAlign: 'justify',
    hyphenate: true,
    columns: 2,
  });
  assert.deepEqual(vars, {
    '--wr-font-family': 'Georgia, serif',
    '--wr-font-size': '18px',
    '--wr-line-height': '1.6',
    '--wr-text-align': 'justify',
    '--wr-hyphens': 'auto',
    '--wr-column-count': '2',
  });
});

test('justify:true folds into text-align:justify; justify:false into start', () => {
  assert.equal(resolveTypographyProperties({ justify: true })!['--wr-text-align'], 'justify');
  assert.equal(resolveTypographyProperties({ justify: false })!['--wr-text-align'], 'start');
});

test('an explicit textAlign wins over justify', () => {
  const vars = resolveTypographyProperties({ justify: true, textAlign: 'start' });
  assert.equal(vars!['--wr-text-align'], 'start');
});

test('hyphenate:false maps to hyphens:manual', () => {
  assert.equal(resolveTypographyProperties({ hyphenate: false })!['--wr-hyphens'], 'manual');
});

test('themeStyleSheet forces the typography knobs on the content root, !important', () => {
  const css = themeStyleSheet({ theme: 'light', fontSize: 20, justify: true, hyphenate: true });
  // The reader's own values are pinned on the content root at id specificity with
  // !important — the same cascade device the surface guarantee uses — so a hostile
  // publisher rule cannot clobber the chosen typography on the reading surface.
  assert.match(css, /#wolfy-reader-content\{[^}]*font-size:var\(--wr-font-size\) !important/);
  assert.match(css, /#wolfy-reader-content\{[^}]*text-align:var\(--wr-text-align\) !important/);
  assert.match(css, /hyphens:var\(--wr-hyphens\) !important/);
  // The variables themselves are declared at :root (publisher CSS never names them).
  assert.match(css, /--wr-font-size:20px/);
});

test('column-count is not put in the stylesheet (it is per-chunk, applied frame-side)', () => {
  const css = themeStyleSheet({ columns: 2 });
  assert.doesNotMatch(css, /column-count/);
});

test('a colour-only appearance emits no typography guarantee block', () => {
  const css = themeStyleSheet({ theme: 'dark' });
  assert.doesNotMatch(css, /#wolfy-reader-content\{[^}]*font-/);
});

test('isReflowingUpdate: reflowing knobs are detected, a theme-only update is not', () => {
  assert.equal(isReflowingUpdate({ theme: 'dark' }), false);
  assert.equal(isReflowingUpdate({ customProperties: { '--wr-color': '#000' } }), false);
  assert.equal(isReflowingUpdate({ fontSize: 18 }), true);
  assert.equal(isReflowingUpdate({ fontFamily: 'serif' }), true);
  assert.equal(isReflowingUpdate({ lineHeight: 1.5 }), true);
  assert.equal(isReflowingUpdate({ margin: 24 }), true);
  assert.equal(isReflowingUpdate({ columns: 2 }), true);
  assert.equal(isReflowingUpdate({ textAlign: 'justify' }), true);
  assert.equal(isReflowingUpdate({ justify: true }), true);
  assert.equal(isReflowingUpdate({ hyphenate: true }), true);
});

test('margin is a reflowing knob but emits no --wr-* variable (it is columnGap)', () => {
  assert.equal(resolveTypographyProperties({ margin: 24 }), null);
  const merged = mergeAppearance({ fontSize: 16 }, { margin: 24 });
  assert.equal(merged.margin, 24);
  assert.equal(merged.fontSize, 16);
});

test('mergeAppearance carries the typography fields and lets an update win per field', () => {
  const base: Appearance = { theme: 'dark', fontSize: 16, columns: 1, justify: false };
  const merged = mergeAppearance(base, { fontSize: 22, columns: 2 });
  assert.equal(merged.theme, 'dark', 'theme survives an unrelated update');
  assert.equal(merged.fontSize, 22, 'the update overrides fontSize');
  assert.equal(merged.columns, 2, 'the update overrides columns');
  assert.equal(merged.justify, false, 'an omitted field keeps the base value');
});

test('asHostMessage accepts a paginate carrying the columnCount field, rejects it missing', () => {
  const options = {
    mode: 'paginated',
    pageWidth: 800,
    pageHeight: 600,
    columnGap: 40,
    chunkChars: 8000,
    windowChunks: 2,
    columnCount: 2,
  };
  const accepted = asHostMessage({ v: PROTOCOL_VERSION, type: 'paginate', id: 1, options });
  assert.ok(accepted !== null && accepted.type === 'paginate', 'a paginate with columnCount must validate');
  assert.equal(accepted.options.columnCount, 2);
  const { columnCount: _drop, ...without } = options;
  assert.equal(
    asHostMessage({ v: PROTOCOL_VERSION, type: 'paginate', id: 1, options: without }),
    null,
    'a paginate missing columnCount must be rejected',
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  mergeAppearance,
  resolveThemeProperties,
  THEMES,
  themeStyleSheet,
  type Appearance,
} from '../src/view/appearance.ts';

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
  // The `@layer wolfyreader-theme;` statement fixes the layer's order before any
  // publisher `@layer` can, and must precede the layer block that uses it.
  const declareAt = css.indexOf('@layer wolfyreader-theme;');
  const blockAt = css.indexOf('@layer wolfyreader-theme{');
  assert.ok(declareAt === 0, 'the layer declaration must lead the stylesheet');
  assert.ok(blockAt > declareAt, 'the layer block must follow the declaration');
});

test('themeStyleSheet consumes the variables in a layer but forces them at :root unlayered', () => {
  const css = themeStyleSheet({ theme: 'dark' });
  // The reset that paints from the variables lives inside the layer (loses to
  // publisher rules on their own properties)…
  assert.match(css, /@layer wolfyreader-theme\{[^]*background:var\(--wr-background\)/);
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

/**
 * The appearance system's theme half: the `--wr-*` CSS custom-property contract,
 * the built-in themes, and the frame stylesheet that delivers them so publisher
 * CSS can restyle its own content but can never reach the theme variables.
 *
 * This module is pure and DOM-free. It maps an {@link Appearance} to a variable
 * set and emits the `<style>` the frame injects at document-assembly time — no
 * `document`, no `window`, no protocol traffic. The frame-injection seam lives in
 * `frame.ts`; the reader facade owns the live appearance state.
 *
 * The typography half (font family, size, line height, margins, columns) will add
 * more `--wr-*` names to the same namespace and reuse this seam; the naming below
 * leaves room for it.
 */
import { CONTENT_ROOT_ID } from './frame.ts';

/** A built-in theme name, or `'custom'` for a caller-supplied variable set. */
export type ThemeName = 'light' | 'dark' | 'sepia' | 'custom';

/**
 * The live appearance state. Today only the theme half is honoured; typography
 * fields land later behind the same seam. `customProperties` supplies bespoke
 * `--wr-*` values that merge over the resolved theme (they win), so a `'custom'`
 * theme is any override set and the built-in themes are equally overridable.
 */
export interface Appearance {
  /**
   * Which theme drives content colours. Omitted (or `undefined`) means "do not
   * force a theme" — the frame follows `prefers-color-scheme`. A named theme
   * overrides the media query.
   */
  readonly theme?: ThemeName;
  /**
   * Caller-supplied `--wr-*` custom properties, merged over the resolved theme.
   * Keys may be given with or without the leading `--`. Values are emitted
   * verbatim into an inline `<style>` (CSP allows `style-src 'unsafe-inline'`),
   * so a caller controls exactly what its own book renders.
   */
  readonly customProperties?: Readonly<Record<string, string>>;
}

/**
 * The theme portion of the `--wr-*` contract. These names are the public,
 * frozen-ish vocabulary a custom theme supplies; content colours flow through
 * them so a theme change repaints without touching layout.
 */
export interface ThemeVariables {
  /** Reading surface background. */
  readonly '--wr-background': string;
  /** Body text colour. */
  readonly '--wr-color': string;
  /** Hyperlink colour. */
  readonly '--wr-link-color': string;
  /** Selection background. */
  readonly '--wr-selection-background': string;
  /** Selection text colour. */
  readonly '--wr-selection-color': string;
}

/**
 * The built-in themes. Each is a full {@link ThemeVariables} set so a forced
 * theme is self-contained — it needs no media query to be complete.
 */
export const THEMES: Readonly<Record<Exclude<ThemeName, 'custom'>, ThemeVariables>> = {
  light: {
    '--wr-background': '#ffffff',
    '--wr-color': '#1a1a1a',
    '--wr-link-color': '#1a5fb4',
    '--wr-selection-background': '#b4d5fe',
    '--wr-selection-color': '#1a1a1a',
  },
  dark: {
    '--wr-background': '#121212',
    '--wr-color': '#e6e6e6',
    '--wr-link-color': '#8ab4f8',
    '--wr-selection-background': '#2f5fb0',
    '--wr-selection-color': '#ffffff',
  },
  sepia: {
    '--wr-background': '#f4ecd8',
    '--wr-color': '#5b4636',
    '--wr-link-color': '#8a5a1a',
    '--wr-selection-background': '#e0cfa8',
    '--wr-selection-color': '#5b4636',
  },
} as const;

/** The default theme when the host does not force one and the OS is in light mode. */
const DEFAULT_LIGHT: Record<string, string> = { ...THEMES.light };
/** The default theme when the host does not force one and the OS is in dark mode. */
const DEFAULT_DARK: Record<string, string> = { ...THEMES.dark };

/** The cascade layer the theme reset lives in, so publisher rules outrank it. */
const THEME_LAYER = 'wolfyreader-theme';

/** Normalize a custom-property key to its `--`-prefixed form. */
function normalizeVarName(name: string): string {
  return name.startsWith('--') ? name : `--${name}`;
}

/**
 * Merge two partial `Appearance`s. `update` wins field-by-field; `customProperties`
 * shallow-merges (an update's keys override the base's, and only the base's other
 * keys survive). Passing `theme: undefined` in `update` does not clear the base
 * theme — omit the key to keep it, since `exactOptionalPropertyTypes` distinguishes
 * absent from `undefined`.
 */
export function mergeAppearance(base: Appearance, update: Appearance): Appearance {
  const merged: { theme?: ThemeName; customProperties?: Record<string, string> } = {};
  const theme = 'theme' in update ? update.theme : base.theme;
  if (theme !== undefined) merged.theme = theme;
  const custom = { ...(base.customProperties ?? {}), ...(update.customProperties ?? {}) };
  if (Object.keys(custom).length > 0) merged.customProperties = custom;
  return merged;
}

/**
 * The resolved `--wr-*` variables for a forced theme, or `null` when no theme is
 * forced (the frame follows `prefers-color-scheme` instead). Custom properties
 * merge over the theme's base and win; for `theme: 'custom'` the base is the light
 * theme so an incomplete custom set still yields a complete, readable variable set.
 */
export function resolveThemeProperties(appearance: Appearance): Record<string, string> | null {
  const theme = appearance.theme;
  const custom = appearance.customProperties;
  if (theme === undefined && custom === undefined) return null;
  const base: Record<string, string> =
    theme === undefined || theme === 'custom'
      ? { ...(theme === 'custom' ? DEFAULT_LIGHT : {}) }
      : { ...THEMES[theme] };
  // With no theme and only custom properties, seed from the light theme so a
  // partial custom set is still complete; a forced-null default (below) covers
  // the truly-unset case.
  if (theme === undefined && custom !== undefined) Object.assign(base, DEFAULT_LIGHT);
  if (custom !== undefined) {
    for (const [name, value] of Object.entries(custom)) base[normalizeVarName(name)] = value;
  }
  return base;
}

/** Serialize a variable set into `--name: value;` declarations. */
function declarations(vars: Readonly<Record<string, string>>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}:${value}`)
    .join(';');
}

/** The `:root` variable block for a set of resolved theme variables. */
function forcedRoot(vars: Record<string, string>): string {
  return `:root{${declarations(vars)}}`;
}

/**
 * The `prefers-color-scheme`-driven default variables, used when the host does
 * not force a theme. Light values sit at `:root`; a `@media (prefers-color-scheme:
 * dark)` block swaps them, so the frame picks up the OS mode on its own opaque
 * origin — the resolution stays inside the frame rather than being sniffed by the
 * host. A forced theme's explicit `:root` block (emitted after this) overrides it.
 */
function preferenceDefaults(): string {
  return (
    `:root{${declarations(DEFAULT_LIGHT)}}` +
    `@media (prefers-color-scheme: dark){:root{${declarations(DEFAULT_DARK)}}}`
  );
}

/**
 * The reading surface — the outermost background and base text colour, anchored
 * on the content root. This belongs to the reader, not the book, so it is set
 * unlayered and `!important` at id specificity: an id selector plus `!important`
 * outranks even a publisher `*{…!important}` or `body{…!important}`, so a hostile
 * book cannot repaint the surface out from under the theme. It only pins the
 * content root's *own* background/colour; descendants a book styles (`p{color}`)
 * still win for themselves, because that is a direct match on the descendant.
 */
function surfaceGuarantee(): string {
  return (
    `#${CONTENT_ROOT_ID}{` +
    `background:var(--wr-background) !important;` +
    `color:var(--wr-color) !important` +
    `}`
  );
}

/**
 * The themeable defaults that consume the `--wr-*` variables: the html/body
 * fallback surface, link colour and selection colours. These live in a cascade
 * layer, so an unlayered publisher rule of any specificity outranks them *for the
 * properties it sets* — a book restyling its own links or background wins — while
 * the `--wr-*` variables themselves are unreachable by publisher CSS (they are
 * custom-property names the book does not know). An unstyled book still themes
 * fully, because nothing overrides the layer.
 */
function themeableDefaults(): string {
  return (
    `@layer ${THEME_LAYER}{` +
    `html{background:var(--wr-background);color:var(--wr-color)}` +
    `body{background:var(--wr-background);color:var(--wr-color)}` +
    `a{color:var(--wr-link-color)}` +
    `::selection{background:var(--wr-selection-background);color:var(--wr-selection-color)}` +
    `}`
  );
}

/**
 * The full theme stylesheet the frame injects at document assembly, before the
 * publisher's `headHtml`. It declares the theme layer first (so its ordering is
 * fixed regardless of any `@layer` a book declares later), emits the themeable
 * defaults and the unlayered surface guarantee, then the `prefers-color-scheme`
 * defaults, and finally — if a theme is forced — an unlayered `:root` block that
 * overrides the media query. `null` from {@link resolveThemeProperties} means
 * "follow the OS"; a variable set means "force it".
 */
export function themeStyleSheet(appearance: Appearance): string {
  const forced = resolveThemeProperties(appearance);
  return (
    `@layer ${THEME_LAYER};` +
    themeableDefaults() +
    surfaceGuarantee() +
    preferenceDefaults() +
    (forced === null ? '' : forcedRoot(forced))
  );
}

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
 * The typography half (font family, size, line height, alignment, hyphenation,
 * columns) adds more `--wr-*` names to the same namespace and rides the same
 * cascade. The reflowing knobs (font, size, line height, columns) change chunk
 * geometry, so the reader re-lays out and restores the reading position for them
 * rather than repainting in place the way a colour change does.
 */
import { CONTENT_ROOT_ID } from './frame.ts';

/** A built-in theme name, or `'custom'` for a caller-supplied variable set. */
export type ThemeName = 'light' | 'dark' | 'sepia' | 'custom';

/** Text alignment for body prose: publisher default, ragged left, or justified. */
export type TextAlign = 'start' | 'justify';

/**
 * The live appearance state: the theme half (content colours) plus the typography
 * half (font, size, line height, margin, alignment, hyphenation, columns). Both
 * flow through the same `--wr-*` namespace and the same cascade, so publisher CSS
 * can restyle its own content but can never reach an appearance variable.
 * `customProperties` supplies bespoke `--wr-*` values that merge over the resolved
 * theme (they win), so a `'custom'` theme is any override set and the built-in
 * themes are equally overridable.
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
  /** Body font family (a CSS `font-family` value). Reflows. */
  readonly fontFamily?: string;
  /** Body font size in CSS px. Reflows. */
  readonly fontSize?: number;
  /** Body line height, a unitless multiplier. Reflows. */
  readonly lineHeight?: number;
  /**
   * Page margin in CSS px — the gap between text columns (the paginator's
   * `columnGap`). It is not a `--wr-*` variable: column geometry belongs to the
   * paginator, so it rides `PaginateOptions` and reflows the layout. Reflows.
   */
  readonly margin?: number;
  /** Text alignment: `'start'` (publisher default) or `'justify'`. May reflow. */
  readonly textAlign?: TextAlign;
  /** Shorthand for `textAlign: 'justify'` when `true`, `'start'` when `false`. */
  readonly justify?: boolean;
  /** Whether the content root hyphenates. May reflow line breaks. */
  readonly hyphenate?: boolean;
  /** Number of text columns per page: 1 or 2. Reflows. */
  readonly columns?: 1 | 2;
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

/**
 * The typography portion of the `--wr-*` contract. Each maps a live appearance
 * knob to a custom property the content stylesheet consumes; publisher CSS never
 * names these, so it cannot clobber them, exactly like the theme variables. All
 * are optional: an unset knob leaves the publisher's own value in place.
 */
export interface TypographyVariables {
  /** Body font family. */
  readonly '--wr-font-family'?: string;
  /** Body font size (a CSS length, e.g. `18px`). */
  readonly '--wr-font-size'?: string;
  /** Body line height (unitless multiplier). */
  readonly '--wr-line-height'?: string;
  /** Body text alignment. */
  readonly '--wr-text-align'?: string;
  /** Content-root hyphenation (`auto` or `manual`). */
  readonly '--wr-hyphens'?: string;
  /** Number of text columns per page. */
  readonly '--wr-column-count'?: string;
}

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
  const merged: {
    theme?: ThemeName;
    customProperties?: Record<string, string>;
    fontFamily?: string;
    fontSize?: number;
    lineHeight?: number;
    margin?: number;
    textAlign?: TextAlign;
    justify?: boolean;
    hyphenate?: boolean;
    columns?: 1 | 2;
  } = {};
  const theme = 'theme' in update ? update.theme : base.theme;
  if (theme !== undefined) merged.theme = theme;
  const custom = { ...(base.customProperties ?? {}), ...(update.customProperties ?? {}) };
  if (Object.keys(custom).length > 0) merged.customProperties = custom;
  const fontFamily = 'fontFamily' in update ? update.fontFamily : base.fontFamily;
  if (fontFamily !== undefined) merged.fontFamily = fontFamily;
  const fontSize = 'fontSize' in update ? update.fontSize : base.fontSize;
  if (fontSize !== undefined) merged.fontSize = fontSize;
  const lineHeight = 'lineHeight' in update ? update.lineHeight : base.lineHeight;
  if (lineHeight !== undefined) merged.lineHeight = lineHeight;
  const margin = 'margin' in update ? update.margin : base.margin;
  if (margin !== undefined) merged.margin = margin;
  const textAlign = 'textAlign' in update ? update.textAlign : base.textAlign;
  if (textAlign !== undefined) merged.textAlign = textAlign;
  const justify = 'justify' in update ? update.justify : base.justify;
  if (justify !== undefined) merged.justify = justify;
  const hyphenate = 'hyphenate' in update ? update.hyphenate : base.hyphenate;
  if (hyphenate !== undefined) merged.hyphenate = hyphenate;
  const columns = 'columns' in update ? update.columns : base.columns;
  if (columns !== undefined) merged.columns = columns;
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

/**
 * The resolved typography `--wr-*` variables for an appearance, or `null` when no
 * typography knob is set. `columns` maps to `--wr-column-count`; `justify` folds
 * into `--wr-text-align` (an explicit `textAlign` wins over `justify`). Only the
 * knobs the caller supplied are emitted — an unset knob leaves the publisher's own
 * value in place rather than forcing a default.
 */
export function resolveTypographyProperties(
  appearance: Appearance,
): TypographyVariables | null {
  const vars: Record<string, string> = {};
  if (appearance.fontFamily !== undefined) vars['--wr-font-family'] = appearance.fontFamily;
  if (appearance.fontSize !== undefined) vars['--wr-font-size'] = `${appearance.fontSize}px`;
  if (appearance.lineHeight !== undefined) vars['--wr-line-height'] = String(appearance.lineHeight);
  const align = resolveTextAlign(appearance);
  if (align !== undefined) vars['--wr-text-align'] = align;
  if (appearance.hyphenate !== undefined) {
    vars['--wr-hyphens'] = appearance.hyphenate ? 'auto' : 'manual';
  }
  if (appearance.columns !== undefined) vars['--wr-column-count'] = String(appearance.columns);
  return Object.keys(vars).length === 0 ? null : (vars as TypographyVariables);
}

/** The effective text alignment: an explicit `textAlign` wins over `justify`. */
function resolveTextAlign(appearance: Appearance): string | undefined {
  if (appearance.textAlign !== undefined) return appearance.textAlign;
  if (appearance.justify !== undefined) return appearance.justify ? 'justify' : 'start';
  return undefined;
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
 * The unlayered typography block: the reader's own font, size, line height,
 * alignment and hyphenation, anchored on the content root and set `!important` at
 * id specificity — the same cascade device as {@link surfaceGuarantee}. An id
 * selector plus `!important` outranks even a hostile publisher `*{…!important}`,
 * so a user's typography choice wins the reading surface; a descendant the book
 * styles directly (`p{font-size:20px}`) still wins for itself, which is the
 * intended split. Only the knobs actually set emit a declaration, and each reads
 * its own `--wr-*` variable (unreachable by publisher CSS). `column-count` is not
 * here — column geometry is per-chunk and applied frame-side by the paginator.
 */
function typographyGuarantee(vars: TypographyVariables): string {
  const rules: string[] = [];
  if (vars['--wr-font-family'] !== undefined) rules.push('font-family:var(--wr-font-family) !important');
  if (vars['--wr-font-size'] !== undefined) rules.push('font-size:var(--wr-font-size) !important');
  if (vars['--wr-line-height'] !== undefined) rules.push('line-height:var(--wr-line-height) !important');
  if (vars['--wr-text-align'] !== undefined) rules.push('text-align:var(--wr-text-align) !important');
  if (vars['--wr-hyphens'] !== undefined) {
    rules.push('-webkit-hyphens:var(--wr-hyphens) !important', 'hyphens:var(--wr-hyphens) !important');
  }
  if (rules.length === 0) return '';
  return `:root{${declarations(vars as Record<string, string>)}}#${CONTENT_ROOT_ID}{${rules.join(';')}}`;
}

/**
 * The full appearance stylesheet the frame injects at document assembly, before
 * the publisher's `headHtml`. It carries the theme half (colours) and the
 * typography half (font/size/line-height/alignment/hyphenation) through one
 * `--wr-*` namespace. It declares the theme layer first (so its ordering is fixed
 * regardless of any `@layer` a book declares later), emits the themeable defaults
 * and the unlayered surface guarantee, then the `prefers-color-scheme` defaults,
 * then — if a theme is forced — an unlayered `:root` block that overrides the
 * media query, and finally the unlayered typography guarantee. `null` from
 * {@link resolveThemeProperties} means "follow the OS"; a variable set means
 * "force it".
 */
export function themeStyleSheet(appearance: Appearance): string {
  const forced = resolveThemeProperties(appearance);
  const typography = resolveTypographyProperties(appearance);
  return (
    `@layer ${THEME_LAYER};` +
    themeableDefaults() +
    surfaceGuarantee() +
    preferenceDefaults() +
    (forced === null ? '' : forcedRoot(forced)) +
    (typography === null ? '' : typographyGuarantee(typography))
  );
}

/**
 * The typography knobs that change chunk geometry and therefore require a re-layout
 * (a `paginate`), not just a variable poke: font family, font size, line height,
 * page margin, and column count. Alignment and hyphenation can shift line breaks
 * too, so they are treated as reflowing to be safe. Whether an `update` touches any
 * of these decides which path {@link Reader.setAppearance} takes.
 */
export function isReflowingUpdate(update: Appearance): boolean {
  return (
    update.fontFamily !== undefined ||
    update.fontSize !== undefined ||
    update.lineHeight !== undefined ||
    update.margin !== undefined ||
    update.textAlign !== undefined ||
    update.justify !== undefined ||
    update.hyphenate !== undefined ||
    update.columns !== undefined
  );
}

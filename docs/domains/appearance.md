# Appearance domain

## Overview

Live appearance controls for book content: switchable themes delivered as CSS
custom properties injected into the sandboxed content frame, where publisher CSS
can restyle its own content but can never reach a theme variable. The theme half
is implemented; the typography half (font family, size, line height, margins,
columns) will extend the same seam and share the same `--wr-*` namespace.

Code:

- `src/view/appearance.ts` — the pure, DOM-free core: the `Appearance` type, the
  built-in `THEMES`, the `--wr-*` contract (`ThemeVariables`), appearance-state
  merge (`mergeAppearance`), variable resolution (`resolveThemeProperties`), and
  the frame stylesheet the theme injects (`themeStyleSheet`). No `document`, no
  `window`, no protocol traffic.
- `src/view/frame.ts` — `assembleFrameDocument` injects the theme `<style>` after
  the minimal reset and before the publisher's `headHtml`.
- `src/view/host.ts` — `ContentHost` carries the theme stylesheet
  (`ContentHostOptions.themeCss` / `setThemeCss`) and applies it at every document
  assembly.
- `src/layout/index.ts` — `Paginator.setThemeCss` swaps the theme on the current
  section, preserving the reading position.
- `src/reader/index.ts` — the public surface: `ReaderOptions.theme` /
  `customProperties`, the `Appearance` type, and `Reader.setAppearance`.

## Key decisions

- **Cascade strategy — a split between an authoritative reading surface and
  themeable defaults, so publisher CSS cannot clobber the theme.** Content colours
  flow through `--wr-*` custom properties, and the stylesheet that consumes them is
  built in two parts:
  - **The reading surface** (`#wolfyreader-content` background + base colour) is set
    *unlayered* and `!important` at id specificity. An id selector plus `!important`
    outranks even a hostile publisher `*{…!important}` or `body{…!important}`, so a
    book cannot repaint the surface out from under the active theme. It pins only
    the content root's *own* background/colour — a descendant the book styles
    (`p{color:red}`) still wins for itself, because that is a direct match on the
    descendant.
  - **The themeable defaults** (html/body fallback surface, link colour, selection
    colours) live in a low cascade layer, `@layer wolfyreader-theme`. An unlayered
    publisher rule of any specificity outranks the layer *for the properties it
    sets*, so a book restyling its own links or background wins there — while the
    `--wr-*` variables themselves are unreachable by publisher CSS, because they are
    custom-property names the book does not know.

  The layer is *declared* first (`@layer wolfyreader-theme;` leads the sheet) so its
  order is fixed before any `@layer` a book declares later. An unstyled book themes
  fully because nothing overrides the layer; the hostile-CSS browser fixture is the
  proof that a publisher `body/*{color;background !important}` cannot win the
  reading surface.

- **The `--wr-*` variable contract is the public theme vocabulary.** A custom theme
  supplies these names; the typography half will add more to the same namespace.
  The theme names are: `--wr-background`, `--wr-color`, `--wr-link-color`,
  `--wr-selection-background`, `--wr-selection-color`. Custom-property keys may be
  given with or without the leading `--`. Values are emitted verbatim into an inline
  `<style>` (the CSP already allows `style-src 'unsafe-inline' data:`).

- **`prefers-color-scheme` resolution stays inside the frame.** When the host does
  not force a theme, the injected sheet emits the light variables at `:root` plus a
  `@media (prefers-color-scheme: dark)` block that swaps them — so the frame picks
  up the OS mode on its own opaque origin, rather than the host sniffing the media
  query and passing a resolved theme in. A forced theme emits an unlayered `:root`
  block *after* the media block, so it overrides the preference. `themeStyleSheet`
  therefore always carries the OS-driven defaults as the floor; a forced theme adds
  the override on top.

- **A custom theme is any override set; the built-in themes are equally
  overridable.** `customProperties` merges over the resolved theme and wins.
  `theme: 'custom'` seeds from the light theme so an incomplete custom set is still
  a complete, readable variable set; `customProperties` with no `theme` also forces
  a complete set (seeded from light) rather than following the OS.

- **No protocol bump, no CSP change.** The theme is injected at document assembly
  inside the `srcdoc` — not over the `postMessage` wire — so it changes no protocol
  version. The CSP already emits `style-src 'unsafe-inline' data:`, which permits
  the injected `<style>` and the inline `var(--wr-*)` values. The sandbox
  three-defence rule is untouched. See [`view.md`](view.md).

## Implementation notes

- **A colour change preserves the reading place with no text reflow.** A theme is
  colours + background only, so chunk geometry is invariant under it. The theme
  lives in the `srcdoc`, so `Paginator.setThemeCss` re-assembles the document rather
  than issuing a fresh layout request, but it brackets the swap with a `Position`
  capture and resolve: it captures the current page's `Position`, re-assembles with
  the new theme, and seeks back to the page that `Position` now resolves to. Because
  geometry is invariant the *exact* page is restored — not reset to 0, not drifted —
  and the text does not reflow. An unchanged stylesheet short-circuits, so
  re-issuing the same appearance is free.

- **Live state lives in the reader, in memory only.** The library never persists;
  the host owns storage. `ReaderImpl` holds the live `Appearance`, seeds it from
  `ReaderOptions.theme`/`customProperties` at construction (applied at the first
  render, not merely retained), and merges partial updates through
  `mergeAppearance`. `setAppearance` routes through the *same serialized navigation
  queue* as `setMode`, so a theme change interleaves in issue order with navigation
  and never races a render. It emits `positionchange` after settling (parity with
  `setMode`) so a host can refresh anything keyed on the settled state.

- **The seam is shaped for the typography half.** `setAppearance` takes a partial
  `Appearance`; adding font/size/line-height/margin fields there and more `--wr-*`
  names to `themeStyleSheet` extends this without a new method. Typography that
  reflows will differ in one way the theme half does not: it changes chunk geometry,
  so it cannot claim the geometry-invariant, no-reflow guarantee above and must
  re-measure.

## Gotchas

- **A theme change re-assembles the `srcdoc` and re-handshakes the frame.** It is
  not a cheap in-place variable poke — the theme is part of the assembled document,
  and there is no wire message to mutate `:root` after the fact (adding one would
  bump the protocol, which theme injection deliberately avoids). It is made to
  *feel* free by being geometry-invariant and position-preserving, not by skipping
  the re-render.

- **Passing `theme: undefined` in an update clears a forced theme back to
  follow-the-OS; omitting the key keeps the current theme.** `mergeAppearance` and
  the reader options rely on `exactOptionalPropertyTypes` to tell an absent key from
  an explicit `undefined`. The demo's "Follow OS" picker option sends
  `{ theme: undefined }` on purpose.

- **The surface guarantee only pins the content root's own colour.** Do not expect
  it to force every descendant — that would strip books of their own typography
  colours. Books keep their per-element colours; only the outermost reading surface
  is the reader's to own.

## Patterns

- **Pure mapping/serialization headless, rendering behaviour in the browser.** The
  appearance-state merge, `--wr-*` resolution, and stylesheet-shape assertions are
  headless `node:test` (`test/appearance.test.ts`); the cascade fight with publisher
  CSS, per-theme computed styles, and `prefers-color-scheme` — all of which need the
  real layout engine inside the opaque-origin frame — are Playwright
  (`test/browser/appearance.browser.mjs`). This mirrors the layout domain's split.

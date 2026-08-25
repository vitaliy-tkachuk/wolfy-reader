# Appearance domain

## Overview

Live appearance controls for book content: switchable themes plus typography —
font family, size, line height, page margin, text alignment, justification,
hyphenation, and 1-or-2 columns — delivered as CSS custom properties injected into
the sandboxed content frame, where publisher CSS can restyle its own content but
can never reach an appearance variable. Both halves share one `--wr-*` namespace,
one cascade strategy, and one `setAppearance` seam. They differ in one way: a
theme change is colours only and geometry-invariant (repaint in place), while a
reflowing typography knob changes chunk geometry and re-lays out, preserving the
reading place by content anchor rather than by exact page.

Code:

- `src/view/appearance.ts` — the pure, DOM-free core: the `Appearance` type, the
  built-in `THEMES`, the `--wr-*` contract (`ThemeVariables` + `TypographyVariables`),
  appearance-state merge (`mergeAppearance`), variable resolution
  (`resolveThemeProperties`, `resolveTypographyProperties`), reflow-path routing
  (`isReflowingUpdate`), and the frame stylesheet both halves inject
  (`themeStyleSheet`). No `document`, no `window`, no protocol traffic.
- `src/view/frame.ts` — `assembleFrameDocument` injects the theme `<style>` after
  the minimal reset and before the publisher's `headHtml`.
- `src/view/host.ts` — `ContentHost` carries the theme stylesheet
  (`ContentHostOptions.themeCss` / `setThemeCss`) and applies it at every document
  assembly.
- `src/layout/index.ts` — `Paginator.setThemeCss` swaps a colour theme on the
  current section (geometry invariant); `Paginator.applyAppearance` re-lays out for a
  reflowing typography knob and restores the reading place. Both share `#reapply` and
  thread `PaginateOptions.columnCount`/`columnGap`.
- `src/reader/index.ts` — the public surface: `ReaderOptions.theme` /
  `customProperties` / typography fields, the `Appearance` type, and
  `Reader.setAppearance` (routed through the same serialized navigation queue as
  `setMode`).

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

- **The `--wr-*` variable contract is the public appearance vocabulary.** A custom
  theme supplies these names; typography adds more to the same namespace. The theme
  names are `--wr-background`, `--wr-color`, `--wr-link-color`,
  `--wr-selection-background`, `--wr-selection-color`; the typography names are
  `--wr-font-family`, `--wr-font-size`, `--wr-line-height`, `--wr-text-align`,
  `--wr-hyphens`, `--wr-column-count`. Custom-property keys may be given with or
  without the leading `--`. Values are emitted verbatim into an inline `<style>`
  (the CSP already allows `style-src 'unsafe-inline' data:`).

- **Typography rides the same cascade device as the surface guarantee.** The
  reader's own font/size/line-height/alignment/hyphenation are pinned on
  `#wolfyreader-content` *unlayered and `!important`* at id specificity — an id
  selector plus `!important` outranks even a hostile publisher `*{…!important}`, so
  the chosen typography wins the reading surface. As with colours, it pins only the
  content root's *own* values; a descendant the book styles directly
  (`p{font-size:20px}`) still wins for itself, which is the intended split (a book
  keeps its own emphasis while the reader owns the base). Only the knobs the caller
  actually set emit a declaration — an unset knob leaves the publisher's value in
  place rather than forcing a default. The `--wr-*` variables the rules consume are
  names the book never knows, so it cannot clobber them, exactly like the theme
  variables.

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

- **No CSP change; one protocol field, for columns only.** The theme *and* the
  stylesheet-borne typography (font/size/line-height/alignment/hyphenation) are
  injected at document assembly inside the `srcdoc`, not over the `postMessage`
  wire, so they change no protocol version. The CSP already emits
  `style-src 'unsafe-inline' data:`, which permits the injected `<style>` and the
  inline `var(--wr-*)` values. **Column count is the exception**: column geometry
  belongs to the paginator (each chunk is its own multi-column context — see
  [`layout.md`](layout.md)), so `--wr-column-count` is *not* put in the stylesheet;
  it rides `PaginateOptions.columnCount` on the wire and is applied frame-side
  alongside `columnGap`. That field grew the protocol — the version bump is the
  paired hand-edit in `protocol.ts` + the frame's `coordinationScript` validator
  copy. The sandbox three-defence rule is untouched. See [`view.md`](view.md).

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

- **`setAppearance` carries both halves and picks its path by the update.**
  `setAppearance` takes a partial `Appearance` covering theme (`theme`,
  `customProperties`) and typography (`fontFamily`, `fontSize`, `lineHeight`,
  `margin`, `textAlign`, `justify`, `hyphenate`, `columns`). `isReflowingUpdate(update)`
  decides the path: a colour-only update takes `Paginator.setThemeCss` (geometry
  invariant, exact page restored); an update touching a reflowing knob takes
  `Paginator.applyAppearance`, which re-lays out and restores the *nearest* anchor
  page. Whether a knob reflows is decided by the *update*, not the merged state, so
  a lone theme change never pays for a re-layout even while typography is live.

### The reflow path — position preserved by content anchor

A reflowing typography knob (font family, font size, line height, page margin,
column count; alignment and hyphenation are treated as reflowing to be safe)
changes chunk geometry, so it cannot claim the theme half's geometry-invariant,
no-reflow guarantee — it must re-measure. `Paginator.applyAppearance(themeCss,
{ columnCount, columnGap })` reuses the exact machinery `switchMode` uses for a
paginated↔scrolled switch (`#reapply`, shared with `setThemeCss`): capture a
`Position` for the current page → set the stylesheet + geometry and re-`paginate`
→ resolve the `Position` against the new layout → seek back to the page it now
lands on. Because the `Position` is content-addressed (an exact quote + context,
not an offset), the reading *place* survives the reflow even though the page count
and page number shift — the visible anchor paragraph is on the page before and
after. A same-text resolution miss (rare) degrades to page 0.

- **`margin` and `columns` are paginator geometry, not `--wr-*` variables.** They
  do not emit a stylesheet variable (`resolveTypographyProperties` skips them);
  they thread through `PaginateOptions` (`columnGap`, `columnCount`) and are applied
  frame-side. `margin` is the reader's one spacing unit: it insets the text from
  **both page edges** *and* is the gutter between columns, so a page reads
  margin/col/margin/col/margin (2026-08-26 — it previously mapped to the inter-column
  gap alone, which was invisible in the default single-column layout, so the knob
  appeared to do nothing). Frame-side the chunk is positioned at `left: margin` with
  `width: pageWidth − 2·margin` (paginated) or given symmetric horizontal padding
  (scrolled); `column-gap` stays `margin` for the 2-column gutter. The stride and
  offset↔page mapping read live box positions, so the edge inset needs no term of
  its own — see [`docs/domains/view.md`](view.md). `columns` (1 or 2) splits each page
  into that many CSS columns, so a 2-column page paints twice the text before a
  turn. Everything else (font/size/line-height/alignment/hyphenation) is a `--wr-*`
  variable in the srcdoc stylesheet.
- **The reflow inherits the scrolled-mode caveat from `setMode`.** A `Position`
  captured at a mid-section page while scrolled resolves back to the section's first
  page (scrolled mode collapses paging), so a reflowing knob applied in scrolled
  mode inherits that drift. Exact mid-scroll capture is separate, out-of-scope work.
- **`ReaderOptions` typography is applied at the first render, not merely retained.**
  The seeded appearance drives the opening `paginate` (`columns`/`margin` via the
  request extras) and rides the opening srcdoc stylesheet (font/size/line-height/…),
  so a book opened with `{ fontSize: 20, columns: 2 }` paints that way on the first
  paint rather than snapping to defaults and reflowing after.
- **`prefers-reduced-motion` is a documented no-op for typography.** This unit adds
  no page-turn animation, so nothing here is gated on the preference; input always
  turns the page. The reader's only animation remains the image-zoom overlay's
  fade, which gates itself. When an animated page turn lands, gate *that* animation
  the same way — never the input.

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
  appearance-state merge, `--wr-*` theme + typography resolution, `isReflowingUpdate`
  routing, stylesheet-shape assertions, and the `PaginateOptions.columnCount`
  protocol round-trip are headless `node:test` (`test/appearance.test.ts`); the
  cascade fight with publisher CSS, per-theme and per-typography computed styles,
  `prefers-color-scheme`, `column-count`/`column-gap` geometry, reduced-motion, and
  the reflow that holds the reading place — all of which need the real layout engine
  inside the opaque-origin frame — are Playwright
  (`test/browser/appearance.browser.mjs`, one assertion per knob). This mirrors the
  layout domain's split.

## The position-preserving invariant (tested)

- **`setAppearance`/`setMode` are position-preserving by contract, and the contract
  is a tested invariant, not a hope.** `test/browser/appearance.browser.mjs` runs a
  parameterized suite: every reflowing knob (`fontSize`, `fontFamily`, `lineHeight`,
  `margin`, `columns`) **and** the paginated↔scrolled mode switch, across **two
  corpus books** (`gutenberg-frankenstein`, `gutenberg-moby-dick`) and **two starting
  positions** (section start and mid-section). Corpus-backed cases skip gracefully
  when the gitignored corpus is absent.
- **The stated tolerance is the paragraph at the TOP of the page.** The restore
  anchors on the page-*start* offset (`Paginator.positionOfPage` → frame
  `offsetOfPage(page)`), so the assertion is: the top-most substantial paragraph
  (≥ 120 chars, for unambiguous content resolution) visible *before* the change is
  still visible *after* it. It is deliberately **not** the longest paragraph on the
  page — a longest-anywhere paragraph can sit at the bottom and legitimately fall
  onto an adjacent page when the column count changes, even though the reading place
  (the top) is held. Anchoring the test on "longest" rather than "top-most" is the one
  bug that surfaced building this suite; `pageAnchor` returns the top-most.
- **The suite is falsifiable.** A deliberate-regression case captures a mid-section
  anchor, lands on page 0 (exactly where `#reapply` lands when the anchor fails to
  resolve — the restore did nothing), and asserts the invariant assertion *throws*
  there (`assert.throws(/tolerance violated/)`). Encoded as `assert.throws` so nothing
  is left permanently red, it proves the mechanism — not a vacuous assertion — is what
  holds the place.
- **Scrolled mode holds to section granularity only.** Paging collapses in scrolled
  mode, so a mid-section anchor resolves to the section's first page; the mode-switch
  cases assert the weaker, honest guarantee (the section is preserved and the anchor
  paragraph is still present in the rendered content), a documented drift, not a
  violation.
- The cross-cutting decision is recorded in
  [`docs/architecture.md`](../architecture.md) (2026-08-25); the anchor machinery it
  stands on is the [`position`](position.md) domain.

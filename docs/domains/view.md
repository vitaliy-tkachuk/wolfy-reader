# View domain

## Overview

`src/view` renders a decoded `Section` as live markup a human reads, inside a frame where book-supplied script cannot execute, cannot reach the host origin, and cannot reach the network. It is the only part of the library that touches `document`, and nothing in `src/core` may import it (`npm run check:core`).

Modules: `host.ts` (`ContentHost` — the public surface), `sanitize.ts` (parse + normalize + sanitize in one pass), `allowlist.ts` (the tables that decide what survives), `css.ts` (token-level `url()`/`@import` scan), `resources.ts` (reference → `data:` URL, and applying them to a sanitized document), `reference.ts` (reference classification and relative-space joining), `frame.ts` (CSP, reset stylesheet, coordination script, document assembly), `protocol.ts` (typed messages and their validators), `text.ts` (BOM-aware decoding).

The public surface is `ContentHost`: construct it over a container element, `render(section)` it, `measure()` the result, `destroy()` it. `render()` returns a structured report of what the sanitizer removed and what the resource layer served — the demo displays it, and it is what turns "the sanitizer ran" into something observable.

## Threat model — three defences, none redundant

EPUB content is arbitrary HTML, CSS, JS and SVG from an untrusted file. The frame needs `allow-scripts`, because the host's own coordination script runs inside it and there is no other way to get measurements back across an opaque origin. `allow-scripts` is granted to the **document**, not to a party: book script would run under exactly the same grant.

- **The sandbox denies reach.** `sandbox="allow-scripts"` with no `allow-same-origin` gives an opaque origin: no host DOM, no cookies (Chromium throws rather than returning empty), no `localStorage`, `iframe.contentDocument` is `null` from outside.
- **Sanitization denies execution.** Without it, book script runs *inside* the opaque origin and can still burn CPU, phish within the frame's own pixels, attempt navigation, and — the concrete reason this is not belt-and-braces — **impersonate the host's `postMessage` protocol**, because it shares the frame's message channel with the coordination script. A sandbox cannot tell the host's script from the book's; only stripping can.
- **CSP denies egress.** `default-src 'none'` with `connect-src 'none'` blocks fetch, XHR, WebSocket and beacon; `img-src data:` blocks the CSS-only exfiltration channel (`background: url(https://evil/?leak)`).

Each layer covers a failure of the others. Do not simplify one away because another looks sufficient.

## Key decisions

- **Resources are `data:` URLs, not `blob:`** (2026-08-24). The plan called for `blob:`, and it cannot work: a blob URL belongs to the origin that created it, and the frame's origin is opaque, so the frame is refused the host's blob URLs outright. Measured in Chromium: the load fails as *"Not allowed to load local resource"* — below CSP, with no `securitypolicyviolation` event to observe — with or without a CSP, while an unsandboxed control frame loads the same URL fine. A `data:` URL carries its own bytes and has no origin to check, so it crosses the boundary the sandbox deliberately makes uncrossable. Costs: base64's 33%, and no revocation handle. Both are bounded by one section, and reflowable text books (fixed layout is permanently out of scope) do not carry the image weight that would make it hurt.
  - **The escape hatch, if memory ever bites:** blob URLs minted *inside* the frame do work (measured — `blob:null/…`, loadable as images and stylesheets, matched by CSP's `blob:` source). That would mean shipping bytes over `postMessage` and substituting them in the frame after the handshake — a second document-assembly path in the least-trusted context, and placeholder references that fetch and raise bogus CSP violations before substitution. Not worth it until a real book makes it worth it.
- **Allowlist, never blocklist.** A blocklist loses to the next vector the platform invents; an allowlist only ever loses formatting. See the allowlist section below.
- **Sanitization is unconditional and never consults `Section.scripted`.** That flag is an author declaration, not a detection: a book carrying script without declaring the property has it omitted, so gating on it would skip exactly the files that most need sanitizing. Its one legitimate use is as a diagnostic the host reports outward (`RenderReport.declaredScripted`) so a cautious consumer can refuse the book. The rendering pipeline is byte-identical either way.
- **The document enters by `srcdoc`, with CSP in a `<meta http-equiv>`.** A library with no server cannot set headers, so the meta element is the only CSP mechanism available — which costs the three header-only directives (`frame-ancestors`, `sandbox`, `report-uri`) and requires the element to be the first thing in the document, since nothing before it is covered. A `blob:` **document** URL is the trap to avoid: a blob document inherits its creator's origin, and relying on the sandbox attribute to override that is fragile when `srcdoc` gets an opaque origin unconditionally. The `csp` iframe attribute is Chrome-only and fails the Safari/Firefox baseline.
- **`script-src` names a per-render nonce rather than `'unsafe-inline'`.** A script that somehow survived sanitization still cannot run: the nonce is 128 random bits, minted per render, and unreadable by anything not already executing. It also blocks `javascript:` URLs, which need `'unsafe-inline'` in `script-src`.
- **Only image, font and stylesheet media types are minted a URL.** A reference resolving is not evidence it should be served — the seam answers for the whole manifest, so a `text/javascript` entry resolves as readily as an image, and a URL is a capability rather than a convenience. `urlForResource` serves `image/*`, `font/*` and the legacy `application/*-font-*` spellings; `urlForStylesheet` serves `text/css` only. Anything else is reported as `refused` and never loaded.
- **A minimal reset and nothing more** (`box-sizing`, zeroed body margin, `max-width:100%` on replaced content). The host must **not** put the body in a column context: layout containment forbids a contained box fragmenting across columns, which is why the paginator gives each chunk its own multi-column context. Column geometry belongs to the paginator; themes and typography to the appearance controls.
- **Appearance reuses the document-assembly seam — no CSP change; one protocol field for columns.** `assembleFrameDocument` accepts an optional appearance `<style>` (`FrameDocumentParts.themeCss`), injected after the reset and before the publisher's `headHtml`; `ContentHost` carries it (`ContentHostOptions.themeCss` / `setThemeCss`). Theme colours *and* the stylesheet-borne typography (font/size/line-height/alignment/hyphenation) are CSS custom properties plus a cascade-layered / `!important`-surface reset that consumes them, so they ride entirely inside the `srcdoc`. The CSP already emits `style-src 'unsafe-inline' data:`, which permits the inline `<style>` and the `var(--wr-*)` values, so no CSP relaxation is needed. **Column count is the one exception**: column geometry is the paginator's (each chunk is its own multi-column context), so it is not a stylesheet variable — it rides `PaginateOptions.columnCount` on the wire and applies frame-side alongside `columnGap`. That field is what took the protocol to v8. Mechanism and the cascade strategy live in [`appearance.md`](appearance.md).

## The allowlist

`allowlist.ts` holds five tables. Elements and attributes absent from them do not survive.

- **`HTML_ELEMENTS`** — structural and inline prose elements (headings, paragraphs, lists, tables, `ruby`, `figure`, `details`), plus `img`, `link`, `style` and the EPUB 2 presentational leftovers (`center`, `tt`, `big`, `strike`) real books still use. Each maps to the attributes it may keep.
- **`HTML_GLOBAL_ATTRIBUTES`** — `class`, `id`, `dir`, `lang`, `xml:lang`, `title`, `style`, `role`, `hidden`, `translate`, `epub:type`, plus any `aria-*`. Any attribute whose lowercased name starts with `on` is removed first, before any other rule.
- **`HTML_DISCARDED`** — elements that go with everything inside them, because their children are source rather than prose: raw-text elements, form controls, and void elements with nothing to keep.
- **`SVG_ELEMENTS` / `SVG_GLOBAL_ATTRIBUTES`** — a shape-and-paint subset. SVG is matched by *local* name so `xlink:href` and `href` share one rule.
- **`SVG_DISCARDED`** — `script`, `foreignObject`, `handler`, and the SMIL animation elements. SMIL is on the list rather than merely absent from the allowlist because `<animate attributeName="href" to="javascript:…">` turns an inert element into a live one *after* sanitization has run.

Two rules are worth stating separately because they are not obvious from the tables:

- **Not-allowlisted defaults to *unwrap*, not discard** — the element goes, its children stay. A book is text before it is markup, and a malformed one nests half a chapter inside a stray element. It is also the safer choice for `<noscript>`: its content is markup when parsed with scripting off and raw text when parsed with scripting on, so an element that *survives* into the frame is re-read in the other mode and attribute boundaries move under it. Removing the element removes the reinterpretation.
- **Reference schemes are decided per attribute.** `a[href]` and `*[cite]` accept `http`, `https`, `mailto`, `tel`, a fragment, or a relative path. `img[src]`, `link[href]` and SVG `image[href]` accept `http`, `https`, `data` or a relative path. `use[href]` accepts a **fragment only** — a `data:` URI there is a document-injection vector, not an image reference — and a `<use>` left without a reference is removed rather than kept inert. Remote references are deliberately *kept*, so the CSP is the layer that refuses them, and refuses them observably.

## Parse, normalize and sanitize — one pass

`sanitizeSection(source, mediaType)` parses, normalizes and sanitizes in a single pass and returns a fresh HTML document plus a summary. They are one pass on purpose: normalization is a property of parsing as XML and re-serializing as HTML, and the sanitizer is the only place the markup is parsed at all. Parsing twice would be wasteful and a chance for the two DOMs to disagree.

1. **Parse.** `application/xhtml+xml` (or `image/svg+xml` for an SVG spine item), falling back to `text/html` on a parse error. Real books are malformed often enough that the fallback is a routine outcome, not a corrupt book.
2. **Flatten.** Comments and processing instructions are removed (they serialize raw and can break out of the markup on the way back into the frame); CDATA sections become text nodes, because an HTML document cannot hold CDATA and EPUB wraps stylesheets in it constantly.
3. **Scrub.** Depth-first: discard, unwrap, or keep-and-scrub-attributes.
4. **Import into a fresh HTML document.** This is what structurally retires the self-closing-tag trap: an XHTML `<a id="x"/>` re-serializes as `<a id="x"></a>` because the HTML serializer emits an end tag for every non-void element. **Never attempt this with a regex.**
5. **Apply resources** (async — see below), then serialize `head.innerHTML` and `body.innerHTML` into the frame document.

## Resources

`ResourceRegistry` wraps `Section.resolve?()` and turns references into `data:` URLs, memoized **by normalized reference string** — the seam promises equal bytes for equal references, never one shared `Resource` object. `applyResources()` walks the sanitized document and rewrites `link[href]`, `<style>` text, `style` attributes, `img[src]` and SVG `image[href]`.

- **CSS references are relative to the stylesheet, not to the section — and `Section.resolve()` only understands section-relative references.** A sheet at `OEBPS/styles/main.css`, reached from a section at `OEBPS/text/`, writes `@import url("second.css")`; resolving that string straight from the section lands on `OEBPS/text/second.css` and returns `undefined`. So each nested reference is composed in relative space first (`joinReference(stylesheetReference, nestedReference)`) and only then resolved. Get this wrong and every stylesheet silently resolves to nothing while section-level images still work — a failure that looks like success.
- **`@import` targets become nested `data:text/css` URLs rather than being inlined.** Inlining would need the statement's extent, and would lose the media queries and layer syntax an `@import` can carry. Nesting costs another 33% per level; real books nest once or twice.
- **Cycles terminate by ancestor set.** `urlForStylesheet` carries the chain of sheets it is nested inside; a sheet that is already its own ancestor returns `undefined` and the `@import` becomes `about:invalid`. An in-flight set would give false positives the moment two sheets import the same third one.
- **`undefined` from `resolve()` is routine, not damage.** Fragment-only references, `data:`/`mailto:`/`tel:` and absolute URLs all return it by design, as do a file present in the archive but absent from the manifest and a declared item whose entry is missing. Only the last two mean "this should have worked".
- **Unresolvable `<img>` degrades to its `alt` text as a text node.** Gutenberg's ebookmaker sets each chapter's drop cap as `<img alt="T">`; dropping the image silently deletes the first letter of every chapter. An empty `alt` means decorative, and the element is removed.
- **Unresolvable references in CSS become `url("about:invalid")`**, never the original relative path: a `srcdoc` document inherits the *parent's* base URL, so a surviving relative reference would aim a request at the host's own origin.

## Protocol

Typed, versioned, and validated on receipt at both ends. `PROTOCOL_VERSION` is `9` today (it began at `1`; the reader facade, human-input, selection, image-tap work, the typography `columnCount` field on `PaginateOptions`, and the draw-only decorations channel grew it — see the reader-facade and appearance sections); every message carries it as `v` and anything else is dropped. The tables below are the original host↔frame handshake; later messages (`linkclick`, the `key`/`swipe`/`tap` input trio, `selection`, `imagetap`, and `decorate`/`undecorate`) are documented with the features that added them.

Origin cannot authenticate here: the frame's origin is `'null'`, which identifies nothing. The host trusts a message only when `event.source === iframe.contentWindow` **and** it validates (`asFrameMessage`). The frame trusts a message only when `event.source === window.parent` and it validates. Everything else is ignored, never dispatched. Because the frame's origin is opaque, host→frame messages must use `'*'` as `targetOrigin`; the payloads carry nothing confidential for that reason. Frame→host messages target the host's real origin when it has one.

Host → frame:

| message | payload | reply |
|---|---|---|
| `ping` | `id` | `pong` |
| `measure` | `id` | `measured` |
| `decorate` | `id`, `decorationId`, `start`, `end`, `className` | `decorated` |
| `undecorate` | `id`, `decorationId` | `decorated` |

Frame → host:

| message | payload | when |
|---|---|---|
| `ready` | — | on `DOMContentLoaded`, once per document. The handshake `render()` awaits. |
| `pong` | `id` | answering `ping` |
| `measured` | `id`, `width`, `height` | answering `measure`; the content root's scroll size |
| `decorated` | `id`, `boxes` | answering `decorate`/`undecorate`; overlay boxes painted (0 on a soft-miss) |
| `violation` | `directive`, `blockedUri` | a `securitypolicyviolation` event in the frame |
| `error` | `message` | an uncaught error in the frame |

The coordination script sits in `<head>`, immediately after the CSP element, so violations raised while the body is still parsing are already being listened for; it announces `ready` on `DOMContentLoaded`, not on evaluation. It also cancels the default action of every in-frame link click: navigation is the next milestone's, and until then a click must not take the frame away from the chapter. The frame's validator is a hand-written copy of `asHostMessage` inside a template string — it cannot import, so the two must be kept in step by hand.

## Gotchas

- **A blob URL created by the host is unreachable from the frame.** It is not a CSP failure and raises no violation event; it simply does not load. Any future "just use a blob URL" simplification is a regression.
- **Chromium and Firefox report XML parse errors differently.** Firefox makes `parsererror` the document element in its own namespace; Chromium makes it the *first child* of the root, in the XHTML namespace. Check both, or a malformed book renders as a truncated tree with the browser's red error box wedged into the chapter.
- **`</noscript>` after an open `<p>` is ignored by the HTML parser** ("any other end tag" stops at the first special element), so an unclosed `<noscript>` swallows the rest of the document. This is why `noscript` is unwrapped rather than discarded.
- **A `<style>` element serializes raw.** XHTML lets an author put `</style>` inside CSS text, which would escape back into markup on the way into the frame; such a stylesheet is dropped whole. HTML-serialized attribute values and text nodes are escaped for you — raw-text elements are the only hole.
- **The frame's cookie access throws rather than returning empty** under an opaque origin in Chromium. Tests should accept either.
- **`ContentHost.render()` refuses a superseded render.** Two overlapping renders would leave the first one's resources untracked, so the earlier call rejects with `ContentHostError`. Callers that let a user click through a table of contents should serialize their renders (the demo chains them on a promise).
- **`epub:type` survives as a literal attribute name**, so a publisher selector written `[epub|type~="pagebreak"]` will not match in the frame; `[epub\:type]` does.

## Known gaps

- **MathML is unwrapped, not rendered.** Its elements are absent from the allowlist, so equations degrade to run-together text. `<annotation-xml encoding="text/html">` is a known injection surface and a MathML allowlist needs designing rather than guessing.
- **`<audio>`, `<video>` and media overlays are unwrapped.** EPUB 3 media overlays are not supported at all yet.
- **Obfuscated fonts decode to garbage and will not load.** De-obfuscation is decoder work — see [`epub.md`](epub.md).
- **Only Chromium is verified.** Safari and Firefox parse-error shapes, opaque-origin cookie behaviour, and `data:` stylesheet handling are unverified by test.

## The boundary with the paginator

The host hands over a **normalized, sanitized document**, not "sanitized bytes" — the paginator chunks what the host produced, and must not re-parse. The host owns markup normalization and image/alt policy because both require the parsed tree. It does **not** own column geometry, chunking, page↔position mapping, or measurement beyond the single `measure` message; and it must never impose a column context on the body.

Two negative duties matter to the paginator: zero-width anchor spans (`<span class="…"><a id="page_357"></a></span>`) are **not** tidied away — they are what fragment navigation and reading positions resolve against — and empty inline elements are left alone, because their empty `getClientRects()` is the paginator's problem to guard, not the host's to prevent.

## The reader facade (`src/reader`)

`render(book, element, options?): Reader` is the public reader — the top of the view stack. It lives in `src/reader`, **outside `src/core`**, because it drives both `src/layout` and `src/view` and core is headless by rule; the PLAN's `book.render(...)` shape is relocated here as a free function (see [`architecture.md`](../architecture.md)). It owns no format vocabulary and never fetches or persists: a `Book` comes in, page geometry comes from one `Paginator` (which it drives, never reaching past into frame geometry), and positions are the headless `Position` model. **Its public surface is frozen under the 0.x contract** — names, event payloads, and firing order are expensive to reverse, so review against the PLAN sketch before changing any of them.

**Surface.** `ReaderOptions { mode?, theme?, customProperties?, fontSize?, fontFamily?, lineHeight?, margin?, textAlign?, justify?, hyphenate?, columns?, start?, input? }` — `mode` selects `'paginated'` (default) or `'scrolled'`; `theme`/`customProperties` drive the appearance theme, and the typography fields (`fontSize`/`fontFamily`/`lineHeight`/`margin`/`textAlign`/`justify`/`hyphenate`/`columns`) drive the typography half — all applied at the first render (see [`appearance.md`](appearance.md)); `margin` maps to the paginator's `columnGap` and `columns` (1 or 2) to `PaginateOptions.columnCount`; `start` opens somewhere other than the book's beginning (any `GoToTarget`). The returned `Reader` exposes `next/prev` (async, page-then-section roll), `nextSection/prevSection` (async, whole-section jumps, no-op at the ends), `goTo(target)`, `back()`, `setMode(mode)`, `setAppearance(appearance)` (live theme + typography change, position-preserving, routed through the same navigation queue — a colour knob repaints in place, a reflowing typography knob re-lays out and restores the reading place by content anchor), `search(query, options?)` (whole-book full-text search — a lazy async iterator of jumpable hits, off the navigation queue; see Search below), `decorate(id, position, { className })` / `undecorate(id)` (draw-only highlights; see Decorations below), the synchronous getters `position` and `mode`, `on(event, handler)` (returns an unsubscribe fn), and `destroy()`. `ReaderPosition` is `{ section, progress, chapterProgress, page, totalPages }`, assembled from `Paginator.bookProgress` (progress/chapterProgress/page/totalPages) plus the active section index; before the first paint it reads as all-zero at the current section index.

**Navigation is serialized through a promise queue.** Every nav method enqueues its work behind previously-issued calls so overlapping calls settle in issue order; a task failure surfaces as an `error` event and is swallowed so it never breaks the chain, and `destroy` short-circuits the queue. This is the facade's answer to the host refusing a superseded render — callers never have to serialize themselves.

**Events (FROZEN) — names, payloads, firing order.**

| event | payload | when |
|---|---|---|
| `ready` | `ReaderPosition` | once, after the first section paints |
| `positionchange` | `ReaderPosition` | after any navigation settles |
| `sectionchange` | `{ index, sectionId }` | when the active section changes |
| `linkclick` | `{ href }` | an in-frame link click, **before** it is followed |
| `selection` | `{ text, position }` | a completed text selection in the frame; `position` is a `Position` anchored at the selection start |
| `error` | `Error` | a navigation or render failure (also frame-reported errors) |

Firing order is documented and tested:
- **initial render:** `sectionchange` → `positionchange` → `ready`.
- **page turn within a section:** `positionchange`.
- **roll across a section boundary / `goTo` / `nextSection` / `prevSection`:** `sectionchange` (only if the section actually changed) → `positionchange`.
- **link click:** `linkclick` → (`sectionchange` if it landed in a new section) → `positionchange`.
- **`setMode`:** `positionchange`.
- **selection:** `selection`, standalone — it reports, it does not navigate, so it fires no `positionchange` and is not enqueued behind navigation.

A listener throwing is caught and swallowed (a copy of the set is iterated, so a handler unsubscribing mid-dispatch cannot skip a sibling); it never derails the emit or the navigation.

**`goTo` — six target forms.** `'start'` (first section, first page), `'end'` (last section, last page), a number `0..1` (even-weight book fraction → section + nearest page, matching `BookProgress.bookFraction`), a `Position` (content-anchor resolve via `Paginator.pageOfPosition`), a `TocItem` (its `sectionId` + optional `fragment`), and an internal `href` string. `back()` is `goTo(Position)` under the hood, restoring a pushed pre-jump position.

**`href` resolution is a best-effort, format-neutral heuristic** — core exposes no href→section seam (sections are id-addressed; `Section.resolve` yields a `Resource`, not a section target), and adding one would leak format vocabulary, so the facade resolves using only public `Book` data and **degrades quietly on a miss** (no throw, stays put / page 0), consistent with the `Position` soft-miss philosophy. In order: (1) the path or its last segment equals a `section.id`; (2) the last segment, or that segment minus its extension, matches a `section.id` or an id's own last-segment/extension-less form; (3) a fragment the href carries is also carried by a `TocItem`, whose `sectionId` is then borrowed. A pure-fragment href (`#note`) seeks within the current section.

**Fragment anchoring uses the v4 seam.** A fragment (from a `TocItem` or an href) is turned into a page by `Paginator.pageOfElementId`, which the frame answers via `offsetOfElementId` → `pageOfOffset` (protocol v4). A resolved id lands on that element's page; an unresolvable id is a soft miss that lands on the section's first page.

**Internal-link back-stack.** The paginator/host cancels the in-frame default and reports the click through `ContentHostOptions.onLinkClick`; the facade emits `linkclick`, pushes the current `Position` onto its back-stack, then follows the href — all enqueued so it settles in order. `back()` pops and restores via `goTo(Position)`; empty-stack `back()` is a no-op.

**Mode switch preserves position.** `setMode` delegates to `Paginator.switchMode`, which captures a `Position` for the current page, re-paginates in the new mode, and seeks back to the page that `Position` now resolves to (M1-2 capture→re-layout→resolve→restore) — no reload. A same-session same-text miss degrades to page 0. Switching before the first paint just records the mode. **Caveat (engine, not facade):** scrolled mode collapses paging to a single page, so a `Position` captured at a *mid-section* page while scrolled resolves back to that section's first page — a paginated→scrolled→paginated round trip from a mid-section page can therefore drift toward page 0. Exact mid-scroll capture is the M3-2 appearance-invariant's job; the facade only guarantees the switch composes, holds the section, and preserves the page when the anchor page survives the collapse (e.g. a page-0 round trip lands home).

**`destroy()` leaves nothing behind** (idempotent): it tears down the `Paginator` (which destroys the host, the iframe, and — because resources are `data:` URLs the frame carries, not host-minted blob URLs — there is nothing to revoke; the frame's `message` listener goes with the iframe), clears all event listener sets, and drops the back-stack. Pending frame requests reject as the host tears the channel down.

**Protocol is at v9.** The facade needed link-click reporting and fragment→page mapping on top of the paginator additions (v4), then human input (v5), then selection reporting (v6), then image-tap reporting (v7 — see the image-zoom section below), then a `columnCount` field on `PaginateOptions` for the typography half's 1-or-2 columns (v8 — column geometry is the paginator's, so it rides the wire while the other typography knobs ride the srcdoc stylesheet; see [`appearance.md`](appearance.md)), then the draw-only decorations channel (`decorate`/`undecorate`/`decorated`, v9 — see Decorations below); `PROTOCOL_VERSION` is `9`, and the frame's hand-written validator (`coordinationScript`'s `validateHost`, a copy of `asHostMessage`) is kept in step with `asHostMessage`/`asFrameMessage` by hand.

### Human input — keyboard, swipe, tap zones (T003)

The reader is operable by hand: keyboard, touch swipe, and configurable tap zones turn pages, all direction-aware. The mapping logic lives in `src/reader/input.ts` — a pure, DOM-free, unit-checkable module of a key table plus swipe/tap geometry — and the facade wires it to navigation.

**Capture site: forwarded from the frame, not caught on the host** (the one real decision). Once the reader frame has focus, its key and pointer events fire *inside the opaque-origin frame's document* and never bubble to the host — a separate document behind the sandbox. Catching them on the host container would only see events while the container, not the frame, held focus, i.e. almost never during reading. So the coordination script (`frame.ts`) listens in the frame and forwards *semantic* gestures over the protocol; the host is the only party that can act on them. This is the same reasoning that already forwards `linkclick`. The frame `preventDefault`s exactly the keys it forwards (so the frame does not scroll under them) and leaves every other key untouched.

**Three new frame→host messages (unsolicited, protocol v5):**

| message | payload | when |
|---|---|---|
| `key` | `key` | a navigation-relevant `keydown` in the frame (`ArrowLeft/Right/Up/Down`, `PageUp/PageDown`, `Home`, `End` — the frame's `NAV_KEYS` allowlist; nothing else is forwarded) |
| `swipe` | `dx`, `dy` | a completed pointer/touch drag clearing the frame's `SWIPE_THRESHOLD` (30px) and horizontal-dominant (`|dx| > |dy|`) |
| `tap` | `x`, `y`, `width`, `height` | a pointer/touch press-release within `TAP_SLOP` (10px) that is **not** on a link and **not** on an image — a link tap stays a `linkclick` and an image tap becomes an `imagetap` (see the image-zoom section), each shared through its own ancestor walk |

The host relays these through `ContentHostOptions.onKey(key)` / `onSwipe(dx, dy)` / `onTap({x, y, width, height})`, which the facade supplies.

**Key map (LTR).** `ArrowRight` / `PageDown` / `ArrowDown` → next; `ArrowLeft` / `PageUp` / `ArrowUp` → prev; `Home` → `goTo('start')`; `End` → `goTo('end')`.

**Swipe (LTR).** `dx < 0` (leftward, contents move left) → next; `dx > 0` (rightward) → prev.

**Tap zones.** The tap's `x/width` is normalized to a fraction; `fraction < left` → left-edge page, `fraction >= right` → right-edge page, the band between is inert. Defaults are the left third (`left = 1/3`) and right third (`right = 2/3`). Directions are *visual* — left-edge page is prev, right-edge is next — under LTR.

**The RTL flip (`Book.direction === 'rtl'`) touches the horizontal axis only.** In RTL the visual right edge is the *earlier* page, so every horizontal gesture reverses: `ArrowRight` → prev, `ArrowLeft` → next; a leftward swipe → prev, rightward → next; the left tap zone → next, the right tap zone → prev. What does **not** flip: `PageUp`/`PageDown` and the vertical arrows stay reading-order neutral (PageDown always advances), and `Home`/`End` are always book start/end. RTL is easy to get right for keyboard and wrong for swipe/tap, so it is centralized in `edgeIntent(edge, direction)` and every mode routes through it. The mapping resolves to a `NavIntent` (`next | prev | nextSection | prevSection | start | end | none`); the facade dispatches each through the *same serialized navigation queue* as programmatic calls, so hand input interleaves in issue order and never races a render.

**Config (`ReaderOptions.input`).** Optional and additive — omit it and all three modes are on with defaults:

- `keyboard?: boolean` (default `true`)
- `swipe?: boolean` (default `true`)
- `tapZones?: { left?: number; right?: number } | false` (default enabled at 1/3 & 2/3; `false` disables tap zones, an object overrides the zone fractions)

Each mode is gated independently in the facade, so a consumer can turn any one off; the frame still forwards all three (the wire is not conditional), the facade simply ignores a disabled mode.

**`prefers-reduced-motion` gates the zoom overlay, never input.** The reader's only animation is the image-zoom overlay's open/close fade (see the image-zoom section); it is gated on `matchMedia('(prefers-reduced-motion: reduce)')` and appears/disappears instantly under the preference. Page-turning is never gated — `#dispatchIntent` in `src/reader/index.ts` dispatches every navigation intent regardless of the preference, because input must always turn the page. There is still no page-turn animation; when one lands (M3 appearance), gate that animation the same way, never the input.

### Selection

A text selection in the reader surfaces as a first-class `selection` event carrying the selected text plus a `Position` anchored at the selection's start. The event fires standalone — it reports, it never navigates — so it does not go through the navigation queue and emits no `positionchange`.

**Capture site: the frame, forwarded — the host cannot read the frame's `Selection`.** A selection lives inside the opaque-origin frame's document and never bubbles to the host, exactly like `linkclick` / `key` / pointer gestures. The coordination script (`frame.ts`) observes it and forwards a *semantic* payload; the host cannot reach across the sandbox to read the `Selection` object.

**Wire message (frame→host, unsolicited, protocol v6):**

| message | payload | when |
|---|---|---|
| `selection` | `start`, `end`, `text` | a completed text selection in the frame — a non-collapsed selection with non-empty rects, settled on pointer/key/mouse release |

`start`/`end` are UTF-16 code-unit offsets into the **tiled section text** (the same text space `sectionText` reports and the paginator measures against), so they are directly consumable by `capturePosition`. The host relays through `ContentHostOptions.onSelection`.

**Completion, not every change.** `selectionchange` fires once per character during a drag, so the frame marks the selection dirty on `selectionchange` and *forwards* only on the next `pointerup`/`keyup`/`mouseup` — the release that ends a real selection gesture. A bare click collapses the selection and is dropped by the guards below.

**Two guards, both in the frame:**
- **Collapsed / empty** — an `isCollapsed` selection or empty `toString()` forwards nothing (a bare click emits no event).
- **Empty `getClientRects()`** — the zero-width-anchor / empty-inline gotcha the paginator already lives with (114 such spans in `item8`). A selection whose range has no client rects carries no painted geometry, so forwarding it would be a malformed range; the frame length-checks the rect list and drops it.

**Offset computation.** For each endpoint the frame finds the enclosing `.wolfyreader-chunk` container, sums the `textContent` length of every prior chunk container, then adds the text length from that chunk's start to the endpoint via a `Range` — the same tiling the chunk `data-chunk-start` attributes encode. An endpoint outside a realized chunk container yields `-1` and the selection is dropped. Endpoints are normalized so `start <= end` regardless of selection direction.

**The UTF-16-offset-range↔`Position` bridge.** `Paginator.positionOfOffsetRange(start, end)` captures the anchor at `start` with `capturePosition(text, start, sectionId)` — `capturePosition` takes a UTF-16 offset directly, so no grapheme conversion is needed on the capture leg (the grapheme↔UTF-16 conversion only matters on the *resolve* leg, `pageOfPosition`). Only the `start` anchor is needed to resolve the range back to a page; `end` rides the wire for symmetry and future decoration work. The facade attaches `text` and emits `selection`. Because the `Position` is content-addressed, a host can persist it as a bookmark/highlight anchor and `goTo` it later; it resolves back through the same soft-miss path as any other `Position`.

### Image handling and tap-to-zoom

Oversized book images are capped and tappable-to-zoom.

**Containment lives in the frame reset, not the facade.** The `img,svg{max-width:100%;height:auto}` rule in `RESET_CSS` caps every replaced element at its column width; an image with a 2400px intrinsic width paints at the column width, not 2400px, and never breaks or overflows its column. Because each chunk is its own multi-column context, a wide image simply lands on its own column (its own page) rather than pushing prose off the page — the paginator's forced-page-break-per-chunk behaviour, not new work here.

**A tap on an image forwards the image, not a page-turn.** The coordination script (`frame.ts`) has an `imageAncestor` walk mirroring `linkAncestor`: on a completed tap (within `TAP_SLOP`) that is on an `<img>`/SVG `<image>` and not on a link, it sends an `imagetap` carrying the image's already-substituted `src` and its `alt` instead of a plain `tap`. A tap on neither a link nor an image stays a page-turn `tap`, so the `tapIntent` zone mapping is untouched — no regression. This is the same forward-a-semantic-gesture reasoning as `linkclick`/`key`/`swipe`/`tap`.

**Wire message (frame→host, unsolicited, protocol v7):**

| message | payload | when |
|---|---|---|
| `imagetap` | `src`, `alt` | a tap on a book image (not a link, not a page-turn); `src` is the image's already-served `data:` URL, `alt` its accessible name |

The host relays it through `ContentHostOptions.onImageTap({src, alt})`, which the facade supplies.

**The overlay is strictly host-side and renders `data:` bytes — never `blob:`.** `ImageZoom` in `src/reader/index.ts` is a modal dialog appended to the *host* document, outside the sandboxed frame. It renders the exact `data:` URL the frame already carries in its `<img src>` (what `applyResources` substituted) — the full-resolution bytes, reused, not re-fetched and not re-minted. It **must not** mint a `blob:` URL: a host blob URL belongs to the host origin and the opaque-origin frame is refused it (the same measured "Not allowed to load local resource" the resource layer lives with), and there is no reason to create one host-side either — the `data:` string is the source of truth. The facade ignores any non-`data:` `src` (a remote image the CSP already refuses in-frame). The overlay mints no new frame resource; it opens no second document-assembly path.

**Accessibility and dismissal.** The overlay is a `role="dialog"` `aria-modal` element with a focus **trap**: Tab is intercepted and cycled explicitly between the close control and the image, so focus can never escape while it is open. It closes on Escape or a backdrop (pointerdown on the overlay root, not its children) and returns focus to the reader region — the pre-open active element when that is focusable, else the reader mount (made programmatically focusable with a `-1` tabindex, because the tap that opened the overlay came from inside the frame, leaving the host's active element on the frame body). Its open/close fade is the reader's only animation and is gated on `prefers-reduced-motion` (instant under the preference); `destroy()` closes any open overlay.

### Search

`reader.search(query, options?): AsyncIterableIterator<SearchHit>` runs full-text
search over the whole book and streams hits as sections are scanned. It is the one
frozen-surface addition since selection. The engine is headless and lives in
`src/search` (see [`search.md`](search.md)); the facade is a thin delegate to
`searchBook(book, query, options)`.

- **Hit shape (FROZEN):** `SearchHit = { text, context, position, sectionIndex }` —
  `text` is the raw matched run; `context` is the match surrounded by neighbouring
  text, trimmed to whole words at both edges; `position` is a content-addressed
  `Position`; `sectionIndex` is the 0-based reading-order index.
- **Streaming guarantee (FROZEN):** the return is a **lazy async iterator**. It
  yields the first hit before the last section is scanned and never buffers the book
  whole; stopping early (`break`) halts the scan (no later section is loaded). This is
  the demo's live, growing hit list.
- **Jumpable:** `await reader.goTo(hit.position)` lands on the hit's page — the
  content anchor resolves against the frame-measured section text, the same
  `Position` machinery as selection and mode-switch restore.
- **Off the navigation queue and off the frame.** `search` reads section bytes
  headlessly (decode → strip markup → match) and drives neither the paginator nor the
  frame, so it composes with reading rather than blocking it; only the consumer's
  `goTo` enqueues. It does **not** route through `Paginator.sectionText()` — that is
  the currently-painted section only and needs a browser.
- **Matching is normalized literal substring** (case-insensitive, NFC, smart-
  punctuation- and whitespace-folded, diacritics-sensitive); no ranking, fuzzy, or
  regex. Rendering a *visible highlight* on a landed hit is a separate, later unit
  (it consumes the decorations API); `search` ships the engine + jumpable hits only.

**Search touches no wire message.** The matcher is headless and the scan does not
cross the frame boundary, so search added nothing to the protocol (the version has
since moved past `7` for image-tap reporting and decorations, unrelated to search).

### Decorations (draw-only)

`reader.decorate(id, position, { className })` draws a styled overlay over the range
`position` resolves to; `reader.undecorate(id)` removes it. Both join the frozen 0.x
surface. It is the API a visible search-result highlight is built on: a search hit's
content-addressed `Position` (see [`search.md`](search.md)) is both jumped to via `goTo`
and decorated over via `decorate` off that one anchor, so the highlight lands exactly
where the jump does. A hit whose `Position` no longer resolves is the ordinary soft miss
below — the highlight draws nothing and throws nothing.

- **Draw-only, never store — the cross-cutting rule.** The library DRAWS decorations
  and never persists, serializes, or fetches annotation data; storage is the host's,
  by design (see [`architecture.md`](../architecture.md)). The reader holds only the
  in-memory decoration *intent* (id → `Position` + `className`), for the `Reader`'s
  lifetime, so it can re-anchor across a re-layout; `undecorate`/`destroy` drop it. A
  host wanting durable highlights persists the `Position` strings itself and re-calls
  `decorate` on the next open. Annotation UI (notes, colour pickers, comment threads)
  is host work, out of the library per "no knowledge of any consuming application".
- **Wire messages (host→frame, protocol v9):** `decorate { decorationId, start, end,
  className }` and `undecorate { decorationId }`; both are acked with `decorated {
  boxes }` (the number of overlay boxes painted, `0` on a soft-miss). `start`/`end` are
  UTF-16 code-unit offsets over the tiled section text — the same space `sectionText`,
  `selection`, and the paginator measure against.
- **The Position → offset-range bridge.** `Paginator.decorate(id, position, className)`
  resolves `position` against the frame-measured section text (`resolvePosition`) to a
  grapheme span `[offset, offset + length)`, converts both ends to UTF-16 offsets, and
  sends the frame the draw. The frame maps the offset range to a DOM `Range`, reads its
  client rects, and paints one absolutely-positioned overlay box per rect **inside the
  range's start chunk container** — the positioned, page-turn-translated element — so
  each box rides the same `translateX` the text does on a turn and stays over its
  words. This is the decoration analogue of the selection offset↔`Position` bridge.
- **Re-anchor reuses the M1-2 pipeline.** After any re-layout — `relayout`,
  `switchMode`, and the `applyAppearance`/`setThemeCss` reflow path (`#reapply`), plus a
  fresh `paginate` — the paginator re-resolves every live decoration's `Position`
  against the (same-text, new-geometry) section and re-issues the frame draw, exactly
  the capture→re-layout→resolve→restore machinery mode-switch and appearance already
  use. So a highlight survives a font-size change: it stays over the same text even as
  its page number shifts. A `switchMode`/appearance change re-renders the section into a
  **fresh frame document** with no decoration state, so re-issuing is mandatory, not an
  optimization; a bare `relayout` leaves the frame document intact, and the frame also
  repaints its own overlays geometrically after `relayout`/`goToPage`.
- **Soft-miss draws nothing, throws nothing.** `resolvePosition` returning `undefined`,
  or a `Position` whose `sectionId` is not the active section, means the decoration is
  silently not drawn — the intent is retained, so navigating to that section (or a later
  re-layout that brings the anchor back) redraws it. Only a structural fault (a
  malformed serialized `Position` via `parsePosition`) throws, and only if the host
  round-trips through a serialized string. A decoration for a not-yet-active section
  simply waits: `paginate` redraws matching decorations when that section lands.
- **Pointer-transparent and layout-neutral overlay + empty-rect gotchas.** Overlay
  boxes are `position: absolute`, `pointer-events: none`, appended out of flow inside
  the chunk — so they never eat a subsequent selection or a link click and never change
  page geometry. Empty `getClientRects()` (the zero-width-anchor / empty-inline gotcha
  the paginator already lives with) draws nothing rather than a malformed box; a
  zero-area rect is skipped. A default `.wolfyreader-decoration` style in the frame's
  reset makes a bare `decorate` visible without host CSS; the caller's `className`
  rides alongside so an appearance stylesheet can restyle it.
- **Known scrolled-mode caveat (engine, not this API).** Scrolled mode collapses paging
  to a single page, so a `Position` captured at a *mid-section* page while scrolled
  resolves back to that section's first page — the same drift the mode-switch section
  documents. A decoration re-anchored across a paginated→scrolled→paginated round trip
  from a mid-section page can therefore land on the wrong page; exact mid-scroll capture
  is the M3-2 appearance-invariant's job, not this one's. The decoration's *text* anchor
  is unaffected — only the page it redraws on can drift, and only through that round trip.

**Packaging note.** `package.json` has **no `exports` map yet** — neither the reader subpath nor `core`/`epub`/`layout` are declared, so all are importable by path only (which is what the tests and demo do). Adding a partial map now would break those path imports; the public `exports` map (including the `./reader` subpath) is deferred to a later packaging milestone.

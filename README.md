# 📖 wolfy-reader

[![npm](https://img.shields.io/npm/v/wolfy-reader)](https://www.npmjs.com/package/wolfy-reader)
[![license](https://img.shields.io/npm/l/wolfy-reader)](LICENSE)

**An ebook reading engine you embed in your own app.** Bytes and an element in; a real reading view out — pages that turn, text you can search, and typography you can change without losing your place.

It is a library, not a reader app: no UI chrome, no shelf, no settings screen. It never fetches and never persists. Your app owns the files, the storage and the look; wolfy-reader owns decoding, layout and the reading surface.

- **EPUB 2/3, FB2, plain text** — decoded from scratch, MIT-licensed, TypeScript, ESM only
- **Zero runtime dependencies** — `dependencies` is empty and CI keeps it that way
- **Untrusted content stays sandboxed** — book markup renders in a hardened iframe
- **Positions survive re-layout** — change any typography knob and the paragraph you were reading stays on your page
- **Headless core** — `wolfy-reader/core` decodes under Node or a worker, no DOM

## Install

```bash
npm install wolfy-reader
```

Browsers with `DecompressionStream`: **Chrome 80+, Safari 16.4+, Firefox 113+**. ESM only — no CJS build, no bundler required.

## Quickstart

```ts
import { open, render } from 'wolfy-reader';
import { epub } from 'wolfy-reader/epub';

// Bytes in: ArrayBuffer | Uint8Array | Blob (a File is one) | { size, read(offset, length) }.
const book = await open(file, { formats: [epub] });

const reader = render(book, document.getElementById('reader')!, {
  mode: 'paginated',
  theme: 'sepia',
  fontSize: 19,
});

reader.on('ready', (at) => console.log(`page ${at.page + 1} of ${at.totalPages}`));

await reader.next();             // turn a page
await reader.goTo(book.toc[0]!); // jump to a chapter
await reader.back();             // undo the jump
```

Formats are explicit — `open` only loads the decoders you pass, so a text-only app never pulls the EPUB decoder or the ZIP reader. `render` returns synchronously and paints asynchronously; `ready` is the first painted page.

## Usage

**Change how it looks, keep the place.** Both calls re-flow the book and put you back where you were — held by a content anchor, not a page number.

```ts
await reader.setAppearance({ fontSize: 24, lineHeight: 1.6, margin: 48 });
await reader.setMode('scrolled');
```

**Search the whole book, lazily.**

```ts
for await (const hit of reader.search('whale')) {
  console.log(hit.context);
  await reader.goTo(hit.position);
  break;
}
```

**Selection menu + highlight.** `selection` carries the text, a `Position`, and the selection's bounding box in CSS px relative to the reader element's padding box, so a menu anchors in one line; `selectionclear` says when that selection is gone (a click in the page, a new section), so the menu can go with it. Tapping a highlight fires `decorationtap` with the decorations under the tap (topmost first) and their boxes — the same menu opens on the highlight, and the tap turns no page; a tap on plain text fires `tap` before any page turn, so a menu can close first. The library draws decorations and never stores them; a `Position` serializes to one opaque string you persist yourself.

```ts
import { parsePosition, type Position } from 'wolfy-reader';

// <div class="wrap" style="position: relative">
//   <div id="reader"></div>       <!-- no border or padding: rect maps 1:1 -->
//   <div class="menu" hidden>
//     <button id="highlight">Highlight</button><button id="remove">Remove highlight</button>
//   </div>
// </div>
const menu = document.querySelector<HTMLElement>('.menu')!;
let selected: { text: string; serialized: string; position: Position } | null = null;
let tapped: string | null = null; // the highlight the menu is open for

function openMenu(rect: { x: number; y: number; width: number; height: number }) {
  menu.hidden = false;
  menu.style.left = `${rect.x + rect.width / 2 - menu.offsetWidth / 2}px`;
  menu.style.top = `${rect.y - menu.offsetHeight - 8}px`; // or below: rect.y + rect.height + 8
}

reader.on('selection', ({ text, position, rect }) => {
  selected = { text, serialized: position.serialized, position };
  tapped = null;
  openMenu(rect);
});
reader.on('decorationtap', ({ decorations }) => {
  tapped = decorations[0].id;          // your id — the one you passed to decorate()
  selected = null;
  openMenu(decorations[0].rect);
});
reader.on('tap', () => { menu.hidden = true; });
reader.on('positionchange', () => { menu.hidden = true; });
reader.on('selectionclear', () => { if (tapped === null) menu.hidden = true; });

document.querySelector('#highlight')!.addEventListener('click', async () => {
  if (selected === null) return;
  await reader.decorate(selected.serialized, selected.position, { className: 'my-highlight' });
  localStorage.setItem(`note:${selected.serialized}`, selected.text);   // your storage, your shape
});
document.querySelector('#remove')!.addEventListener('click', async () => {
  if (tapped === null) return;
  await reader.undecorate(tapped);
  localStorage.removeItem(`note:${tapped}`);
  menu.hidden = true;
});

// Next open: the stored string resolves by content, so the highlight lands on the same words.
for (const key of Object.keys(localStorage).filter((k) => k.startsWith('note:'))) {
  const serialized = key.slice('note:'.length);
  await reader.decorate(serialized, parsePosition(serialized), { className: 'my-highlight' });
}
```

**Decode without a DOM.** Nothing reachable from `wolfy-reader/core` touches `document` or `window`; a static check in CI enforces it.

```ts
import { open } from 'wolfy-reader/core';
import { text } from 'wolfy-reader/text';

const book = await open(bytes, { formats: [text] });
```

## React

`wolfy-reader/react` wraps the same facade for React 19. React is an optional peer: it is never installed unless you already have it, and no other subpath imports it.

```tsx
import { Reader, useReader } from 'wolfy-reader/react';

// The component: options as props, one callback per event, the facade through ref.
<Reader book={book} theme="sepia" fontSize={19} onPositionChange={(at) => save(at)} />

// The hook, when your own element and layout are in charge.
const { ref, reader, position } = useReader(book, { mode: 'scrolled' });
<div ref={ref} />
<button onClick={() => reader?.next()}>next</button>
```

Changing a prop calls `setAppearance` or `setMode` on the live reader; only a new `book` remounts. Any other framework calls `render(book, element)` directly — it takes a plain `HTMLElement`.

## Features

| | |
| --- | --- |
| Reading modes | Paginated with real page turns, or continuous scroll — switchable at runtime |
| Navigation | Nested TOC, in-book links, a back-stack for jumps |
| Search | Whole-book full-text search, streamed as sections are scanned, with jumpable hits |
| Appearance | Theme, font family and size, line height, margins, one or two columns, justification, hyphenation — every knob preserves position |
| Decorations | Styled overlays over any anchored range; annotation data lives in your app |
| Sentences | `reader.sentences()` yields each sentence with a `Position` — drive a speech engine from your side |
| Input | Keyboard, tap zones and swipe, all configurable |
| Errors | Every failure extends `BookError` (`UnrecognizedFormatError`, `CorruptContainerError`, `EncryptedContentError`) |

## Package surface

Six subpaths, listed longhand — internal modules are not importable. Sizes are minified + gzipped, and each has a budget CI refuses to exceed.

| Import | Contains | Size |
| --- | --- | --- |
| `wolfy-reader` | `render` + the reader facade, plus everything in `/core` | ~30 kB |
| `wolfy-reader/core` | `open`, the `Book` model, `Position`, typed errors — guaranteed headless | ~2.3 kB |
| `wolfy-reader/epub` | EPUB decoder (the only entry carrying the ZIP reader) | ~6.6 kB |
| `wolfy-reader/fb2` | FB2 decoder | ~3.7 kB |
| `wolfy-reader/text` | Plain-text decoder | ~1.4 kB |
| `wolfy-reader/react` | `useReader` + `Reader` for React 19 — carries the facade; React itself is an optional peer | ~30 kB |

## Stability

**The `Book` model and the `Position` format are the promise. Everything else may churn.**

Core model names are never renamed. A reading position serializes to a version-prefixed opaque string you persist verbatim and never parse, so positions stored today keep resolving as the format evolves. The reader facade grows additively.

The project stays in `0.x` until the model has survived a real consumer; until `1.0`, a breaking change bumps the minor.

## Security

Book content is untrusted input and renders behind three independent defences:

- a `sandbox="allow-scripts"` iframe **without** `allow-same-origin`, so the frame's origin is opaque;
- allowlist sanitization of every element and attribute before markup is assembled;
- a per-render `Content-Security-Policy` of `default-src 'none'`, with the book's own images, stylesheets and fonts served as `data:` URLs.

Host and frame talk over one typed, versioned, validated `postMessage` protocol. See [`docs/domains/view.md`](docs/domains/view.md) for why each layer is load-bearing.

## Scope

- **DRM-free books only.** DRM is permanently out of scope: nothing here decrypts, circumvents or interoperates with a DRM scheme.
- **Reflowable only.** Fixed-layout books are detected and reported so a host can refuse them.
- **MOBI/AZW3 are not supported, and not planned.** Amazon's current format is closed, Amazon-sold books are DRM-locked, and the DRM-free remainder converts losslessly to EPUB with Calibre — feed the EPUB.
- Formats were learned from specifications — the W3C EPUB specs and the FictionBook 2 specification — never from GPL source. No code is taken from epub.js, foliate-js, Readium, PDF.js or JSZip.

## Development

```bash
npm install                      # dev toolchain only — there are no runtime deps
npx playwright install chromium  # needed for npm run test:browser
npm run fetch-corpus             # optional: real books for the differential suite (~30 MB)
npm test                         # node:test suite, headless
npm run demo                     # dev server for the framework-free demo
```

Setup, every check, the demo, the release flow and the AI-agent workflow are in [`CONTRIBUTING.md`](CONTRIBUTING.md). Durable design knowledge lives in [`docs/architecture.md`](docs/architecture.md) and [`docs/domains/`](docs/domains/).

## License

MIT © Vitaliy Tkachuk

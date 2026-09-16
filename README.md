# 📖 wolfy-reader

[![npm](https://img.shields.io/npm/v/wolfy-reader)](https://www.npmjs.com/package/wolfy-reader)

**The ebook reading engine you drop into your own app.** Hand it bytes and an element; it gives you a real reading view — pages that turn, text you can search, and typography you can change without losing your place.

It is a library, not a reader app. No UI chrome, no routing, no settings screen, no shelf — and it never fetches and never persists. Your app owns the files, the storage and the look; wolfy-reader owns decoding, layout and the reading surface, and hands you a small API to drive them.

From-scratch, MIT-licensed, ESM-only TypeScript for EPUB, FB2 and plain text. Zero runtime dependencies, tree-shakeable subpaths, a headless core that runs under Node — and untrusted book content rendered inside a hardened sandboxed iframe.

## Install

```bash
npm install wolfy-reader
```

## Quickstart

```ts
import { open, render } from 'wolfy-reader';
import { epub } from 'wolfy-reader/epub';

// Bytes in: ArrayBuffer | Blob (a File is one) | { size, read(offset, length) }.
// The library never fetches — you hand it the bytes.
const book = await open(file, { formats: [epub] });

console.log(book.metadata.title, book.sections.length);

const reader = render(book, document.getElementById('reader')!, {
  mode: 'paginated',
  theme: 'sepia',
  fontSize: 19,
});

reader.on('ready', (at) => console.log(`page ${at.page + 1} of ${at.totalPages}`));

await reader.next();               // turn a page
await reader.goTo(book.toc[0]!);   // jump to a chapter
await reader.back();               // undo that jump — there is a back-stack
```

Formats are explicit: `open` takes the list you pass it, so a text-only app never pulls the EPUB decoder or the ZIP reader. `render` returns synchronously and paints asynchronously — the `ready` event is the first painted page.

**Change how it looks, keep the place:**

```ts
await reader.setAppearance({ fontSize: 24, lineHeight: 1.6, margin: 48 });
await reader.setMode('scrolled');
```

Both re-flow the book and then put you back where you were reading. This is a contract, not a best effort: the paragraph at the top of your page is still on your page afterwards, held by a content anchor rather than a page number, and proven by a browser suite that runs every knob against real books.

**Search the whole book, lazily:**

```ts
for await (const hit of reader.search('whale')) {
  console.log(hit.context);        // the match, trimmed to whole words
  await reader.goTo(hit.position); // land on its page
  break;
}
```

**Highlight a selection:**

```ts
import { serializePosition } from 'wolfy-reader';

reader.on('selection', async ({ text, position }) => {
  await reader.decorate('note-1', position, { className: 'my-highlight' });
  localStorage.setItem('note-1', serializePosition(position)); // your storage, not ours
});
```

The library *draws* decorations and never stores them. A `Position` serializes to one opaque string you persist yourself and hand back to `decorate` or `goTo` next time.

**Decode without a DOM:**

```ts
import { open } from 'wolfy-reader/core';
import { text } from 'wolfy-reader/text';

const book = await open(bytes, { formats: [text] });
```

`wolfy-reader/core` is guaranteed headless — nothing reachable from it touches `document` or `window`, enforced by a static check in CI — so it runs under Node or a worker.

## What you get

- **Two reading modes** — paginated with real page turns, or continuous scroll, switchable at runtime.
- **Navigation** — nested TOC, in-book links, and a back-stack for jumps.
- **Full-text search** across the whole book, streaming as sections are scanned, with jumpable hits.
- **Live appearance** — theme, font family and size, line height, margins, one or two columns, justification, hyphenation. Every knob preserves position.
- **Selection events and decorations** — draw styled overlays over any anchored range; the library never stores annotation data.
- **Sentence ranges** — `reader.sentences()` returns each sentence with a `Position`, so a host can drive a speech engine sentence by sentence. The library speaks nothing.
- **Input handled** — keyboard, tap zones and swipe, all configurable.
- **Typed failures** — every error extends `BookError` (`UnrecognizedFormatError`, `CorruptContainerError`, `EncryptedContentError`), so hosts catch by class.

## Stability contract

**The `Book` model and the `Position` format are the promise. Everything else may churn.**

Names in the core model are treated as unrenameable, and a reading position serializes to a version-prefixed opaque string a host persists verbatim and never parses — so positions stored today keep resolving as the format evolves. The reader facade grows additively (new methods, never renamed or removed ones).

The project lives honestly in `0.x` until the model has survived a real consumer. Until `1.0`, a breaking change bumps the minor.

## Browser support

Browsers with `DecompressionStream` — **Chrome 80+, Safari 16.4+, Firefox 113+**. The engine is built on platform primitives (`DecompressionStream`, `DOMParser`, `TextDecoder`, `Intl.Segmenter`, CSS multi-column), which is also what keeps it small.

ESM only — no CJS build, no bundler required. The headless `wolfy-reader/core` entry also runs under Node.

## Zero runtime dependencies

`dependencies` is empty and stays empty, permanently. Not "few" — none. CI fails the build if anything is added, and a pack-fidelity check installs the published tarball into a scratch project to prove it.

Dev dependencies exist (TypeScript, Playwright, esbuild, `@types/node`); none of them ship to you.

Published weight, minified and gzipped:

| Import | Size |
| --- | --- |
| `wolfy-reader` | ~30 kB |
| `wolfy-reader/core` | ~2.3 kB |
| `wolfy-reader/epub` | ~6.6 kB |
| `wolfy-reader/fb2` | ~3.7 kB |
| `wolfy-reader/text` | ~1.4 kB |

Each subpath has a budget CI refuses to exceed. Format decoders are separate entries on purpose — only `epub` carries the ZIP reader.

## Security

Book content is untrusted input, and it renders behind three independent defences:

- a `sandbox="allow-scripts"` iframe **without** `allow-same-origin`, so the frame's origin is opaque and it can reach nothing of yours;
- allowlist sanitization of every element and attribute before the markup is assembled;
- a per-render `Content-Security-Policy` of `default-src 'none'`, with the book's own images, stylesheets and fonts served as `data:` URLs.

Host and frame talk over one typed, versioned, validated `postMessage` protocol. The layers are not redundant — see [`docs/domains/view.md`](docs/domains/view.md) for why each is load-bearing.

## Formats and legal position

EPUB 2 and 3 (reflowable), FB2, and plain text today; MOBI/AZW3 is planned. Fixed-layout books are *detected* and reported so a host can refuse them — rendering stays reflowable, permanently.

**DRM-free books only.** DRM is permanently out of scope: nothing here decrypts, circumvents, or interoperates with a DRM scheme.

Formats were learned from specifications — the W3C EPUB specs, the MobileRead format wiki, the PalmDB spec — never from GPL source. No code is taken from epub.js, foliate-js, Readium, PDF.js or JSZip.

## Package surface

Five subpaths, written longhand with no wildcards — internal modules are not importable:

| Subpath | Contains |
| --- | --- |
| `wolfy-reader` | `render` + the reader facade, plus everything in `/core` |
| `wolfy-reader/core` | `open`, the `Book` model, `Position`, typed errors — guaranteed headless |
| `wolfy-reader/epub` | the EPUB decoder |
| `wolfy-reader/fb2` | the FB2 decoder |
| `wolfy-reader/text` | the plain-text decoder |

## License

MIT © Vitaliy Tkachuk

---

# Development

Everything below is for working *on* the library rather than with it.

## Stack

- Language: TypeScript — ESM only (`"type": "module"`), no CJS build
- Build system: TypeScript compiler (`tsc`), no bundler; `node:test` for tests, Playwright for browser tests (dev-only)
- Package registry: npm — `wolfy-reader` (unscoped)
- Target platforms / runtimes: Browsers with `DecompressionStream` — Chrome 80+, Safari 16.4+, Firefox 113+

## Getting Started

```bash
npm install
npm run fetch-corpus # download the gitignored test corpus (Gutenberg + Standard Ebooks + W3C)
npm test             # node:test suite, headless — includes the differential decode suite
npm run test:browser # Playwright suites for the sandboxed frame
npm run typecheck    # tsc --noEmit
npm run check:core   # fail if src/core reaches src/layout or src/view
npm run check:guards # fail if dependencies grew or consumer vocabulary leaked in
npm run build        # tsc -> dist (plain ESM + .d.ts + sourcemaps), then the @license banner
npm run check:size   # gzipped bundle budget per published subpath (needs a build)
npm run check:pack   # pack, install the tarball, import and typecheck every subpath
npm run bench        # pagination benchmark (needs the corpus)
```

GitHub Actions runs all of the above on every push to `main` and every pull
request; the Playwright suites run on pull requests only. Node is pinned in
`.nvmrc` so local and CI cannot drift. See
[`docs/domains/release.md`](docs/domains/release.md) for what each guard defends
and why the browser tier is PR-only.

`npm run check:pack` is the only check that exercises the *published* surface: the
demo and the test suites import `/src/...` by path, which the `exports` map does not
govern, so a packaging fault is invisible to them. Run it before any release — see
[`docs/domains/release.md`](docs/domains/release.md).

The differential decode suite (`test/differential.test.ts`) proves the decoders
agree: for each title shipped as both EPUB and TXT, it decodes each, strips
boilerplate, normalizes, and asserts the prose matches across formats. It is
headless and **skips gracefully when the corpus is absent** — run `npm run
fetch-corpus` first to exercise it. This is the safety net MOBI/AZW3 will be
built against.

### Setup on a new machine

A clone gives you the source, the docs, the committed fixtures and the knowledge graph. Four things are deliberately not in the repo and are set up per machine:

```bash
npm install                      # 1. required
npx playwright install chromium  # 2. required for `npm run test:browser` (~115 MB)
npm run fetch-corpus             # 3. optional — real books, ~30 MB, gitignored
graphify hook install            # 4. optional — per-clone, see Knowledge graph below
```

1. **`npm install`** — `dependencies` is permanently empty; this installs the dev toolchain only.
2. **`npx playwright install chromium`** — the `playwright` package has no postinstall step, so `npm install` alone leaves you with no browser and `npm run test:browser` fails. Browser suites launch full Chromium (`channel: 'chromium'`), not the headless shell.
3. **`npm run fetch-corpus`** — downloads Project Gutenberg + Standard Ebooks titles into gitignored `test/corpus/`. Skipping it is safe: corpus-backed tests skip gracefully by rule and `npm test` stays green. Without it, `npm run bench` skips and the benchmark fixtures cannot be generated.
4. **`graphify hook install`** — the git hooks that rebuild the knowledge graph are local-only; a fresh clone has none until you install them.

Everything above is regenerable. The one file that is not in the repo and cannot be rebuilt is the local `PLAN.md` implementation plan — copy it across by hand if you are moving machines mid-project.

> Benchmark timings recorded in [`docs/domains/layout.md`](docs/domains/layout.md) are machine-specific. On different hardware, re-baseline with `npm run bench` and compare the chunked-vs-naive *ratios* (3–7x, far above machine variance) rather than the absolute milliseconds.

## Running Locally

```bash
npm run demo
```

This starts a dependency-free dev server (Node built-ins only) and prints the URL — `http://localhost:8080/` by default, or the next free port if 8080 is busy. It serves exactly two directories: `demo/` (at `/`, so `/` opens the demo) and `src/` (at `/src/`, so the demo can import library modules); no other repo path is reachable. `.ts` files are served with type annotations stripped (`node:module`'s `stripTypeScriptTypes`), so the browser runs the TypeScript sources directly — no bundler, no build step.

The demo is the primary development surface: pick an EPUB and it opens the book through the public API and shows what the decoder produced — metadata and cover, the nested table of contents, and the reading order. Clicking a chapter renders it as live markup inside the hardened sandboxed frame, with the book's own stylesheets and images, next to a panel listing everything the sanitizer removed and everything the Content Security Policy blocked. Decode failures surface as the library's typed errors by class name. It stays framework-free by rule. Opening `demo/index.html` as a `file://` URL does not work — browsers block ES module loading over `file://`.

## Building & Releasing

```bash
npm run build      # tsc -> dist (plain ESM + .d.ts + sourcemaps), then the @license banner
npm run check:pack # pack, install the tarball, import and typecheck every subpath
```

Releases are pull requests. [release-please](https://github.com/googleapis/release-please)
keeps one open on `main`, carrying the version bump and the `CHANGELOG.md` entry it
derives from the Conventional Commit subjects since the last tag. Merging it tags the
release and publishes to npm from GitHub Actions, authenticated by OIDC trusted
publishing with provenance — there is no `NPM_TOKEN` in this repository and no manual
`npm publish` step. The publish job re-runs the full check suite first, because a
bot-opened pull request does not run CI until a maintainer approves it. After
publishing, a smoke job installs the released version from the registry and
imports every subpath
(`npm run check:pack -- --from-registry=<version>`).

See [`docs/domains/release.md`](docs/domains/release.md) for the flow and the
one-time bootstrap that had to be done by hand.

## Working with AI agents

This repo uses a [lightweight spec-driven workflow](https://github.com/vitaliy-tkachuk/ai-spec-template). AI agents (Claude Code, Cursor, Codex, Copilot, Aider, etc.) follow the rules in [`AGENTS.md`](AGENTS.md).

Key docs:

- [`AGENTS.md`](AGENTS.md) — canonical instructions for AI agents
- [`docs/feature-workflow.md`](docs/feature-workflow.md) — complexity levels (0–3) and required artifacts
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/coding-conventions.md`](docs/coding-conventions.md) — coding conventions
- [`docs/patterns.md`](docs/patterns.md) — cross-domain reusable patterns
- [`docs/domains/`](docs/domains/) — per-domain durable knowledge (the permanent record)

Architectural decisions live in `docs/architecture.md`. Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored.

### Knowledge graph

If `graphify-out/graph.json` is present, it is a committed [graphify](https://github.com/safishamsi/graphify) knowledge graph of this repo. Agents query it before reading files (`graphify query "<question>"`), which is far cheaper than sweeping the tree — see [`AGENTS.md`](AGENTS.md#knowledge-graph--query-it-first-to-save-tokens).

The graph auto-rebuilds after each commit via local git hooks. Those hooks are not committed, so run `graphify hook install` once per clone. If the repo has no graph yet, build one with `/graphify .` and commit `graphify-out/`.

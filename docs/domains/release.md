# Release domain

## Overview

Everything between the source tree and a tarball a stranger can install: the build
(`tsconfig.build.json` → `dist`), the `exports` map that defines the public surface,
the `@license` banner (`scripts/banner.mjs`), and the pack-fidelity check
(`scripts/check-pack.mjs`) that proves the packed tarball is actually consumable.

Publishing itself is not here yet — there is no release workflow, no CHANGELOG, and
no registry credentials. The package builds and packs correctly; pushing it is
separate work.

## Key decisions

- **Five subpaths, no wildcards: `.`, `/core`, `/epub`, `/fb2`, `/text`** (plus
  `./package.json`). The map is the only thing enforcing public-vs-internal at
  runtime, so it is written out longhand — a wildcard would publish the whole tree.

- **One subpath per format, not a `./formats` barrel.** The decoders' emitted
  closures differ by an order of magnitude — `text` reaches 3 modules, `fb2` 10,
  `epub` 20 (7 of them the ZIP reader, which neither other format touches). With
  `"sideEffects": false` a bundler *would* tree-shake a barrel, so a barrel is
  weight-neutral for bundling consumers and never wins; the cost lands entirely on
  consumers that do not bundle — plain Node, `<script type="module">`, import maps —
  where a TXT-only page would fetch 23 modules instead of 3. A barrel is also
  additive later and breaking to remove, so per-format is the smaller commitment.
  `src/formats/index.ts` stays as an internal convenience for tests and the demo; it
  is deliberately not in `exports`.

- **Subpaths are named for the format, not the file extension** — `./text`, not
  `./txt`, matching `src/formats/text/`, `export const text`, and the format's own
  `name: 'text'`. The no-format-vocabulary rule constrains the *package* name only.

- **The root `.` carries the reader facade *and* the core surface.** `render` takes a
  `Book` and `open` is the only public way to make one, so splitting them would make
  the common case a three-import dance; the facade's own signatures already name
  `Position`, `TocItem` and `SentenceRange`. Both re-exports resolve to the same
  emitted modules as `/core`, so there is one `open`, one `Position` model and one
  set of error constructors however a consumer reaches them — `instanceof BookError`
  holds across entries, and the fidelity check asserts exactly that.

- **`/core` remains the headless entry and the root is not a substitute.** The root
  reaches `src/layout` and `src/view` (26 modules against core's 6). No view module
  touches `document`/`window` at module scope, so a Node consumer importing the root
  gets dead weight rather than a throw — but only `/core` carries the *guarantee*,
  enforced by `npm run check:core`. Headless consumers are pointed at `/core`.

- **`files: ["dist", "src"]`.** `tsc` does not inline sources, so every `.js.map` and
  `.d.ts.map` points out of `dist` and into `src`. Shipping `dist` alone produces a
  tarball that installs, imports and typechecks perfectly while every stack trace and
  go-to-definition lands nowhere.

- **The banner goes on subpath entry files only, never on every emitted module.**
  Minifiers do not dedupe legal comments, so blanket-prepending would litter a
  consumer bundle with copies, while a tree-shaken-away module takes its banner with
  it. The `/*!` form plus the `@license` marker is what esbuild, Terser and Rollup
  keep by default — a plain `/*` comment is stripped and the MIT attribution dies in
  the consumer's build step.

- **`prepack` runs the build, so `npm pack` and `npm publish` can never ship a stale
  `dist`.** The fidelity check packs through that same lifecycle rather than reading
  whatever is sitting in `dist`, which is what makes it a test of the real publish
  path.

## Implementation notes

- `npm run build` = `clean` → `tsc -p tsconfig.build.json` → `node scripts/banner.mjs`.
  The build config extends the root `tsconfig.json` and only overrides emit settings
  (`rootDir: src`, `outDir: dist`, declarations, both map kinds) plus
  `include: ["src"]`, so `test/` is typechecked by `npm run typecheck` but never
  emitted. `allowImportingTsExtensions` stays on: it is legal alongside emit because
  `rewriteRelativeImportExtensions` is what turns `./errors.ts` into `./errors.js`.

- `scripts/banner.mjs` derives the entry list from `package.json`'s `exports` rather
  than hardcoding paths, so `/mobi` and `/react` will be bannered the day they are
  added. It exports `banner` (the full comment), `attribution` (the same text without
  delimiters) and `entryFiles()`, which `check-pack.mjs` imports — so the two scripts
  cannot disagree about what a banner is.

- **Prepending the banner rewrites the sibling `.js.map`.** Adding a line shifts every
  mapping one line out of register; `mappings` is semicolon-delimited per output
  line, so one leading `;` per added line puts it back. Without this, published
  sourcemaps are silently off-by-one.

- `npm run check:pack` packs, installs the tarball into a scratch consumer under
  `os.tmpdir()`, and runs nine assertions: `dependencies` is empty; `exports` has no
  wildcards and no subpath the script does not test; every subpath imports under plain
  Node with no DOM; each format subpath exposes a real `BookFormat` (`name`, `sniff`,
  `decode`); the root and `/core` share one `BookError` and one `open`; four internal
  paths are refused with `ERR_PACKAGE_PATH_NOT_EXPORTED`; a consumer `.ts` typechecks
  against the published `.d.ts` under `nodenext`; every source map resolves to a
  shipped source; and the banner is present and survives an esbuild minify. The
  workspace is deleted on success and kept, with its path printed, on failure.

- **The subpath table in `check-pack.mjs` is the single source of truth.** It drives
  the generated runtime probe, the type probe and the banner check, and the manifest
  check fails on any `exports` key not in it — so a new subpath cannot be added and
  silently go untested.

## Gotchas

- **esbuild rewrites the banner when the source is inside `node_modules`.** It hoists
  legal comments into a trailing `Bundled license information` block and rewrites the
  inner `/*!` … `*/` as `(*!` … `*)`, because `*/` cannot nest. The banner therefore
  does **not** appear verbatim in a real consumer bundle. Assert on the attribution
  text, never on the literal comment — a check that greps for `/*!` passes in `dist`
  and fails against the thing that actually ships.

- **A runtime import cannot catch a broken `.d.ts`.** Emitted JS gets `.js`
  specifiers while emitted `.d.ts` keeps `.ts` ones — both correct under
  `rewriteRelativeImportExtensions`, and a `nodenext` consumer resolves the `.ts`
  form fine. But the two are emitted by different machinery, so only a real `tsc` run
  against the installed package exercises the declaration path. That is why the
  fidelity check compiles a consumer `.ts` instead of only importing.

- **`npm pack --json` is not reliably JSON.** Lifecycle scripts print to the same
  stdout, so `prepack` output lands inside it. The tarball name is derived from
  `name` + `version` instead, and `banner.mjs` writes its progress to stderr.

- **`banner.mjs` must not act on import.** `check-pack.mjs` imports it for the banner
  text, so the prepend pass is guarded behind a direct-execution check; without it,
  importing the module rewrites `dist` as a side effect.

- A missing `exports` target surfaces during `prepack`, where a raw `ENOENT` stack is
  useless. `banner.mjs` names the offending subpath instead, and `check-pack.mjs`
  reports a failed pack or install as a finding rather than letting the lifecycle
  stack escape.

- The `exports` map means the demo and browser harness are unaffected by packaging:
  they import `/src/...` by path, which `exports` does not govern. Packaging changes
  cannot be validated through the demo — `npm run check:pack` is the only surface
  that exercises the published shape.

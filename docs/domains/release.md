# Release domain

## Overview

Everything between the source tree and a tarball a stranger can install: the build
(`tsconfig.build.json` → `dist`), the `exports` map that defines the public surface,
the `@license` banner (`scripts/banner.mjs`), the pack-fidelity check
(`scripts/check-pack.mjs`) that proves the packed tarball is actually consumable,
the repo guards (`scripts/check-guards.mjs`), the per-subpath size budget
(`scripts/check-size.mjs`), and the GitHub Actions workflow
(`.github/workflows/ci.yml`) that runs the lot.

Publishing itself is not here yet — there is no release workflow, no CHANGELOG, and
no registry credentials. The package builds, packs and is continuously checked;
pushing it is separate work.

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

- **`README.md` is the package page, and four of its claims are load-bearing.** npm
  renders it verbatim and caches it *per version*, so it is part of the release
  surface rather than repo furniture. It opens for a stranger deciding whether to
  install — what the library does, `npm install`, a working example — and everything
  about developing the library sits below a `# Development` divider. Four statements
  must survive every edit: zero ***runtime*** dependencies (the qualifier is not
  optional — four devDependencies exist), the stability contract (`Book` and
  `Position` are the semver promise, honestly `0.x` until a real consumer has
  exercised them), the browser baseline (`DecompressionStream`: Chrome 80+, Safari
  16.4+, Firefox 113+, ESM only), and the DRM-free legal position. The first three
  are the entire pitch; the fourth is a legal position, not a feature note.

- **CI guards what a reviewer cannot see, and there is no lint job because there is
  no linter.** Formatting is hand-maintained by rule, so the workflow spends its
  minutes on the constraints that are invisible in a diff: the dependency count, the
  core → view layer boundary, the gzipped weight of each subpath, and the shape of
  the published tarball. A reviewer can see a misplaced brace; nobody can see that a
  one-line import just put the renderer inside the headless entry.

- **The browser tier runs on pull requests, not on pushes to `main`.** Full Chromium
  plus the corpus is the expensive half of the run, and the assumption it rests on is
  that work reaches `main` through a pull request. If direct pushes become normal the
  view invariants stop being guarded, and the `if` condition on the `browser` job is
  the thing to revisit — not the suites.

- **CI must never be allowed to pass by skipping.** Every corpus-backed test skips
  gracefully when `test/corpus/` is absent, which is correct for a fresh clone and
  fatal in CI: a failed download would leave the differential suite reporting green
  having compared nothing. `check:guards --require-corpus` asserts every file the
  fetch script intends to download is present, and the fetch itself exits non-zero
  rather than being tolerated with `continue-on-error`. The flag is opt-in precisely
  so a local run stays green before anyone downloads 31MB of books.

- **Size budgets are gzipped bytes of the minified bundle, held in source.** What
  matters is what a consumer's build ships, not what sits in `dist`, so each subpath
  entry is bundled and minified through esbuild and gzipped. The budgets live in
  `check-size.mjs` rather than a generated lockfile because raising one should be a
  decision with a reason attached, visible in a diff. They are measured values plus
  roughly 25% headroom — every subpath currently sits at 78–80% of its budget, which
  is the calibration to keep: loose enough that honest growth does not redden `main`,
  tight enough that an accidental import across a layer boundary does. A format
  subpath that quietly picked up the ZIP reader would roughly double and trip
  immediately.

- **A new subpath without a budget is a failure, not a default.** `check-size.mjs`
  reports the measured size and refuses, the same way `check-pack.mjs` refuses an
  `exports` key missing from its table. A guard that silently ignores what it has
  not been told about is not a guard.

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

- `.github/workflows/ci.yml` has two jobs, both on `ubuntu-latest`, both reading Node
  from `.nvmrc`. `check` runs on push to `main`, on pull requests and on manual
  dispatch: `npm ci` → `typecheck` → `check:core` → corpus cache + `fetch-corpus` →
  `check:guards --require-corpus` → `build` → `npm test` → `check:size` →
  `check:pack`. `browser` runs on pull requests and manual dispatch only: the same
  setup plus a cached Chromium and the corpus, then `test:browser`. The run is
  `concurrency`-grouped per ref with `cancel-in-progress`, and `permissions` is
  `contents: read` — nothing in CI writes anything.

- **Two caches, keyed on what actually invalidates them.** The corpus is keyed on
  `hashFiles('scripts/fetch-corpus.mjs')`, so adding a title invalidates it by
  itself and an ordinary run touches no upstream server; `fetch-corpus` is idempotent
  and makes no request when every file is already present. The Playwright browsers
  are keyed on the lockfile: it is what moves Playwright's version, and with four
  devDependencies the occasional redundant download is cheaper than a shell step to
  read the resolved version.

- `scripts/check-guards.mjs` runs three checks and reports every violation in one
  pass: `dependencies` is empty; no term from the consuming application's vocabulary
  appears in `src/`, `demo/` or `test/`; and, under `--require-corpus`, the corpus is
  complete. `--root=<dir>` points it at a scratch tree, which is how its own failure
  paths are tested. `check-core-purity.mjs` gained the same `--root` for the same
  reason; it is otherwise unchanged, having shipped long before CI existed.

- **The corpus manifest has one home.** `check-guards.mjs` imports `downloads` from
  `fetch-corpus.mjs` rather than restating the expected file list, so "complete"
  means exactly "everything the fetch script intends to download". The fetch script
  therefore guards its own download pass behind a direct-execution check — importing
  it must not start downloading, the same rule `banner.mjs` follows.

- **Measured gzipped sizes at the time the budgets were set** (minified bundle,
  esbuild, `target: es2022`): `.` 30,324 / 38,000 · `/core` 2,348 / 3,000 · `/epub`
  6,562 / 8,250 · `/fb2` 3,693 / 4,750 · `/text` 1,399 / 1,750. The root is an order
  of magnitude larger than `/core` because it carries the paginator and the view;
  that ratio is the thing the budget is really watching.

- **`check-size.mjs` pins esbuild's `target` to `es2022`.** The default target drifts
  with esbuild's version, which would move every number here for reasons that have
  nothing to do with the library and quietly spend the headroom.

- **Guard tests are the deliberate-violation proof** (`test/guards.test.ts`). Each
  guard is run against a scratch tree that violates it — an added dependency, a
  vocabulary term, a missing corpus, a core module importing the view, a one-byte
  budget — and asserted to exit non-zero naming the offence, then run against a clean
  tree and asserted to pass. A guard nobody has ever seen fail is indistinguishable
  from a guard that cannot fail.

- **Every README sample is verified against the real exports before it ships.** The
  samples are the most-read code in the project and nothing tests them: they call
  `render(book, element, options)` from the root, take an explicit `formats` list,
  and import only published subpaths — never `/src/...`, which the `exports` map
  refuses. The PLAN's `book.render(...)` sketch never existed; the README follows the
  code, and `scripts/check-pack.mjs`'s subpath table is the authority on what a
  reader is allowed to type.

## Gotchas

- **npm caches the README per published version.** The page frozen onto a version is
  whatever shipped with it, so prose can only be fixed forward by publishing again.
  README work lands *before* a release, never after.

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

- **Never write the consuming application's vocabulary anywhere under `docs/`.** The
  guard scans source, not docs, but the terms are deliberately confined to
  `scripts/check-guards.mjs` so that no document ever has to be carved out of a scan
  that later widens. Refer to "the term list in `check-guards.mjs`" instead — and
  note `test/guards.test.ts` assembles its fixture term from fragments for exactly
  this reason, since `test/` *is* scanned.

- **`test/corpus/` is carved out of the vocabulary scan because real books use the
  words** — a Victorian detective sends a great many messages by wire. `bench/fixtures/`
  is generated from that same prose and sits outside the scanned roots. A guard that
  fails on the corpus it exists to protect gets switched off within a week, so the
  carve-out has its own test.

- **Anything that measures `dist/` skips silently when it is absent**, which is why
  CI builds *before* it tests rather than after. `check:size` reports a skip, and the
  two size cases in `test/guards.test.ts` skip themselves — on a fresh checkout that
  would quietly retire the budget and its own failure-path proof while still
  reporting success. The build step is cheap; the vacuous pass is not.

- **A `.ts` test cannot statically import the `.mjs` scripts**: the tsconfig has no
  `allowJs`, so `tsc` would demand a declaration file. `test/guards.test.ts` reaches
  the corpus manifest through a computed dynamic specifier, which tsc does not
  resolve and Node loads normally.

- **`npm run check:pack` needs registry reachability** — it shells out to `npm pack`
  and `npm install <tarball>`. That is free on a GitHub-hosted runner, but it is the
  step most likely to fail for reasons that have nothing to do with the change.

- **A CI runner's speed is not a constant, so no test may assert wall-clock
  milliseconds.** The same commit measured 574 ms and then 1139 ms for identical work
  on consecutive `browser` runs. The corpus timing budget in the layout suite
  therefore measures a fixed text-layout loop in the same run and asserts the
  paginator's cost as a multiple of that unit — see [`layout.md`](layout.md). A guard
  that compares against a number recorded on someone's laptop reports the runner's
  mood, not a regression.

# Contributing

Everything here is for working *on* wolfy-reader rather than with it. For what the library does and how to use it, see [`README.md`](README.md).

## Stack

- TypeScript, ESM only (`"type": "module"`), no CJS build
- `tsc` for the build, no bundler; `node:test` for tests, Playwright for browser tests
- Published to npm as `wolfy-reader` (unscoped)
- Targets browsers with `DecompressionStream` — Chrome 80+, Safari 16.4+, Firefox 113+

## Setup on a new machine

```bash
npm install                      # 1. required
npx playwright install chromium  # 2. required for `npm run test:browser` (~115 MB)
npm run fetch-corpus             # 3. optional — real books, ~30 MB, gitignored
graphify hook install            # 4. optional — per-clone, see Knowledge graph below
```

1. **`npm install`** — `dependencies` is permanently empty; this installs the dev toolchain only.
2. **`npx playwright install chromium`** — the `playwright` package has no postinstall step, so `npm install` alone leaves you with no browser. Browser suites launch full Chromium (`channel: 'chromium'`), not the headless shell.
3. **`npm run fetch-corpus`** — downloads Project Gutenberg + Standard Ebooks titles into gitignored `test/corpus/`. Skipping it is safe: corpus-backed tests skip gracefully by rule and `npm test` stays green. Without it, `npm run bench` skips.
4. **`graphify hook install`** — the git hooks that rebuild the knowledge graph are local-only; a fresh clone has none until you install them.

Everything above is regenerable. The one file not in the repo and not rebuildable is the local `PLAN.md` implementation plan — copy it across by hand if you are moving machines mid-project.

## Checks

```bash
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

GitHub Actions runs all of the above on every push to `main` and every pull request; the Playwright suites run on pull requests only. Node is pinned in `.nvmrc`. See [`docs/domains/release.md`](docs/domains/release.md) for what each guard defends and why the browser tier is PR-only.

`npm run check:pack` is the only check that exercises the *published* surface: the demo and the test suites import `/src/...` by path, which the `exports` map does not govern, so a packaging fault is invisible to them. Run it before any release.

The differential decode suite (`test/differential.test.ts`) proves the decoders agree: for each title shipped as both EPUB and TXT, it decodes each, strips boilerplate, normalizes, and asserts the prose matches across formats. It skips gracefully when the corpus is absent. This is the safety net MOBI/AZW3 will be built against.

Benchmark timings recorded in [`docs/domains/layout.md`](docs/domains/layout.md) are machine-specific. On different hardware, re-baseline with `npm run bench` and compare the chunked-vs-naive *ratios* (3–7x) rather than absolute milliseconds.

## Demo

```bash
npm run demo
```

Starts a dependency-free dev server (Node built-ins only) and prints the URL — `http://localhost:8080/` by default, or the next free port. It serves exactly two directories: `demo/` at `/` and `src/` at `/src/`; nothing else in the repo is reachable. `.ts` files are served with type annotations stripped (`node:module`'s `stripTypeScriptTypes`), so the browser runs the TypeScript sources directly — no bundler, no build step.

The demo is the primary development surface: pick an EPUB and it opens the book through the public API and shows what the decoder produced — metadata and cover, the nested TOC, the reading order. Clicking a chapter renders it inside the hardened sandboxed frame next to a panel listing everything the sanitizer removed and everything the CSP blocked. Decode failures surface as the library's typed errors by class name. It stays framework-free by rule. Opening `demo/index.html` over `file://` does not work — browsers block ES module loading there.

## Releasing

```bash
npm run build      # tsc -> dist, then the @license banner
npm run check:pack # pack, install the tarball, import and typecheck every subpath
```

Releases are pull requests. [release-please](https://github.com/googleapis/release-please) keeps one open on `main`, carrying the version bump and the `CHANGELOG.md` entry it derives from Conventional Commit subjects since the last tag. Merging it tags the release and publishes to npm from GitHub Actions, authenticated by OIDC trusted publishing with provenance — there is no `NPM_TOKEN` in this repository and no manual `npm publish` step. The publish job re-runs the full check suite first, because a bot-opened pull request does not run CI until a maintainer approves it. After publishing, a smoke job installs the released version from the registry and imports every subpath (`npm run check:pack -- --from-registry=<version>`).

npm caches `README.md` per published version, so README work lands *before* a release. See [`docs/domains/release.md`](docs/domains/release.md) for the flow and the one-time bootstrap that had to be done by hand.

## Working with AI agents

This repo uses a [lightweight spec-driven workflow](https://github.com/vitaliy-tkachuk/ai-spec-template). AI agents (Claude Code, Cursor, Codex, Copilot, Aider, etc.) follow the rules in [`AGENTS.md`](AGENTS.md).

- [`AGENTS.md`](AGENTS.md) — canonical instructions for AI agents
- [`docs/feature-workflow.md`](docs/feature-workflow.md) — complexity levels (0–3) and required artifacts
- [`docs/architecture.md`](docs/architecture.md) — system architecture and cross-cutting decisions
- [`docs/coding-conventions.md`](docs/coding-conventions.md) — coding conventions
- [`docs/patterns.md`](docs/patterns.md) — cross-domain reusable patterns
- [`docs/domains/`](docs/domains/) — per-domain durable knowledge (the permanent record)

Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored.

### Knowledge graph

If `graphify-out/graph.json` is present, it is a committed [graphify](https://github.com/safishamsi/graphify) knowledge graph of this repo. Agents query it before reading files (`graphify query "<question>"`), which is far cheaper than sweeping the tree — see [`AGENTS.md`](AGENTS.md#knowledge-graph--query-it-first-to-save-tokens).

The graph auto-rebuilds after each commit via local git hooks. Those hooks are not committed, so run `graphify hook install` once per clone. If the repo has no graph yet, build one with `/graphify .` and commit `graphify-out/`.

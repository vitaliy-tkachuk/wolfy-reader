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

## Developing a consumer against source

When an app that depends on `wolfy-reader` is being built alongside a change to the library, point the app at a local checkout's TypeScript source with one environment variable instead of a `file:` or `link:` dependency. The app's `package.json` keeps the ordinary registry dependency and its lockfile never carries a local path, so a production build cannot inherit one by accident; the alias exists only in the shell that set the variable.

```bash
READER_SRC=/path/to/wolfy-reader npm run dev   # or vite build
```

Add this to the app's `vite.config.ts`. It reads the library's `exports` map and aliases every published subpath — `wolfy-reader`, `/core`, `/epub`, `/fb2`, `/text`, and whatever is added later — to the matching `src/**/index.ts`, so a new subpath needs no change here. With `READER_SRC` unset the function is never called and the config is your app's own.

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, mergeConfig, searchForWorkspaceRoot } from 'vite';
import type { Alias, UserConfig } from 'vite';

// Your app's ordinary config. Nothing below changes it unless READER_SRC is set.
const app: UserConfig = {
  define: { __WOLFY_READER_SRC__: 'null' },
};

// Point `wolfy-reader` and every published subpath at a local checkout's TypeScript
// source. Set READER_SRC=/path/to/wolfy-reader; leave it unset to use node_modules.
function readerFromSource(root: string): UserConfig {
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
    name: string;
    exports: Record<string, string | { default: string }>;
  };
  const alias: Alias[] = [];
  for (const [subpath, target] of Object.entries(pkg.exports)) {
    const entry = typeof target === 'string' ? target : target.default;
    if (!entry.startsWith('./dist/')) continue;
    const specifier = pkg.name + subpath.slice(1);
    const source = entry.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts');
    const escaped = specifier.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
    alias.push({ find: new RegExp(`^${escaped}$`), replacement: resolve(root, source) });
  }
  console.warn(`\n  wolfy-reader is served from source: ${root}\n`);
  return {
    resolve: { alias },
    server: { fs: { allow: [searchForWorkspaceRoot(process.cwd()), root] } },
    define: { __WOLFY_READER_SRC__: JSON.stringify(root) },
  };
}

const readerSrc = process.env.READER_SRC;

export default defineConfig(
  readerSrc ? mergeConfig(app, readerFromSource(resolve(readerSrc))) : app,
);
```

Declare the constant once in the app's `vite-env.d.ts` and render it somewhere visible, so a tab served from source says so:

```ts
declare const __WOLFY_READER_SRC__: string | null;
```

What each part is for:

- **Exact-match aliases** (`/^wolfy-reader\/epub$/`, not a prefix) mean the order of the entries does not matter, which is what makes deriving the list from `exports` safe. The library's sources import each other with explicit `.ts` extensions, which Vite resolves as-is — the checkout needs no build.
- **`server.fs.allow`** is required: the checkout is outside the app's root and Vite's dev server refuses to serve it otherwise (a 403 on `/@fs/...`). Setting `allow` switches off Vite's automatic workspace-root detection, so the app's own root has to be put back with `searchForWorkspaceRoot`.
- **The banner** is printed when the config is evaluated and stamped into the bundle through `define`, so both the terminal and the page say where the library came from. Both are inert when the variable is unset.
- Once a `/react` subpath ships, add `resolve: { dedupe: ['react', 'react-dom'] }` to the returned config so the aliased source and the app share one React.

Two rules that follow from it:

- **Typechecking stays on the installed package.** The alias is a Vite resolution only; `tsc` and the editor keep resolving `wolfy-reader` to `node_modules`. A `paths` entry in `tsconfig.json` would put a local path back into a committed file, which is the thing this pattern exists to avoid, so there is none. API that exists only in the checkout is invisible to the app's typecheck until it is published — which is the right pressure.
- **`npm run check:pack` before any release, without exception.** An app developed against source never touches `dist`, the `exports` map, the emitted `.d.ts` or the `@license` banner — exactly the surfaces the fidelity check exercises. Aliasing hides packaging faults; the check is what finds them.

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

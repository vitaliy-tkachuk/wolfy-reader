# Coding Conventions

## General

- Prefer simple, readable code.
- Avoid unnecessary abstractions.
- Keep functions small and focused.
- Prefer explicit names over clever shortcuts.
- Keep domain logic close to the feature that owns it.

## Testing

- Add tests for meaningful business logic.
- Add regression tests for fixed bugs when practical.
- Do not write low-value tests only to satisfy process.
- **Headless `node:test` is the default tier.** Decoders, parsers, and model logic are tested without a browser. Reach for a browser only when a browser is genuinely load-bearing — layout, rendering, input, the sandboxed frame — and say in the task what makes it so.
- **Fixtures are committed; the corpus is not.** Small, license-clean, hand-authored fixtures live in `test/fixtures/` and pin exact behavior. Real books in `test/corpus/` are downloaded and gitignored, so every corpus test skips gracefully when the directory is absent — it must never fail for a missing download.
- **Generate format fixtures with more than one writer.** Real-world files vary in ways a single tool cannot show; a fixture set produced by one writer proves only that the code reads that writer's output.
- **Assert the payload, not just the shape.** A decoder that returns a well-formed object whose content cannot be loaded still passes a structural test. Where a test can compare real bytes, compare them.

## Demonstrating

- **Every user-facing capability lands with a way to see it work.** `/demo` is the primary development surface, not an afterthought — if a feature changes what the library can do, the demo shows it in the same unit of work.
- A task with nothing to demonstrate says so explicitly. "Headless-only, nothing user-facing" is a valid answer; silence is not.
- `/demo` stays a harness with a UI, framework-free by rule. It must not grow into a polished reading app — that is a different product.

## Documentation

- Update docs only when behavior, architecture, or durable project knowledge changes.
- Do not document trivial implementation details.

## Comments

- Default to no comments. Well-named identifiers explain *what* — let them.
- Write a comment only when the *why* is non-obvious: hidden constraint, subtle invariant, workaround for a specific bug, behavior that would surprise a reader.
- Never explain *what* the code does, never narrate the diff ("added for X", "used by Y", "fix for issue #123"). That belongs in the commit message or PR description and rots as the codebase evolves.
- No commented-out code. Delete it — git remembers.
- No TODO/FIXME without an owner and a tracked task reference. Untracked TODOs accumulate forever.
- Public API surfaces (exported functions, types, modules) may carry one short doc comment when the signature alone does not convey usage. Keep it to one or two lines.

## Dependencies

- Always install the latest stable release when adding or upgrading a dependency. Exclude prereleases, betas, RCs, alphas, and nightly builds.
- Verify the latest stable version before installing (e.g. `npm view <pkg> version`, `pip index versions <pkg>`, `cargo search <pkg>`) rather than relying on training data.
- Commit the lockfile alongside the manifest in the same change.
- If a non-latest version is required (peer-dep conflict, known regression, framework constraint), record the reason in `docs/architecture.md` (or the relevant `docs/domains/<domain>.md` if it only affects one domain).

## Secrets

- Never commit secrets (`.env`, API keys, tokens, credentials, private keys). Add `.env` and other secret files to `.gitignore`; commit `.env.example` with placeholder values only.
- Read secrets from environment variables at runtime, not from source.
- If a secret is committed by mistake, rotate it immediately — scrubbing git history does not undo exposure.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit. Format: `<type>(<optional scope>): <description>`.
- Allowed types: `feat`, `fix`, `perf`, `refactor`, `docs`, `test`, `build`, `ci`, `chore`, `revert`.
- `feat` and `fix` drive user-visible changelog entries — reserve them for behavior changes. Use `chore`/`refactor`/`docs` for everything else.
- Breaking changes: append `!` after the type/scope (e.g. `feat(api)!: ...`) **and** add a `BREAKING CHANGE: <description>` footer.
- Subject line ≤ 72 chars, imperative mood, no trailing period.
- Body explains *why* when the change is not obvious from the diff. Wrap at ~72 chars.
- One logical change per commit. Do not bundle unrelated fixes.

## Language & framework specifics

### TypeScript / ESM

- Strict mode is non-negotiable: `strict` plus `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noFallthroughCasesInSwitch`, `verbatimModuleSyntax`. Fix the type instead of weakening a compiler option.
- ESM only. No CJS anywhere — no `require`, no CJS build, `"type": "module"` stays.
- Relative imports carry an explicit `.ts` extension. `rewriteRelativeImportExtensions` turns them into `.js` on emit, so published output stays plain ESM while Node runs the sources directly under type stripping — no build step between writing a test and running it.
- Type-only imports use `import type` (enforced by `verbatimModuleSyntax`).
- Formatting is uniform and hand-maintained (there is no formatter yet): semicolon-terminated statements, single-quoted strings, trailing commas in multi-line literals, two-space indent. Match `src/core` — it is the frozen public surface and the reference for style.
- Platform primitives over dependencies: `DecompressionStream`, `DOMParser`, `TextDecoder`, `Intl.Segmenter`, CSS multi-column, `node:test` — never a package that reimplements what the platform ships. `dependencies` in `package.json` stays `{}` permanently.
- Tests are TypeScript (`test/**/*.test.ts`), run under `node:test` with `node:assert/strict`, and import source through its real path (`../src/zip/index.ts`). Decoder tests stay headless — no browser.

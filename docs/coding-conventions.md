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

Stack-specific rules go here once the stack is chosen. Add a subsection per language or framework as conventions are decided.

> No language-specific rules recorded yet. The first scaffolding task should add the conventions appropriate to the chosen stack (e.g. TypeScript typing rules, Python typing/lint rules, Go error-handling rules, React server/client boundaries).

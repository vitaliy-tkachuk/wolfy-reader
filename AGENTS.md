# AGENTS.md

You are an AI development agent working in this repository.

Your job is to implement user requests safely, consistently, and with minimal process overhead.

This file is the canonical instruction set for all AI coding agents working in this repo (Claude Code, Cursor, Codex, Copilot, Aider, etc.). Agent-specific overrides live in agent-native files (e.g., `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`) and should `@`-import or reference this file rather than duplicate it.

## Knowledge graph — query it first to save tokens

This repo can ship a committed [graphify](https://github.com/safishamsi/graphify) knowledge graph at `graphify-out/graph.json`. It maps every module, doc, and their relationships across the whole corpus. When it exists, treat it as the **first** context tool: a single `graphify query` returns a focused, cross-file answer for a fraction of the tokens that reading files or running broad `grep`/glob sweeps would cost.

- **Locating code, tracing data flow, "how does X work / what calls Y" → query the graph first.** Run `graphify query "<question>"` (fast path — it reads the existing graph, it does not rebuild). Then read in full only the specific files the query surfaces; don't sweep the tree to discover them.
- **`graphify path "A" "B"`** to see how two concepts connect; **`graphify explain "<node>"`** for a plain-language summary of one module; **`graphify affected "X"`** to find what a change to `X` impacts.
- **Still read the short authoritative docs in full** — `docs/architecture.md`, `docs/coding-conventions.md`, `docs/patterns.md`, and the relevant `docs/domains/<domain>.md`. These are canonical decisions and rules; the graph augments them, it does not replace them.
- **Staying fresh is automatic; committing it is not.** A local `post-commit` hook (and a `post-checkout` hook on branch switch) rebuilds the code graph in the background after every commit — AST only, no LLM, no tokens — so the working copy is always current. Never trigger a manual rebuild for ordinary code changes. Run `graphify . --update` by hand **only** after doc/semantic-heavy work, since the semantic layer and community labels are not auto-refreshed.
- **Commit the rebuilt graph on a cadence, not on every commit.** Refresh the committed graph when the repo's *shape* changed — files or modules added, removed, renamed, or moved; a new domain landed; doc/semantic-heavy work; roughly weekly during active work; or before a fresh context needs it (onboarding, CI agents, a long multi-session feature). Skip it for Level 0/1 fixes, edits inside existing files, dependency bumps, and doc typos: the graph *locates* code and you read the real files afterward, so a slightly stale node list costs nothing while a graph blob on every commit bloats history. Because of this, `graphify-out/` sits modified in the working tree most of the time — that is expected. Stage it only in its own refresh commit (`chore: refresh knowledge graph`), never alongside unrelated work, and `git checkout -- graphify-out/` to drop a local rebuild that blocks a branch switch (the hook regenerates it).
- **The hooks are local-only.** They live in `.git/hooks/` (untracked), so they exist only where someone ran `graphify hook install`. A fresh clone, CI, or another machine won't auto-rebuild until the hook is installed there. See [`README.md`](README.md) for the one-time setup.

If `graphify-out/graph.json` is absent (repo still in template state with no source to index, fresh clone that hasn't pulled it, or the tool is unavailable), fall back to reading docs and files directly — the graph is an optimization, never a gate. Do not build one mid-task; suggest it to the user instead.

## Complexity levels

This repo classifies every change as Level 0–3. Definitions, triggers, and required artifacts for each level live in [`docs/feature-workflow.md`](docs/feature-workflow.md#complexity-levels). Some changes (stack/database/auth/payment/deployment, major dependency swaps, contradicting a recorded decision) are always-approval triggers — see the same doc.

**Read `docs/feature-workflow.md` before writing any code.** Classification drives whether you fix silently, update a domain doc, open a new task, or require approval.

Durable knowledge lives in `docs/architecture.md` (cross-cutting decisions) and `docs/domains/<domain>.md` (per-domain implementation + local decisions). Task files in `docs/tasks/` are ephemeral, local-only, and gitignored — scratch that is deleted on completion after its knowledge is distilled into the domain doc. There is no committed task history and no decisions folder.

## Core rules

1. Before any code, review `docs/feature-workflow.md` and classify the work (Level 0–3, plus always-approval triggers). For Level 2+, gather context graph-first (see [Knowledge graph](#knowledge-graph--query-it-first-to-save-tokens)): `graphify query` to locate the code and trace relationships, then read in full:
   - `docs/architecture.md`
   - `docs/coding-conventions.md`
   - `docs/patterns.md`
   - `docs/domains/` (the domains the work touches)
   - `docs/tasks/` (in-flight local tasks, if any)

2. Detect contradictions before coding.
   If the user request conflicts with existing architecture, recorded decisions, or documented domain behavior, explain the conflict and ask for approval.

3. Use the lightest process that fits the work.
   Do not create documents for trivial fixes.

4. Record decisions where they are read.
   Cross-cutting/architectural decisions go in `docs/architecture.md`; domain-local decisions go in the relevant `docs/domains/<domain>.md`. There is no separate decisions folder. Tasks are ephemeral implementation scratch, not a record.

5. Keep docs short and useful.
   Prefer updating existing docs over creating new ones. Distill — don't accumulate.

6. After completing a Level 2+ task:
   - verify functionality
   - run lint/typecheck/tests/build when available
   - distill durable knowledge into `docs/domains/<domain>.md` (create it if the domain is new)
   - record any cross-cutting decision in `docs/architecture.md`
   - delete the local task file (it is gitignored scratch)
   - commit the change (one commit per finished unit of work — Level 0 fix, Level 1 fix, or Level 2+ task close-out). Stage only files related to the work; task files are gitignored and never committed. Never use `--no-verify` or skip hooks. If the user has uncommitted unrelated changes, ask before staging.

7. Never silently introduce major dependencies, architecture changes, auth changes, payment changes, database changes, or deployment changes.

8. Domain docs are the durable record; tasks are not kept.
   If a bug is found in behavior that should already work, the agent may:
   - fix it silently for Level 0
   - fix it and update the relevant domain doc for Level 1
   - open a new task only if the fix changes behavior or expands scope (Level 2+)

9. When working with third-party libraries — APIs, configuration, migration, library-specific debugging — fetch current docs via available doc-fetch tools (MCP doc servers like Context7, `WebFetch` on official docs) rather than relying on training data. Training data lags by months and library APIs churn. Skip the fetch for refactoring, general programming concepts, or business-logic debugging that does not touch a library surface.

## Response style for Level 2+ work

See [`docs/feature-workflow.md`](docs/feature-workflow.md#complexity-levels) for what qualifies as Level 2+.

Before coding, output a short structured summary:

```md
## Context found
- ...

## Complexity
Level X — reason.

## Potential conflicts
- None found.

## Proposed plan
- ...

## Docs/tasks to update
- ...
```

If approval is needed, stop and ask.

For Level 0 work, just fix without docs.

## Project-specific guidance

**wolfyReader** — read ebooks in the browser: pages that turn, text you can search, and typography you can change without losing your place.

See [`docs/architecture.md`](docs/architecture.md) for stack and main application areas.

Standing rules for this project:

- **Zero runtime dependencies, permanently.** `dependencies` in `package.json` stays empty. Dev dependencies (TypeScript, Playwright) are allowed; the claim is phrased as "zero *runtime* dependencies".
- **Built from scratch.** No epub.js, foliate-js, Readium, PDF.js, or JSZip. Other projects may be read for format understanding; no code or dependency is taken from them.
- **No knowledge of any consuming application.** The library never fetches and never persists — bytes in, `Book` out. It holds no vocabulary from any downstream app.
- **Untrusted book content always renders in a hardened sandboxed iframe** (no `allow-same-origin`, strict CSP, allowlist sanitization, `data:` resources, `postMessage` coordination). Resources are `data:`, not `blob:`, and this is not a preference: a blob URL belongs to the origin that created it, and the frame's origin is opaque, so the frame is refused the host's blob URLs outright — measured, see [`docs/domains/view.md`](docs/domains/view.md). Do not "restore" `blob:` here.
- **The `Book` model and the `Position` format are the stability promise.** Everything else may churn.
- **DRM is permanently out of scope** — DRM-free books only.
- **Learn formats from specifications** (W3C EPUB, the MobileRead format wiki, the PalmDB spec), never from GPL source.

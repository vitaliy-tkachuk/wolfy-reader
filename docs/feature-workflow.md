# Feature Workflow

This workflow keeps AI-driven development lightweight but safe.

> Core rule: **Before coding, check durable context. After coding, distill durable knowledge into the right domain doc and discard the scratch.**

## Durable vs ephemeral

- **Durable (committed):**
  - `docs/architecture.md` — global architecture + cross-cutting architectural decisions (woven into the relevant sections).
  - `docs/domains/<domain>.md` — per-domain knowledge: implementation notes, domain-local decisions, gotchas, domain patterns. This is the permanent record of work.
  - `docs/coding-conventions.md`, `docs/patterns.md` (cross-domain patterns only), this file.
- **Ephemeral (local-only, gitignored):**
  - `docs/tasks/*.md` — working task files. Scratch for in-flight work. Never committed. Deleted on completion after their durable knowledge is folded into the domain doc.

There are no committed task records and no separate decisions folder. Finished work lives as distilled domain knowledge, not as a pile of task/decision files.

**Task IDs (`T<NNN>`) are ephemeral labels, not durable references.** They are reused (numbering resets as files are deleted) and the file they name is gone after completion. Never cite a task ID in a durable artifact — not in `docs/domains/*`, not in `docs/architecture.md`, not in commit messages. Distilled knowledge is provenance-free: describe *what* changed and *why*, never "added in T016, removed in T020". Task IDs belong only in the ephemeral task file and in-session chat.

## Skills

Three Claude Code skills drive feature work (`.claude/skills/`):

- `/analyze <request>` — classifies work into Level 0–3 below and scaffolds a local task file. Also answers questions about existing local tasks and applies in-place refinements. No code.
- `/implement <task-id-or-fix>` — runs the plan, verifies, distills knowledge into the domain doc, deletes the task file.
- `/describe-project` — one-time docs bootstrap (README, architecture.md, AGENTS.md).

A fourth, optional skill sits alongside them: `/graphify` builds the committed knowledge graph that `analyze` and `implement` query for cheap context. It is not part of the task lifecycle — see [Context review](#context-review-level-2) and [`README.md`](../README.md) for setup.

Other AI tools follow the same workflow by reading `AGENTS.md` — workflow is tool-agnostic.

## Task lifecycle

```
analyze (scaffold) → review / clarify → implement → distill into domain doc → delete task file
```

Running `implement` is itself the go-ahead — there is no separate approval flag. After `analyze` scaffolds a task, review or refine it if you want, then run `implement` when it looks right. Level 0 fixes have no task file at all.

## Default process

1. Understand the user request.
2. Classify complexity using the lowest sufficient level.
3. Review existing context for Level 2+ work (graph-first — see [Context review](#context-review-level-2)).
4. Detect contradictions or related prior work.
5. Ask for approval if architecture, dependency, auth, payment, database, or deployment behavior changes.
6. Create a local task file only when the work needs tracking (Level 2+).
7. Implement the change.
8. Verify with available checks (lint, typecheck, tests, build).
9. Distill durable knowledge into `docs/domains/<domain>.md` (create the domain doc if new); record any cross-cutting decision in `docs/architecture.md`.
10. Delete the local task file.
11. Commit the change (see [Committing](#committing)).

## Context review (Level 2+)

**Query the knowledge graph first.** If this repo has a committed graphify graph at `graphify-out/graph.json`, use `graphify query "<question>"` (and `graphify path` / `graphify explain` / `graphify affected`) to locate the relevant code, trace data flow, and find which modules the change touches — this replaces broad file reads and `grep`/glob sweeps and costs a fraction of the tokens. Read files in full only for the specific ones the query surfaces. See [`AGENTS.md`](../AGENTS.md#knowledge-graph--query-it-first-to-save-tokens) for the full policy. If the graph is absent or the tool is unavailable, fall back to reading files directly — it is an optimization, never a gate.

Then read the short authoritative docs in full (the graph augments these, it does not replace them):

- `docs/architecture.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`
- `docs/domains/*` (the relevant domains)
- `docs/tasks/*` (in-flight local tasks, if any)

The agent looks for:

- existing architecture rules and recorded decisions
- existing domain knowledge for the area being touched
- in-flight tasks
- contradictions
- reusable patterns
- likely files/modules to be touched
- whether a domain doc needs creating or updating

If a conflict exists, stop and explain. Get approval before coding.

## Complexity levels

### Level 0 — Silent fix

No task. No doc. Implement directly.

Use for:

- typo
- broken import
- obvious CSS bug
- small TypeScript error
- lint fix
- defect violating already-documented expected behavior

### Level 1 — Small fix that updates a domain doc

No task file. Fix directly, then add a short note to the relevant `docs/domains/<domain>.md` (a corrected gotcha, a clarified invariant, an updated implementation note).

Use when:

- bug belongs to an existing domain
- behavior was already expected
- fix does not change architecture
- no new dependency
- no new user-facing behavior
- the durable knowledge for that domain should reflect the fix

If the fix needs no durable-knowledge update, it is just a Level 0 fix.

### Level 2 — Small task

Create one local task file `docs/tasks/T<NNN>_<slug>.md`.

Use when:

- small feature
- isolated bug
- touches 1–3 files
- no architecture change
- no new major dependency

Example: `docs/tasks/T005_add_password_visibility_toggle.md`

### Level 3 — Planned feature

May involve a cross-cutting architectural decision (recorded in `docs/architecture.md`) and/or a new domain doc, plus one or more local task files.

Use when:

- new feature area (likely a new `docs/domains/<domain>.md`)
- touches multiple layers
- requires tests
- may affect architecture
- introduces a meaningful dependency

Example:

```
docs/tasks/T001_install_and_configure_auth_backend.md
docs/tasks/T002_add_authentication_ui_and_client_integration.md
docs/tasks/T003_protect_app_routes_and_finalize_auth_behavior.md
```

→ on completion, distilled into `docs/domains/auth.md`, with the auth strategy recorded in `docs/architecture.md`.

## Always-approval triggers

Regardless of level, **stop and require explicit approval before implementing** any change that:

- changes stack
- changes database / ORM
- changes auth strategy
- changes payment strategy
- changes deployment strategy
- replaces a major dependency
- contradicts a recorded decision (in `docs/architecture.md` or a domain doc)

These are not a separate level — they are a hard gate that applies on top of Level 2 or Level 3 work.

## Recording decisions

There is no decisions folder. Record decisions where they will be read:

- **Cross-cutting / architectural** (stack, database, ORM, auth, deployment, state management, payments, API style, background jobs, testing strategy, UI strategy) → `docs/architecture.md`, woven into the section it affects (stack, boundaries, constraints). Date significant choices inline.
- **Domain-local** (a pattern or trade-off that only matters inside one domain) → that domain's `## Key decisions` section in `docs/domains/<domain>.md`.

Never record tiny, local implementation details as decisions.

## Task file shape

Local task files use this skeleton (there is no committed template file — copy from here). Pick `<NNN>` = max existing T-number across `docs/tasks/*.md` + 1, zero-padded to 3 digits; if the folder is empty, start at `T001`. `<slug>` = lowercase snake_case, ≤ 6 words.

```md
# T<NNN> — Task Title

## Created
YYYY-MM-DD

## Complexity
Level 2 | Level 3

## Domain
<domain> — the docs/domains/<domain>.md this work distills into (existing or new).

## Goal
What should be true after this task is done?

## Acceptance criteria
- [ ] Given ..., when ..., then ...

## Out of scope
- ...

## Context reviewed
- docs/architecture.md
- docs/domains/<domain>.md

## Existing logic touched
- `src/...`

## Implementation plan
- [ ] Step 1
- [ ] Step 2

## Verification
- [ ] Acceptance criterion 1 → verified by ...
- [ ] Manual check: ...

## Notes
Gotchas, deviations, anything worth distilling into the domain doc.
```

## Domain doc shape

See [`docs/domains/README.md`](domains/README.md) for the per-domain section structure (Overview / Key decisions / Implementation notes / Gotchas / Patterns).

## Completing a task

1. Verify the feature works.
2. Run lint, typecheck, tests, build (whichever are available).
3. Distill durable knowledge into `docs/domains/<domain>.md` (create the file from the shape in `docs/domains/README.md` if the domain is new).
4. If the work introduced or changed a cross-cutting choice → record it in `docs/architecture.md` (woven into the relevant section).
5. If the work introduced a cross-domain reusable pattern → append it to `docs/patterns.md`. (Domain-local patterns go in the domain doc instead.)
6. If the task established repo-level commands → update `README.md`.
7. Decide whether the knowledge graph needs a **committed** refresh (skip entirely if the repo has no `graphify-out/`). The local `post-commit` hook already rebuilt it for free, so this is only about what lands in git: commit the refresh when this task changed the repo's *shape* — added, removed, renamed, or moved files/modules, or opened a new domain — or when it was doc/semantic-heavy (then run `graphify . --update` first; the semantic layer and community labels are not auto-refreshed). For a fix inside existing files, leave it; the graph locates code and the agent reads the real files anyway. When you do refresh, commit `graphify-out/` **separately** (`chore: refresh knowledge graph`) — never staged together with the task's own commit. See [`AGENTS.md`](../AGENTS.md#knowledge-graph--query-it-first-to-save-tokens) for the full cadence.
8. Delete the local task file.
9. Commit the change (see [Committing](#committing)).

## Committing

Commit after every finished unit of work — Level 0 fix, Level 1 fix, Level 2/3 task close-out. One commit per unit; do not batch unrelated work.

Rules:

- Stage only files related to the change (code + updated domain/architecture docs). Task files are gitignored, so they never appear in a commit. Never use `git add -A` / `git add .`.
- If unrelated uncommitted changes exist, ask the user before staging.
- Subject line: imperative, ≤72 chars. Conventional Commits prefix (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`) when it adds clarity.
- Body explains *why* when not obvious from the diff. Skip for trivial fixes.
- Never add AI attribution trailers to a commit message — no `Co-Authored-By: Claude …`, no `Generated with [Claude Code]`, no equivalent generated-by line. The message describes the change, not what produced it.
- Never use `--no-verify`, `--no-gpg-sign`, or `git commit --amend` on commits that are already pushed.
- Never push to remote unless the user asks.

If a pre-commit hook fails, fix the root cause and create a new commit. Do not amend or bypass.

## Anti-goals

Do not create:

- huge generated specs per feature
- a committed pile of task or decision files
- separate research / plan / data-model / contracts folders
- command-heavy workflow systems
- too many templates
- documentation for every tiny edit
- recording tiny local choices as decisions
- new tasks for every tiny bug
- verbose process logs
- citing task IDs (`T<NNN>`) in domain docs, architecture, or commit messages — they are reused and deleted, so the reference is misleading

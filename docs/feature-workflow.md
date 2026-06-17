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

## Skills

Three Claude Code skills drive feature work (`.claude/skills/`):

- `/describe-project` — one-time docs bootstrap (README, architecture.md, AGENTS.md).
- `/plan <request-or-slug>` — plan side. Classifies new work into Level 0–3, scaffolds Draft task files, refines existing tasks in place, and flips Status from Draft to Approved on approval. Asks decision questions via `AskUserQuestion` with concrete options. No code.
- `/implement <slug-or-fix>` — executor. Runs the plan for an Approved task (or a Level 0/1 fix), verifies, distills knowledge into the domain doc, deletes the task file, commits.

Other AI tools follow the same workflow by reading `AGENTS.md` — workflow is tool-agnostic.

## Task lifecycle

```
plan (scaffold → Draft) → plan (refine / approve → Approved) → implement → distill into domain doc → delete task file
```

The approval gate is explicit: `implement` refuses to run a task that is not `Approved`. Level 0 fixes have no task file and skip the gate.

## Default process

For Claude Code users, the three skills (`/describe-project`, `/plan`, `/implement`) encode the process. Other tools follow the same flow manually:

1. Classify the work (Level 0–3, plus [Always-approval triggers](#always-approval-triggers)).
2. Review durable context for Level 2+ (see [Context review](#context-review-level-2)).
3. Get approval before implementing — Level 2+ task `Status: Approved`, or explicit user OK on always-approval triggers.
4. Implement. Verify (lint, typecheck, tests, build — whichever apply).
5. Distill into `docs/domains/<domain>.md` (create if new). Record cross-cutting choices in `docs/architecture.md`.
6. Delete the local task file. Commit (see [Committing](#committing)).

## Context review (Level 2+)

Before coding, read:

- `docs/architecture.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`
- `docs/domains/*` (the relevant domains)
- `docs/tasks/*` (in-flight local tasks, if any)

If a conflict with a recorded decision or documented domain behavior exists, stop and explain. Get approval before coding.

## Complexity levels

### Level 0 — Silent fix

No task. No doc. Implement directly.

Use for:

- typo
- broken import
- obvious cosmetic bug
- small type or syntax error
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

Create one local task file `docs/tasks/<slug>.md`.

Use when:

- small feature
- isolated bug
- touches 1–3 files
- no architecture change
- no new major dependency

Example: `docs/tasks/add_export_progress_indicator.md`

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
docs/tasks/add_import_pipeline_core.md
docs/tasks/add_import_entry_points_and_validation.md
docs/tasks/finalize_import_error_handling_and_reporting.md
```

→ on completion, distilled into `docs/domains/import.md`, with any cross-cutting choice (e.g. parsing library, storage format) recorded in `docs/architecture.md`.

## Always-approval triggers

Regardless of level, **stop and require explicit approval before implementing** any change that:

- changes the core stack, language, or runtime
- changes the data persistence model
- changes the security or identity model
- changes the distribution, packaging, or release pipeline
- replaces a major dependency
- contradicts a recorded decision (in `docs/architecture.md` or a domain doc)

These are not a separate level — they are a hard gate that applies on top of Level 2 or Level 3 work.

## Recording decisions

No decisions folder. Record where they will be read:

- **Cross-cutting / architectural** (stack, persistence, identity, distribution, state model, testing strategy, etc.) → `docs/architecture.md`, woven into the section it affects. Date significant choices inline.
- **Domain-local** (only matters inside one domain) → `## Key decisions` in `docs/domains/<domain>.md`.

Never record tiny local implementation details as decisions.

## Task file shape

Local task files use this skeleton (there is no committed template file — copy from here). `<slug>` = lowercase snake_case, ≤ 6 words, descriptive enough to read at a glance. Must not collide with an existing file in `docs/tasks/`; if it would, extend the slug until unique.

```md
# Task Title

## Status
Draft | Approved

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

Canonical close-out order for an Approved Level 2+ task:

1. **Verify** — run whichever apply: typecheck, lint, tests, build. Detect from `package.json`, `pyproject.toml`, `Makefile`, etc. Fix root causes; never disable checks or use `--no-verify`.
2. **Distill into `docs/domains/<domain>.md`** (the task's `## Domain`). Create from the shape in `docs/domains/README.md` if new. Capture what was built/changed, domain-local decisions and why, gotchas, domain-local patterns. Distill — do not paste the task verbatim.
3. **Record cross-cutting choices in `docs/architecture.md`** — woven into the section affected (stack, boundaries, constraints). Includes replacing `TBD` placeholders in `## Current stack` with real bullets and in `## Main application areas` with real source directories, for every choice this task established. A scaffold/setup task is not done until the items it covers reflect reality (partial scaffolds may leave unrelated bullets as `TBD`).
4. **Append cross-domain patterns to `docs/patterns.md`** — 3rd use only (1st = solution, 2nd = coincidence, 3rd = pattern). Domain-local patterns stay in the domain doc.
5. **Update `README.md` if repo-level commands changed** — insert or replace stack-appropriate sections between `## Stack` and `## Working with AI agents`. Section names that fit the project shape: `## Getting Started` (clone-to-running; almost always applies), `## Running Locally` (dev/run commands; almost always applies), plus whatever the project actually produces — `## Building`, `## Packaging`, `## Releasing`, `## Going to Production`, `## Distribution`. Only add a section with real, verified commands from this task. Replace section body in place if it already exists (idempotent). `describe-project` re-renders `README.md` and will wipe these — re-run implement on the scaffold task to restore them.
6. **Append language/framework rules to `docs/coding-conventions.md ## Language & framework specifics`** if the work formalized any.
7. **Delete the local task file** (`docs/tasks/<slug>.md`). Gitignored scratch; the domain doc is now the record.
8. **Commit** — see [§ Committing](#committing).

For a Level 1 fix: add the short note to the relevant `docs/domains/<domain>.md`, then commit. For a Level 0 fix: just commit.

## Committing

One commit per finished unit of work — Level 0 fix, Level 1 fix, Level 2/3 close-out. Do not batch unrelated work. Message format lives in [`docs/coding-conventions.md ## Commits`](coding-conventions.md#commits).

Ops rules:

- Stage only files related to the change. Task files are gitignored — never appear in commits. Never `git add -A` / `git add .`.
- If unrelated uncommitted changes exist, ask before staging.
- Never `--no-verify`, `--no-gpg-sign`, or amend pushed commits.
- Never push unless the user asks.
- If a pre-commit hook fails: fix root cause, create a new commit. Do not amend or bypass.

## Anti-goals

Do not create:

- huge generated specs per feature
- a committed pile of task or decision files
- separate research / plan / data-model / contracts folders
- documentation for every tiny edit
- verbose process logs

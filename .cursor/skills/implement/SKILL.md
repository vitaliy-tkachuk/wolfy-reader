---
name: implement
description: Use when the user asks to execute, build, code, or fix something — phrased as "implement X", "implement fix for Y", "build add_import_pipeline", "code the login fix", "apply the fix", or similar action-oriented requests that follow a prior plan step or describe a Level 0/1 fix. Loads task context, enforces the approval gate (tasks must be Approved), runs the implementation plan, verifies via lint/typecheck/tests/build, distills durable knowledge into docs/domains/<domain>.md, and deletes the local task file. For Level 2+ work without an existing task file, refuses and asks the user to run the plan skill first.
---

# Implement skill

Execute work. Counterpart to the `plan` skill. Do not re-classify or re-scaffold — if the work needs a task file and none exists, stop and tell the user to run plan first.

The user's most recent message is the work request. Parse it as either a task slug (matching a filename in `docs/tasks/`) or a free-form Level 0/1 description.

## Step 1 — Identify the target

- If the request names a slug, locate the matching file in `docs/tasks/` (exact or prefix match). On multiple matches, list and ask which. If nothing matches, stop and report (it may have been completed-and-deleted, or never scaffolded — tell the user to run plan).
- If the request is free-form text, treat it as a **Level 0 or Level 1 fix only**. If the work looks like Level 2+, stop and tell the user: `Run plan first to scaffold a task.`
- If no clear target: list the contents of `docs/tasks/` and ask which task to implement.

## Step 2 — Enforce the approval gate

For a task file: read its `## Status`.

- If `Approved` → proceed.
- If `Draft` → **stop.** Tell the user the task is not approved yet: `<slug> is Draft. Say "approve <slug>" (or describe a refinement) before implementing.` Do not implement. Refinement and approval ride with the `plan` skill.

Level 0/1 free-form fixes have no task and skip this gate.

## Step 3 — Load context

Always read:

- `docs/feature-workflow.md`
- `docs/architecture.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`
- The relevant `docs/domains/<domain>.md` (the task's `## Domain`, if it exists)

If working from a task file:

- Read the task file in full.
- Read every file listed in its `## Context reviewed` section.
- Read every file listed in its `## Existing logic touched` section that actually exists.

If working a Level 0/1 free-form fix:

- Skim only files directly relevant to the fix, plus the relevant domain doc for Level 1.

## Step 4 — Re-check conflicts

If the task's plan now contradicts a newer recorded decision or current domain behavior, stop and report — do not silently diverge. Hand back to plan if the task needs revision.

## Step 5 — Execute

For a task file:

- Follow the `## Implementation plan` step by step.
- Tick each checkbox in the task file as you complete it (edit the file in place).
- Honor `## Out of scope` — do not expand.
- Honor `coding-conventions.md` and `patterns.md`.
- If you discover the plan is wrong mid-flight, stop, explain, and ask whether to update the task (re-run plan to refine) or proceed with a deviation note.

For a Level 0 fix: make the change directly. No task file, no doc update.

For a Level 1 fix: make the change, then add a short note to the relevant `docs/domains/<domain>.md` (corrected gotcha, clarified invariant, updated implementation note).

### Scaffold / setup tasks

If the task's plan is a fresh-repo scaffold (created by `plan` after `describe-project`), this is the step where the project actually comes into existence. Following the plan literally means:

- run the package manager (`npm init`, `pnpm init`, `cargo new`, `uv init`, `poetry init`, `go mod init`, etc. — whatever the chosen stack uses)
- install declared dependencies at their latest stable version (per `docs/coding-conventions.md ## Dependencies`)
- commit the lockfile alongside the manifest in the same change
- write config files (`tsconfig.json`, `pyproject.toml`, `.eslintrc`, `.prettierrc`, `rustfmt.toml`, formatter/linter configs, etc.)
- create the source tree the scaffold task declared (the directories that will land in `docs/architecture.md ## Main application areas`)
- add stack-specific `.gitignore` entries (`node_modules/`, `__pycache__/`, `target/`, `dist/`, `.venv/`, etc.) — the template ships only OS/editor/env/log entries
- create `.env.example` with placeholder values if the stack uses runtime env vars; never commit a real `.env`

Honor the same gates as any other task: nothing outside `## Acceptance criteria` + `## Implementation plan`, and stop and ask if the plan is missing a decision the user did not make in `plan`.

## Step 6 — Verify

Run whichever of these the repo supports (detect from `package.json`, `pyproject.toml`, `Makefile`, etc.):

- typecheck
- lint
- tests
- build

If any fail, fix the root cause. Do not disable checks, skip tests, or use `--no-verify` shortcuts. If a failure is unrelated to your change, surface it and ask the user.

## Step 7 — Close out

For an Approved Level 2+ task:

1. Confirm every box in `## Implementation plan` and `## Verification` is ticked.
2. Follow the ordered close-out in [`docs/feature-workflow.md` § Completing a task](../../../docs/feature-workflow.md#completing-a-task), then commit per Step 8 below.

For a Level 1 fix (free-form): add the relevant `docs/domains/<domain>.md` note, then commit (Step 8).

For a Level 0 fix: commit (Step 8). Nothing else to update.

## Step 8 — Commit

One commit per finished unit of work. Rules in [`docs/feature-workflow.md` § Committing](../../../docs/feature-workflow.md#committing). Summary:

- Stage only files related to this work (code + updated domain/architecture/README docs). Task files are gitignored and never appear in the commit. Never `git add -A` / `.`.
- If unrelated uncommitted changes exist, ask the user before staging.
- Subject ≤72 chars, imperative. Conventional Commits prefix when it adds clarity.
- Body explains *why* when not obvious. Skip for trivial fixes.
- Never `--no-verify`, never bypass hooks, never amend pushed commits, never push unless asked.
- If a pre-commit hook fails: fix root cause, create a new commit.

## Step 9 — Report

Short receipt:

```
Implemented: add_import_pipeline
Files changed: src/import/parser.ext, src/import/index.ext
Verified: typecheck ✓ lint ✓ tests ✓ build ✓
Distilled into: docs/domains/import.md
Deleted task: docs/tasks/add_import_pipeline.md
Committed: <short sha> feat: add import pipeline
```

## Hard rules

- Never implement a task whose `## Status` is not `Approved`.
- Never skip verification because "the change is small".
- Never bypass hooks, signing, or test failures.
- Never expand scope beyond the task's `## Acceptance criteria` + `## Out of scope`.
- Never delete a task file before its knowledge is distilled into the domain doc.
- Never commit a task file — it is gitignored scratch.
- Never run implement on something that should be planned. When in doubt, hand back.
- Never skip the commit step. One unit of work = one commit.

---
name: implement
description: Use when the user asks to execute, build, code, or fix something — phrased as "implement X", "implement fix for Y", "build T004", "code the login fix", "apply the fix", or similar action-oriented requests that follow a prior analyze step or describe a Level 0/1 fix. Loads task context, runs the implementation plan, verifies via lint/typecheck/tests/build, distills durable knowledge into docs/domains/<domain>.md, and deletes the local task file. For Level 2+ work without an existing task file, refuses and asks the user to run the analyze skill first.
---

# Implement skill

Execute work. Counterpart to the `analyze` skill. Do not re-classify or re-scaffold — if the work needs a task file and none exists, stop and tell the user to run analyze first.

The user's most recent message is the work request. Parse it as either a task ID (`T\d{3}`) or a free-form Level 0/1 description.

## Step 1 — Identify the target

- If the request references `T\d{3}` (e.g. `T004`, `T012`), treat it as a task ID. Locate the file in `docs/tasks/`. If missing, stop and report (it may have been completed-and-deleted, or never scaffolded — tell the user to run analyze).
- If the request is free-form text, treat it as a **Level 0 or Level 1 fix only**. If the work looks like Level 2+, stop and tell the user: `Run analyze first to scaffold a task.`
- If no clear target: list the contents of `docs/tasks/` and ask which task to implement.

## Step 2 — Load context

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

## Step 3 — Re-check conflicts

If the task's plan now contradicts a newer recorded decision or current domain behavior, stop and report — do not silently diverge. Hand back to analyze if the task needs revision.

## Step 4 — Execute

For a task file:

- Follow the `## Implementation plan` step by step.
- Tick each checkbox in the task file as you complete it (edit the file in place).
- Honor `## Out of scope` — do not expand.
- Honor `coding-conventions.md` and `patterns.md`.
- If you discover the plan is wrong mid-flight, stop, explain, and ask whether to update the task (re-run analyze) or proceed with a deviation note.

For a Level 0 fix: make the change directly. No task file, no doc update.

For a Level 1 fix: make the change, then add a short note to the relevant `docs/domains/<domain>.md` (corrected gotcha, clarified invariant, updated implementation note).

## Step 5 — Verify

Run whichever of these the repo supports (detect from `package.json`, `pyproject.toml`, `Makefile`, etc.):

- typecheck
- lint
- tests
- build

If any fail, fix the root cause. Do not disable checks, skip tests, or use `--no-verify` shortcuts. If a failure is unrelated to your change, surface it and ask the user.

## Step 6 — Close out

For a Level 2+ task:

1. Confirm every box in `## Implementation plan` and `## Verification` is ticked.
2. **Distill durable knowledge into `docs/domains/<domain>.md`** — the task's `## Domain`. Create the file from the shape in `docs/domains/README.md` if the domain is new. Capture: what was built/changed, domain-local decisions and why, gotchas, and any domain-local pattern. Distill — do not paste the task verbatim. **Write provenance-free: describe what and why, never cite the task ID (e.g. "added in T016", "removed in T020"). Task IDs are reused and the task file is deleted, so the reference is dead the moment you write it. The domain doc is the record; it stands on its own.** **Describe the current state, not the history of changes. If this task changed existing behavior, edit the affected lines to reflect the new reality and delete what is no longer true — do not append "was X, now Y" changelog narrative. Keep live rationale; turn any cautionary reversal into a present-tense gotcha.**
3. If the work introduced or changed a **cross-cutting** choice → record it in `docs/architecture.md`, woven into the section it affects (stack, boundaries, constraints). **This includes replacing every `TBD`/`Unknown` row in `## Current stack` and every `TBD` bullet in `## Main application areas` with the real values established by this task.** A scaffold/setup task is not done until the rows it covers reflect reality (partial scaffolds may leave unrelated rows as `TBD`).
4. If the work introduced a **cross-domain** reusable pattern (3rd use: 1st = solution, 2nd = coincidence, 3rd = pattern) → append it to `docs/patterns.md`. Domain-local patterns go in the domain doc (step 2), not here.
5. If the task established repo-level commands (install, dev, build, ship) → update `README.md`. Insert or replace these sections between `## Stack` and `## Working with AI agents`:
   - `## Getting Started` — clone-to-running setup (install deps, env, initial build).
   - `## Running Locally` — dev/run commands (e.g. `npm run dev`, launch the app, run the CLI).
   - `## Building & Releasing` — build + ship commands, framed for the project type: web → build + deploy; desktop → build the installer/package; CLI → build + publish the binary or registry release; library → build + publish to the package registry.

   Rules:
   - Only include sections with real, verified commands from this task. Omit sections without real content.
   - If a section already exists, replace its body in place (idempotent). Do not duplicate headings.
   - Commands must match what was actually run in Step 5 — do not invent.
   - Omit a section that does not apply to the project type (e.g. a library has no "Running Locally" app command).
   - `describe-project` re-renders `README.md` and will wipe these sections. After a stack pivot or re-describe, re-run implement on the relevant scaffold task to restore them.
6. If the work formalized language/framework-specific coding rules → append them under `docs/coding-conventions.md ## Language & framework specifics`.
7. **Delete the local task file** (`docs/tasks/T<NNN>_*.md`). It is gitignored scratch; the domain doc is now the record.
8. Commit the change (see [Committing](#step-7--commit)).

For a Level 1 fix (free-form):

1. Confirm the relevant `docs/domains/<domain>.md` note is added.
2. Commit the change (see [Committing](#step-7--commit)).

For a Level 0 fix:

- Nothing to update beyond the code itself.
- Commit the change (see [Committing](#step-7--commit)).

## Step 7 — Commit

One commit per finished unit of work. Rules in [`docs/feature-workflow.md` § Committing](../../../docs/feature-workflow.md#committing). Summary:

- Stage only files related to this work (code + updated domain/architecture/README docs). Task files are gitignored and never appear in the commit. Never `git add -A` / `.`.
- If unrelated uncommitted changes exist, ask the user before staging.
- Subject ≤72 chars, imperative. Conventional Commits prefix when it adds clarity. Describe the change itself — **do not put the task ID in the subject or body** (e.g. `feat: add oauth callback`, not `feat: T004 add oauth callback`). Task IDs are ephemeral and reused; a permanent commit should not reference scratch that is about to be deleted.
- Body explains *why* when not obvious. Skip for trivial fixes.
- Never `--no-verify`, never bypass hooks, never amend pushed commits, never push unless asked.
- If a pre-commit hook fails: fix root cause, create a new commit.

## Step 8 — Report

Short receipt:

```
Implemented: T004 — add oauth callback
Files changed: src/auth/callback.ts, src/auth/index.ts
Verified: typecheck ✓ lint ✓ tests ✓ build ✓
Distilled into: docs/domains/auth.md
Deleted task: docs/tasks/T004_add_oauth_callback.md
Committed: <short sha> feat: add oauth callback
```

## Hard rules

- Never skip verification because "the change is small".
- Never bypass hooks, signing, or test failures.
- Never expand scope beyond the task's `## Acceptance criteria` + `## Out of scope`.
- Never delete a task file before its knowledge is distilled into the domain doc.
- Never commit a task file — it is gitignored scratch.
- Never run implement on something that should be analyzed. When in doubt, hand back.
- Never skip the commit step. One unit of work = one commit.

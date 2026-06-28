---
name: analyze
description: Use when the user describes new work to be planned OR asks about / refines / approves an existing local task. New work — "analyze X", "look at Y", "we need to add Z", "there's a bug in W", "propose a stack", "recommend how to build this", "design implementation approach". Existing task — "clarify T004", "why does T004 do X", "what's the plan for T012", "approve T004", "looks good, approve it", "tweak the implementation plan for T007", "add an edge case to T009". Also handles initial architecture/stack proposals after describe-project and answers questions about recorded decisions in docs/architecture.md and docs/domains/. Classifies new work into Level 0–3 (plus always-approval triggers) using docs/feature-workflow.md, scaffolds a local task file (Status: Draft) in docs/tasks/, and refines/approves existing task files in place. Does NOT write implementation code — hands off to the implement skill.
---

# Analyze skill

Owns a task's entire pre-implementation life: turn a free-form request into a `Draft` task file, then answer questions about it, refine it in place, and **approve** it (`Draft → Approved`) — all before the `implement` skill executes it. Analyze and scaffold only — never write implementation code here.

The user's most recent message is the request. First decide which mode you are in (Step 0), then follow the matching branch.

## Step 0 — Pick the mode

- **Existing-task mode** — the message references an existing task: a `T\d{3}` id, or a topic that maps to a task in `docs/tasks/` ("the auth task"), or it asks to discuss/refine/approve one ("approve it", "tweak the plan"). → go to **Branch B**.
- **Decision/domain question** — the message asks about a recorded decision or domain behavior ("why did we choose Postgres", "how does auth work") with no new work implied. → go to **Branch B**, Question handling (answer from docs, no edits).
- **New-work mode** — anything else: a feature, bug, refactor, or stack/design proposal. → go to **Branch A**.

If the request is vague or empty, ask what they want done and stop.

---

# Branch A — New work (intake + scaffold)

## A1 — Load durable context

Read these files before doing anything else:

- `docs/feature-workflow.md` (authoritative source for Level 0–3 and always-approval triggers)
- `docs/architecture.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`
- The relevant files in `docs/domains/` (the domains the request touches; skim `docs/domains/README.md` for the convention)
- Any in-flight task files in `docs/tasks/` (this folder is gitignored and may be empty or absent)

## A2 — Classify

Pick the lowest sufficient complexity level using the criteria in `docs/feature-workflow.md`:

- **Level 0** — silent fix (typo, broken import, obvious CSS bug, small TS error, lint fix, defect violating already-documented expected behavior).
- **Level 1** — small fix in an existing domain whose durable knowledge should be updated; fix + a short note in `docs/domains/<domain>.md`. No task file.
- **Level 2** — small feature / isolated bug touching 1–3 files; one local task file.
- **Level 3** — new feature area (likely a new domain doc), multiple layers, may involve a cross-cutting decision recorded in `docs/architecture.md` + one or more task files.

Additionally, **always-approval triggers** (stack/database/auth/payment/deployment change, replacing a major dependency, or contradicting a recorded decision) require explicit user approval before any scaffolding — see `feature-workflow.md ## Always-approval triggers`.

## A3 — Detect conflicts

Cross-check the request against architecture rules, recorded decisions (in `docs/architecture.md` and domain docs), and documented domain behavior. If a conflict exists, surface it and stop until the user resolves it.

## A4 — Ask clarifying questions (if needed)

Only ask when answers materially change the artifacts or implementation. Skip clarifications for Level 0. Prefer the `AskUserQuestion` tool with concrete multiple-choice options where possible. Examples worth asking:

- ambiguous scope ("does this include the admin view too?")
- unclear acceptance ("what does 'fast' mean — p95 < 200ms?")
- competing valid approaches at Level 3 (pick one before scaffolding)
- missing stack info at Level 2+ when `architecture.md` is still placeholder

**Proposal-style requests** ("propose a stack", "recommend how to build this", "design implementation approach") are a special case: the user wants AI to surface options, not to be quizzed on details they have not yet decided. Read the purpose in `docs/architecture.md` and offer 2–4 concrete option sets via `AskUserQuestion` — each option a named bundle (e.g. "Next.js + Postgres + NextAuth + Vercel") with a one-line trade-off. Let the user pick or refine. The picked bundle is recorded in `docs/architecture.md` (see A6) and carried by the scaffolding task(s).

Do not ask for stylistic preferences already covered by `coding-conventions.md`.

## A5 — Emit the structured summary

Output exactly this block (from `CLAUDE.md`):

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

## A6 — Scaffold artifacts

Based on level:

- **Level 0** — no artifacts. Stop after the summary; tell the user they can ask "implement the fix" to apply it.
- **Level 1** — no task file. Note in the summary which `docs/domains/<domain>.md` the fix will update. The `implement` skill makes the fix and the doc note. Tell the user to say "implement the fix".
- **Level 2** — create one file `docs/tasks/T<NNN>_<slug>.md` from the **Task file shape** in `docs/feature-workflow.md` (there is no committed template file). Create the `docs/tasks/` folder if it does not exist. Pick `<NNN>` = max existing T-number across `docs/tasks/*.md` + 1, zero-padded to 3 digits; start at `T001` if empty. `<slug>` = lowercase snake_case, ≤ 6 words. Prefill: **Status=Draft**, Created=<today>, Complexity=Level 2, Domain (existing or new), Goal, Acceptance criteria, Out of scope, Context reviewed, Existing logic touched (best guess), Implementation plan, Verification.
- **Level 3** — create one or more task files in `docs/tasks/` following Level 2 rules, each naming its target Domain. If a cross-cutting choice is involved (per `feature-workflow.md ## Recording decisions`), capture the chosen approach and rationale in the task's `## Notes` and add an explicit plan step: `Record the <X> decision in docs/architecture.md`. The decision is written into `docs/architecture.md` by `implement` at close-out — analyze does not pre-write it. If a task is a stack/scaffold/setup task (it will resolve `TBD`/`Unknown` rows in `docs/architecture.md`), add these steps to its `## Implementation plan`: `Replace TBD/Unknown rows in docs/architecture.md ## Current stack with real values`, `Replace TBD bullets in docs/architecture.md ## Main application areas with real source directories`. If the task introduces or formalizes language/framework-specific coding rules, also add: `Append language/framework rules to docs/coding-conventions.md ## Language & framework specifics`.
- **Always-approval triggers** — if the request matches any trigger in `feature-workflow.md ## Always-approval triggers`, **do not scaffold yet.** Output the summary, flag the impact, and require user approval. Once approved, scaffold per Level 2 or Level 3 rules.

Use the current date for any timestamps.

## A7 — Report

Print a short receipt: files created, files to update, next action. Tasks start as `Draft` and must be **approved** before implementing. Example:

```
Created: docs/tasks/T004_add_oauth_callback.md (Status: Draft)
Next: review it, then say "approve T004" to unlock implementation, or "clarify T004 ..." to refine.
```

If the user clearly approves the scaffolded task in the same turn (e.g. "looks good, go" / "approve it"), you may flip its `## Status` from `Draft` to `Approved` directly and tell them to say "implement T<NNN>".

---

# Branch B — Existing task (question / refine / approve)

Once a task exists, this branch handles **questions about it**, **incremental refinements**, and **approval** (`Draft → Approved`) — without re-scaffolding or implementing anything.

## B1 — Identify the target

- If the request references `T\d{3}`: locate the file in `docs/tasks/`. If missing, stop — it may have been completed-and-deleted (durable knowledge is now in the domain doc) or never scaffolded; tell the user to check the domain doc or describe the work as new (Branch A).
- If the request is about a recorded decision or domain behavior: answer from `docs/architecture.md` and `docs/domains/<domain>.md` (Question mode only — see B3). Amending those docs is the `implement` job, not this branch.
- If the request is topic-based ("the auth task"): grep `docs/tasks/` for matches. If multiple, list and ask which one. If none, stop and treat it as new work (Branch A).
- If no clear target: list contents of `docs/tasks/` and ask which to clarify.

## B2 — Load context

Always read:

- `docs/feature-workflow.md`
- `docs/architecture.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`

For the target task:

- Read the full task file.
- Read the relevant `docs/domains/<domain>.md` (the task's `## Domain`) if it exists.
- Read every file listed in the task's `## Context reviewed` and `## Existing logic touched` that actually exists.

Do not skim. The whole point of this branch is grounded answers — partial reads produce wrong answers.

## B3 — Classify the request

Pick one mode:

- **Question** — user wants an explanation, comparison, or status read. No file edits. Answer from loaded context only; cite file paths + line numbers.
- **Refinement** — user proposes a small in-place change to the task. Edit allowed if the change stays within the task's current scope (acceptance criteria wording, plan steps, out-of-scope items, notes, domain target).
- **Approval** — user approves the task ("approve T004", "looks good, go"). Flip `## Status` from `Draft` to `Approved` (see B5). This is the gate that unlocks `implement`.
- **Escalation** — proposed change exceeds the task's scope:
  - new task needed (different feature area, new layer, new dependency) → switch to Branch A.
  - cross-cutting decision not yet recorded → switch to Branch A.
  - always-approval trigger per `docs/feature-workflow.md ## Always-approval triggers` (stack/database/auth/payment/deployment change, major dependency replacement, contradicting a recorded decision) → stop, surface impact, require explicit user approval, then switch to Branch A.
  - implementation requested ("now do it", "apply the change") → hand off to `implement` (only if the task is `Approved`).

If unsure between Refinement and Escalation, ask via `AskUserQuestion` with concrete options before editing.

## B4 — Answer or discuss

For **Question** mode: respond directly. Reference section headings (`## Acceptance criteria`, `## Implementation plan`, etc.) and quote relevant lines. Do not invent facts not in the loaded context.

For **Refinement** mode: before editing, restate the proposed change in one or two sentences and confirm via `AskUserQuestion` if any of:

- the change rewrites an acceptance criterion (not just adds one)
- the change removes or reorders implementation plan steps
- the change touches `## Out of scope`

Plain additions (new edge case, new note) can be applied without confirmation.

For **Escalation** mode: do not edit. Output the structured summary block from `CLAUDE.md` (Context found / Complexity / Potential conflicts / Proposed plan / Docs/tasks to update) and continue as Branch A.

## B5 — Apply edits

**Refinement** — edit the task file (`docs/tasks/T<NNN>_*.md`) in place:

- Edit fields in place. Preserve existing checkbox state (`[ ]` vs `[x]`) — do not reset progress.
- Append to `## Notes` with a `### Clarified <YYYY-MM-DD>` subsection when the change is significant enough to matter at implement time.
- A material refinement after approval should drop the task back to `Draft` so the user re-approves — confirm with the user before doing so. Plain additions can stay `Approved`.

**Approval** — set `## Status` to `Approved`. Do not change anything else. This is the only way a task becomes implementable.

Use the current date for any dated sections.

## B6 — Report

Short receipts:

```
Approved: T004 — ready to implement.
Files updated: docs/tasks/T004_add_oauth_callback.md (Status: Draft → Approved)
Next: say "implement T004".
```

```
Clarified: T004 — added edge case for expired refresh tokens.
Files updated: docs/tasks/T004_add_oauth_callback.md (still Draft)
Next: "approve T004" when ready, or keep refining.
```

```
Answered: auth uses short-lived access tokens with rotating refresh tokens (docs/domains/auth.md:12).
Files updated: none.
Next: ask follow-ups.
```

---

## Hard rules

- Never write implementation code in this skill. Always hand off to the `implement` skill.
- Never record a decision for a tiny implementation detail.
- Never create a task for Level 0 work.
- Never skip context loading (A1 / B2).
- Never silently change architecture, dependencies, auth, payments, database, or deployment — these are always-approval triggers; surface, stop, and require explicit user approval.
- Never invent file paths in `## Existing logic touched` — if the repo has no `src/` yet, write "TBD — repo still in template state".
- Never amend `docs/architecture.md` or `docs/domains/` from Branch B — answer questions about them, but durable doc changes ride with `analyze` scaffolding or `implement`.
- Never edit a task whose plan steps are already partially ticked without preserving that progress.
- Approval is explicit: only flip `Draft → Approved` when the user clearly approves.
- Task files are gitignored scratch — never commit them.

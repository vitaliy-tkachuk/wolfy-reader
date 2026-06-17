---
name: plan
description: Use when the user describes new work to plan, asks questions about an existing local task, wants to refine/approve one, or asks about a recorded decision — phrased as "plan X", "look at Y", "we need to add Z", "there's a bug in W", "propose a stack", "recommend how to build this", "design implementation approach", "why does add_import_pipeline do X", "tweak the acceptance criteria for the import task", "add an edge case", "approve add_import_pipeline", "looks good, approve it", or similar intake/discussion/approval requests. Also handles initial architecture/stack proposals after describe-project: reads the purpose in docs/architecture.md, proposes stack options with trade-offs via AskUserQuestion, records the chosen stack, and scaffolds scaffolding task(s). Classifies new work into Level 0–3 (plus always-approval triggers) using docs/feature-workflow.md, asks decision questions via AskUserQuestion with concrete options, scaffolds Draft task files, refines existing ones in place, and flips Status from Draft to Approved on approval. Does NOT write implementation code — hands off to the implement skill.
---

# Plan skill

Plan side of the planner/executor pair. Three modes against the same loaded context:

- **Scaffold** — new request → `Draft` task file(s) (or no file for Level 0/1).
- **Refine** — existing Draft task → in-place edits, answers to questions about it.
- **Approve** — existing Draft task → flip `## Status` to `Approved` (the gate that unlocks `implement`).

Never writes implementation code — hands off to `implement`.

Whenever a decision needs to be made (scope boundary, competing approaches, stack choice, refinement direction), use `AskUserQuestion` with **2–4 concrete options** and a one-line trade-off per option. Do not ask open-ended questions when a small option set captures the choice. If you would normally recommend one path, put it first and label it "(Recommended)".

The user's most recent message is the request. If empty or vague, ask what they want done (with options when you can guess the directions) and stop.

## Step 1 — Identify mode + target

- **Scaffold** — request describes new work ("plan X", "we need to add Y", "there's a bug in Z", "propose a stack"). No matching task file required.
- **Refine** — request mentions an existing task slug or topic and proposes a change or asks a question about it ("tweak X", "why does X", "what's the plan for X", "add an edge case to X"). Locate the file in `docs/tasks/` by exact-or-prefix match against `<slug>.md`; on multiple matches, list and ask which. If nothing matches, stop — the task may have been completed-and-deleted (check the relevant domain doc) or never scaffolded (tell the user to scaffold by rephrasing as Scaffold intent).
- **Approve** — request approves an existing task ("approve <slug>", "looks good, go", "approve it" in the same turn that just scaffolded). Locate the file as in Refine. Approval-only requests do nothing else — go straight to Step 6.
- **Q&A about a recorded decision or domain behavior** ("why did we pick this library", "how does the import pipeline work") — read context (Step 2), answer with file:line citations, no edits. Don't switch to Refine unless the user asks for a change.

If the request mixes modes (e.g. "tweak X and approve it"), do Refine first, then Approve.

## Step 2 — Load durable context

Always read:

- `docs/feature-workflow.md` (authoritative source for Level 0–3 and always-approval triggers)
- `docs/architecture.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`
- The relevant files in `docs/domains/` (the domains the request touches; skim `docs/domains/README.md` for the convention)
- Any in-flight task files in `docs/tasks/` (gitignored; may be empty or absent)

For Refine/Approve modes, additionally:

- Read the full target task file.
- Read every file listed in its `## Context reviewed` and `## Existing logic touched` that exists.

While reading, look for:

- existing architecture rules and recorded decisions
- existing domain knowledge for the area being touched
- in-flight tasks
- contradictions with the request
- reusable patterns
- likely files/modules to be touched
- whether a domain doc needs creating or updating

Do not skim — grounded answers require the whole file.

## Step 3 — Classify (Scaffold mode only)

Pick the lowest sufficient level per [`docs/feature-workflow.md` § Complexity levels](../../../docs/feature-workflow.md#complexity-levels). Check [§ Always-approval triggers](../../../docs/feature-workflow.md#always-approval-triggers) — they require explicit user approval before any scaffolding regardless of level.

## Step 4 — Detect conflicts

Cross-check the request against architecture rules, recorded decisions, and documented domain behavior. If a conflict exists, surface it and stop until the user resolves it (offer a small option set via `AskUserQuestion` — e.g. "revise the request", "override the recorded decision", "stop") instead of asking open-ended.

## Step 5 — Ask decision questions via AskUserQuestion

Only ask when answers materially change the artifacts or implementation. Skip clarifications for Level 0. Always prefer `AskUserQuestion` with concrete options:

- ambiguous scope → options like "include admin view", "exclude admin view", "split into two tasks".
- unclear acceptance → quantified options ("p95 < 200ms", "p95 < 500ms", "no perf budget").
- competing valid approaches at Level 3 → one option per approach, one-line trade-off each.
- missing stack info at Level 2+ when `architecture.md` is still placeholder → stack option bundles (see proposal-style below).
- Refine mode boundary call (refinement vs new task vs escalate) → options like "refine in place", "scaffold a follow-up task", "escalate as always-approval trigger".

**Proposal-style requests** ("propose a stack", "recommend how to build this", "design implementation approach"): read the purpose in `docs/architecture.md` and offer 2–4 concrete option bundles via `AskUserQuestion` — each a named bundle (language + framework/runtime + any other categories the project shape implies) with a one-line trade-off, tailored to the project shape inferred from the purpose (CLI, web app, desktop app, library, etc.). The picked bundle is recorded in `docs/architecture.md` (see Step 6) and carried by the scaffolding task(s).

Do not ask about stylistic preferences already covered by `coding-conventions.md`.

## Step 6 — Execute by mode

### Scaffold

Output exactly this structured summary block (from `CLAUDE.md`):

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

Then scaffold by level:

- **Level 0** — no artifacts. Tell the user they can say "implement the fix" to apply it.
- **Level 1** — no task file. Note in the summary which `docs/domains/<domain>.md` the fix will update. Tell the user to say "implement the fix".
- **Level 2** — create one file `docs/tasks/<slug>.md` from the **Task file shape** in `docs/feature-workflow.md`. Create the folder if missing. `<slug>` = lowercase snake_case, ≤ 6 words, descriptive at a glance; extend the slug until unique against existing files. Prefill: **Status=Draft**, Created=<today>, Complexity=Level 2, Domain (existing or new), Goal, Acceptance criteria, Out of scope, Context reviewed, Existing logic touched (best guess), Implementation plan, Verification.
- **Level 3** — create one or more task files in `docs/tasks/` following Level 2 rules, each naming its target Domain. If a cross-cutting choice is involved (per `feature-workflow.md ## Recording decisions`), capture the chosen approach and rationale in the task's `## Notes` and add an explicit plan step: `Record the <X> decision in docs/architecture.md`. The decision is written into `docs/architecture.md` by `implement` at close-out — plan does not pre-write it. If a task is a stack/scaffold/setup task (it will replace `TBD` placeholders in `docs/architecture.md`), add these plan steps: `Replace TBD placeholder in docs/architecture.md ## Current stack with real bullets`, `Replace TBD placeholder in docs/architecture.md ## Main application areas with real source directories`. If the task introduces or formalizes language/framework-specific coding rules, also add: `Append language/framework rules to docs/coding-conventions.md ## Language & framework specifics`.
- **Always-approval triggers** — do not scaffold yet. Output the summary, flag the impact, require user approval via `AskUserQuestion` (options: "approve and scaffold", "revise scope", "stop"). On approval, scaffold per Level 2 or Level 3.

Use the current date for any timestamps.

### Refine

Edit the target task file in place. Before editing, restate the proposed change in one or two sentences. Confirm via `AskUserQuestion` (options like "apply as proposed", "apply with this tweak", "skip") if any of:

- the change rewrites an acceptance criterion (not just adds one)
- the change removes or reorders implementation plan steps
- the change touches `## Out of scope`

Plain additions (new edge case, new note) can be applied without confirmation.

Rules:

- Preserve existing checkbox state (`[ ]` vs `[x]`) — do not reset progress.
- Append to `## Notes` with a `### Clarified <YYYY-MM-DD>` subsection when the change is significant enough to matter at implement time.
- A material refinement to an `Approved` task drops it back to `Draft` so the user re-approves — confirm first via `AskUserQuestion` ("drop to Draft and re-approve", "keep Approved, refine non-materially"). Plain additions can stay `Approved`.

For a pure Q&A request (no edit asked), respond directly. Reference section headings (`## Acceptance criteria`, `## Implementation plan`, etc.) and quote relevant lines. Do not invent facts not in the loaded context.

Escalation paths (still Refine mode, but you stop editing and hand off):

- proposed change exceeds the task's scope (new feature area, new layer, new dependency) → output the structured summary block (Context found / Complexity / Potential conflicts / Proposed plan / Docs/tasks to update) and recommend a new Scaffold pass.
- cross-cutting decision not yet recorded → same — recommend a new Scaffold pass.
- always-approval trigger → stop, surface impact, ask via `AskUserQuestion` ("approve and rescaffold", "revise", "stop").
- user asks to implement → tell them to say "implement <slug>" (only if Approved).

### Approve

Locate the task file. Flip `## Status` from `Draft` to `Approved`. Do not change anything else. This is the only path (other than same-turn approval immediately after Scaffold) by which a task becomes implementable.

If the request is "approve and go" / "approve and implement", flip the status, then tell the user to say "implement <slug>" — do not implement here.

## Step 7 — Report

Short receipts per mode. Examples:

```
Scaffolded: docs/tasks/add_import_pipeline.md (Status: Draft)
Next: review it, then say "approve add_import_pipeline" to unlock implementation, or describe a tweak to refine.
```

```
Approved: add_import_pipeline — ready to implement.
Files updated: docs/tasks/add_import_pipeline.md (Status: Draft → Approved)
Next: say "implement add_import_pipeline".
```

```
Refined: add_import_pipeline — added edge case for malformed input rows.
Files updated: docs/tasks/add_import_pipeline.md (still Draft)
Next: "approve add_import_pipeline" when ready, or keep refining.
```

```
Answered: import uses streaming parse with row-level error capture (docs/domains/import.md:12).
Files updated: none.
Next: ask follow-ups, or describe new work.
```

If the user clearly approves a freshly scaffolded task in the same turn (e.g. "looks good, go" / "approve it"), flip its `## Status` from `Draft` to `Approved` directly and tell them to say "implement <slug>".

## Hard rules

- Never write implementation code in this skill.
- Never record a decision for a tiny implementation detail.
- Never create a task for Level 0 work.
- Never skip context loading (Step 2).
- Never silently hit an [always-approval trigger](../../../docs/feature-workflow.md#always-approval-triggers) — surface, stop, require explicit user approval via `AskUserQuestion`.
- Never invent file paths in `## Existing logic touched` — if the repo has no source tree yet, write "TBD — repo still in template state".
- Never edit a task whose plan steps are already partially ticked without preserving that progress.
- Never invent file paths or line numbers when citing context — if unsure, re-read.
- Never amend `docs/architecture.md` or `docs/domains/` here for Refine/Approve modes — answer questions about them, but doc edits ride with `implement` at close-out.
- Approval is explicit: only flip `Draft → Approved` when the user clearly approves.
- Task files are gitignored scratch — never commit them.
- When in doubt between modes (Scaffold vs Refine vs Approve), ask via `AskUserQuestion` with concrete options before acting.

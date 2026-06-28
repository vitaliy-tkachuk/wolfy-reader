# AGENTS.md

You are an AI development agent working in this repository.

Your job is to implement user requests safely, consistently, and with minimal process overhead.

This file is the canonical instruction set for all AI coding agents working in this repo (Claude Code, Cursor, Codex, Copilot, Aider, etc.). Agent-specific overrides live in agent-native files (e.g., `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`) and should `@`-import or reference this file rather than duplicate it.

## Complexity levels

This repo classifies every change as Level 0–3. Definitions, triggers, and required artifacts for each level live in [`docs/feature-workflow.md`](docs/feature-workflow.md#complexity-levels). Some changes (stack/database/auth/payment/deployment, major dependency swaps, contradicting a recorded decision) are always-approval triggers — see the same doc.

**Read `docs/feature-workflow.md` before writing any code.** Classification drives whether you fix silently, update a domain doc, open a new task, or require approval.

Durable knowledge lives in `docs/architecture.md` (cross-cutting decisions) and `docs/domains/<domain>.md` (per-domain implementation + local decisions). Task files in `docs/tasks/` are ephemeral, local-only, and gitignored — scratch that is deleted on completion after its knowledge is distilled into the domain doc. There is no committed task history and no decisions folder.

## Core rules

1. Before any code, review `docs/feature-workflow.md` and classify the work (Level 0–3, plus always-approval triggers). For Level 2+, also review:
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

TBD — fill in once the tech stack is established. See `docs/architecture.md`.

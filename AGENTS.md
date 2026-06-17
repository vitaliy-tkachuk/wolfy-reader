# AGENTS.md

You are an AI development agent working in this repository.

Your job is to implement user requests safely, consistently, and with minimal process overhead.

This file is the canonical instruction set for all AI coding agents working in this repo (Claude Code, Cursor, Codex, Copilot, Aider, etc.). Agent-specific overrides live in agent-native files (e.g., `CLAUDE.md`, `.cursor/rules/`, `.github/copilot-instructions.md`) and should `@`-import or reference this file rather than duplicate it.

Skill packs ship for two agents today:

- **Claude Code** — `.claude/skills/{describe-project,plan,implement}` (invoke as `/describe-project`, `/plan`, `/implement`).
- **Cursor** — `.cursor/skills/{describe-project,plan,implement}` plus an always-apply rule at `.cursor/rules/workflow.mdc` (invoke by description match or `@`-mention).

The two skill folders are byte-for-byte mirrors. If you edit a `SKILL.md` in one, mirror the change in the other — see [`.cursor/skills/README.md`](.cursor/skills/README.md). Other tools follow this workflow by reading this file.

## Complexity levels

Every change is classified Level 0–3. Definitions, required artifacts, and always-approval triggers live in [`docs/feature-workflow.md`](docs/feature-workflow.md#complexity-levels). **Read it before writing any code** — classification drives whether you fix silently, update a domain doc, open a new task, or require approval.

Durable knowledge lives in `docs/architecture.md` (cross-cutting decisions) and `docs/domains/<domain>.md` (per-domain implementation + local decisions). Task files in `docs/tasks/` are ephemeral, local-only, and gitignored — scratch deleted on completion after its knowledge is distilled into the domain doc. There is no committed task history and no decisions folder.

## Core rules

1. Before any code, classify per [`docs/feature-workflow.md` § Complexity levels](docs/feature-workflow.md#complexity-levels). For Level 2+, load the durable context listed in [§ Context review](docs/feature-workflow.md#context-review-level-2).

2. Detect contradictions before coding.
   If the user request conflicts with existing architecture, recorded decisions, or documented domain behavior, explain the conflict and ask for approval.

3. Use the lightest process that fits the work.
   Do not create documents for trivial fixes.

4. Record decisions where they are read.
   Cross-cutting/architectural decisions go in `docs/architecture.md`; domain-local decisions go in the relevant `docs/domains/<domain>.md`. There is no separate decisions folder. Tasks are ephemeral implementation scratch, not a record.

5. Keep docs short and useful.
   Prefer updating existing docs over creating new ones. Distill — don't accumulate.

6. After completing a Level 2+ task, follow [`docs/feature-workflow.md` § Completing a task](docs/feature-workflow.md#completing-a-task) and commit per [§ Committing](docs/feature-workflow.md#committing).

7. Never silently make a change that hits the [always-approval trigger list](docs/feature-workflow.md#always-approval-triggers).

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

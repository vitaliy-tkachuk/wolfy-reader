# {{PROJECT_NAME}}

{{PROJECT_DESCRIPTION}}

## Overview

{{PROJECT_PURPOSE}}

## Stack

- TBD

## Working with AI agents

This repo uses a lightweight spec-driven workflow. AI agents (Claude Code, Cursor, Codex, Copilot, Aider, etc.) follow the rules in [`AGENTS.md`](AGENTS.md). Skills ship for Claude Code (`.claude/skills/`) and Cursor (`.cursor/skills/` + `.cursor/rules/workflow.mdc`).

Agentic development loop — drive changes through skills instead of ad-hoc prompts so every change is classified, planned, and recorded:

- `/plan <request>` — classifies the work (Level 0–3) and scaffolds an approved task file (no code).
- `/implement <slug>` — runs the approved plan, verifies, distills durable knowledge into `docs/domains/`, then commits.
- `/describe-project` — one-time (re-run only if identity/stack changes); fills project docs, no code.

In Claude Code, invoke by `/skill-name`. In Cursor, invoke by describing the task or `@`-mentioning the skill (no `/slash` UI). Other tools follow the same flow by reading [`AGENTS.md`](AGENTS.md).

Key docs:

- [`AGENTS.md`](AGENTS.md) — canonical instructions for AI agents
- [`docs/feature-workflow.md`](docs/feature-workflow.md) — complexity levels (0–3) and required artifacts
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/coding-conventions.md`](docs/coding-conventions.md) — coding conventions
- [`docs/patterns.md`](docs/patterns.md) — cross-domain reusable patterns
- [`docs/domains/`](docs/domains/) — per-domain durable knowledge (the permanent record)

Architectural decisions live in `docs/architecture.md`. Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored.

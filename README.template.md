# {{PROJECT_NAME}}

{{PROJECT_DESCRIPTION}}

## Overview

{{PROJECT_PURPOSE}}

## Stack

- Language: Unknown
- Framework: Unknown
- Deployment / distribution: Unknown

## Working with AI agents

This repo uses a lightweight spec-driven workflow. AI agents (Claude Code, Cursor, Codex, Copilot, Aider, etc.) follow the rules in [`AGENTS.md`](AGENTS.md).

Key docs:

- [`AGENTS.md`](AGENTS.md) — canonical instructions for AI agents
- [`docs/feature-workflow.md`](docs/feature-workflow.md) — complexity levels (0–3) and required artifacts
- [`docs/architecture.md`](docs/architecture.md) — system architecture
- [`docs/coding-conventions.md`](docs/coding-conventions.md) — coding conventions
- [`docs/patterns.md`](docs/patterns.md) — cross-domain reusable patterns
- [`docs/domains/`](docs/domains/) — per-domain durable knowledge (the permanent record)

Architectural decisions live in `docs/architecture.md`. Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored.

<div align="center">
    <h1>🪶 ai-spec-template</h1>
    <h3><em>Plan, scaffold, ship — with AI agents.</em></h3>
</div>

<p align="center">
    <strong>A lightweight spec-driven workflow template that lets AI coding agents plan and implement changes through ephemeral, complexity-tiered tasks that distill into durable per-domain knowledge.</strong>
</p>

<p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
</p>

---

## 📖 Overview

Provides a lightweight workflow for planning, tracking, and implementing changes alongside AI agents (Claude Code, Cursor, Codex, Copilot, Aider, etc.).

## 🚀 Quickstart

1. 📥 Click **Use this template → Create a new repository** on the GitHub page to spin up a fresh repo with clean history. Or clone/copy locally and run `rm -rf .git && git init` to reset history.
2. 📝 In Claude Code, run `/describe-project` — fills project-specific docs (no code, no dependencies, no config files). Asks for:
   - project name, one-line description, purpose paragraph
   - project type (web / desktop / CLI / library / other) — drives which stack categories you're asked for
   - stack — categories adapt to the type (e.g. web: framework/styling/database/auth/deployment; CLI: language/runtime/distribution)
   - main source directories

   Then renders `README.template.md` → `README.md` (substituting `{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{PROJECT_PURPOSE}}`; template kept in place as rendering reference), patches `docs/architecture.md`, appends stack-specific `.gitignore` entries, and updates the `## Project-specific guidance` section of `AGENTS.md`.
3. 🔍 Run `/analyze <request>` — classifies the work (Level 0–3) and scaffolds a local task file. For initial stack proposals, say e.g. `/analyze propose a stack for this app`. The same skill also answers questions about a task and applies in-place refinements (`/analyze clarify T004 ...`). There is no approval flag — running `/implement` is the go-ahead.
4. 🛠️ Run `/implement <task-id-or-fix>` — runs the plan, verifies, distills durable knowledge into `docs/domains/<domain>.md` (and `docs/architecture.md` for cross-cutting decisions), then deletes the local task file.

🔌 Slash commands map to skills in `.claude/skills/` and currently ship for Claude Code only. Other AI tools follow the same workflow by reading `AGENTS.md` — the workflow itself is tool-agnostic. To get the same `/describe-project`, `/analyze`, `/implement` UX in another tool, copy the skill folders into that tool's skills directory. Example — Cursor (2.4+) uses the same `SKILL.md` format, so copying `.claude/skills/*` to `.cursor/skills/` works as a near drop-in.

## 📚 Key docs

- 🤖 [`AGENTS.md`](AGENTS.md) — canonical instructions for AI agents
- 🪜 [`docs/feature-workflow.md`](docs/feature-workflow.md) — complexity levels (0–3) and required artifacts
- 🏛️ [`docs/architecture.md`](docs/architecture.md) — system architecture
- ✍️ [`docs/coding-conventions.md`](docs/coding-conventions.md) — coding conventions
- 🧩 [`docs/patterns.md`](docs/patterns.md) — cross-domain reusable patterns
- 🧭 [`docs/domains/`](docs/domains/) — per-domain durable knowledge (the permanent record)

> 🏛️ Architectural decisions live in `docs/architecture.md`. Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored.

## 📄 License

[MIT](LICENSE)

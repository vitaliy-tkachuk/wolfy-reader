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
2. 📝 Run `/describe-project` — fills project-specific docs (no code, no dependencies, no config files). Asks for:
   - project name, one-line description, purpose paragraph
   - stack — free-form list of the tech choices that apply to this project (language, framework/runtime, data layer, identity, distribution, etc. — only what's relevant)
   - main source directories

   Then renders `README.template.md` → `README.md` (substituting `{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{PROJECT_PURPOSE}}`; template kept in place as rendering reference), patches `docs/architecture.md`, and updates the `## Project-specific guidance` section of `AGENTS.md`.
3. 🔍 Run `/plan <request>` — classifies the work (Level 0–3) and scaffolds a local task file (`Status: Draft`). For initial stack proposals or fresh-repo bootstrap, say e.g. `/plan propose a stack for this app` or `/plan scaffold the project`. The same skill also refines and approves existing tasks — `/plan tweak <slug> ...`, `/plan approve <slug>`. Decision points are surfaced as concrete option sets, not open-ended questions.
4. 🛠️ Run `/implement <slug-or-fix>` — runs the plan (Approved tasks only), verifies, distills durable knowledge into `docs/domains/<domain>.md` (and `docs/architecture.md` for cross-cutting decisions), then deletes the local task file and commits. **This is where setup tasks actually install dependencies, write config files, and create the source tree** — the previous steps only plan and approve.

### 🧱 Bootstrapping a fresh project

The template ships empty: no `package.json`, no `Cargo.toml`, no `tsconfig`, no source dirs. Steps 2–4 above form the bootstrap arc:

| Step | What happens | What lands on disk |
|---|---|---|
| `/describe-project` | Records project identity + stack as **descriptive text** in `docs/architecture.md`, `README.md`, `AGENTS.md` | Markdown only. No code, no deps, no configs. |
| `/plan 'scaffold the project'` | Proposes setup approach as concrete option bundles via `AskUserQuestion`, scaffolds a Draft setup task in `docs/tasks/` | Task file only (gitignored scratch). |
| `/plan approve <slug>` | Flips Status → Approved | Status change in the task file. |
| `/implement <slug>` | Executes the plan — runs the package manager, writes lockfile, creates config files, makes source dirs, distills into `docs/domains/`, commits | Real project files appear here. |

Re-run `/describe-project` later only if identity/stack changes — it overwrites `README.md`, so re-run implement on the scaffold task afterward to restore stack-specific sections (Getting Started, Running Locally, etc.).

🔌 The three skills ship for **Claude Code** (`.claude/skills/`) and **Cursor** (`.cursor/skills/`) out of the box, plus an always-apply Cursor rule at `.cursor/rules/workflow.mdc` that points the agent at `AGENTS.md`. The two skill folders are byte-for-byte mirrors — see [`.cursor/skills/README.md`](.cursor/skills/README.md) for the sync rule.

Cursor invokes skills by description match or `@`-mention (no `/slash` UI as of 2026); Claude Code invokes by `/skill-name`. Other AI tools (Codex, Copilot, Aider) follow the same workflow by reading `AGENTS.md` — the workflow itself is tool-agnostic.

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

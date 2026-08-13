<div align="center">
    <h1>🪶 ai-spec-template</h1>
    <h3><em>Plan, scaffold, ship — with AI agents. Any stack.</em></h3>
</div>

<p align="center">
    <strong>A lightweight, stack-agnostic spec-driven workflow template that lets AI coding agents plan and implement changes through ephemeral, complexity-tiered tasks that distill into durable per-domain knowledge.</strong>
</p>

<p align="center">
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT"/></a>
</p>

---

## 📖 Overview

Provides a lightweight workflow for planning, tracking, and implementing changes alongside AI agents (Claude Code, Cursor, Codex, Copilot, Aider, etc.).

It is deliberately **generic**: the template ships no source code, no dependencies, and no build configuration — only Markdown docs and agent skills. Nothing in it assumes a language, framework, or runtime, so the same workflow drives a web app, a backend service, a desktop app, a CLI, a library, embedded firmware, or anything else. `/describe-project` asks for your project type up front and adapts the stack questions, docs, and `.gitignore` to it; the coding conventions leave a dedicated section for your language's rules; and verification runs whatever checks your toolchain actually provides. Bring your own stack — the process stays the same.

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
5. 🕸️ Once real source exists, set up the [knowledge graph](#-knowledge-graph-optional) — agents query it instead of sweeping files, which makes every later step cheaper.

🔌 Slash commands map to skills in `.claude/skills/` and currently ship for Claude Code only. Other AI tools follow the same workflow by reading `AGENTS.md` — the workflow itself is tool-agnostic. To get the same `/describe-project`, `/analyze`, `/implement` UX in another tool, copy the skill folders into that tool's skills directory. Example — Cursor (2.4+) uses the same `SKILL.md` format, so copying `.claude/skills/*` to `.cursor/skills/` works as a near drop-in.

## 🕸️ Knowledge graph (optional)

Agents burn most of their tokens *finding* code. [graphify](https://github.com/safishamsi/graphify) turns the repo into a queryable knowledge graph so they can ask instead of sweep — `AGENTS.md` tells them to query it first and read in full only what the query surfaces. Everything below is optional; without a graph the workflow falls back to plain file reads.

Install once per machine:

```bash
uv tool install graphifyy       # or: pipx install graphifyy / pip install graphifyy
graphify install                # copy the /graphify skill into your agent's config dir
```

Then once per repo, from inside it, as soon as there is real source to index:

```bash
/graphify .                     # in Claude Code; CLI equivalent: graphify extract .
                                # → builds graphify-out/ (graph.json, GRAPH_REPORT.md, graph.html)
graphify hook install           # post-commit/post-checkout auto-rebuild + graph.json merge driver
git add graphify-out && git commit -m "chore: add knowledge graph"
```

`graphify hook install` writes to `.git/hooks/` and local git config, so **every clone needs it re-run** — it is not carried by the commit. The AST layer needs no API key; only the semantic layer and community labels do (e.g. `GEMINI_API_KEY`).

Then, day to day:

- 🔎 `graphify query "<question>"` — cross-file answer; also `path`, `explain`, `affected`
- ♻️ The **code** graph rebuilds itself on every commit (AST only, no LLM, no tokens) — but you only *commit* that rebuild on a cadence: when files/modules were added, removed, renamed, or moved, when a new domain landed, after doc/semantic-heavy work (run `graphify . --update` first), or roughly weekly. Not for fixes inside existing files. So `graphify-out/` sits modified between refreshes — that's expected; commit it on its own (`chore: refresh knowledge graph`), and `git checkout -- graphify-out/` if a dirty graph ever blocks a branch switch.
- 🧷 The hooks are **not** committed, so re-run `graphify hook install` per clone (and on CI, if CI should keep the graph fresh). `.gitattributes` registers the union merge driver that keeps `graph.json` from conflicting on every branch merge.

**What to commit from `graphify-out/`** — the rule is *commit what costs tokens to recreate, ignore what a CPU regenerates for free*:

| Commit | Ignore (already in `.gitignore`) |
|---|---|
| `graph.json` — what agents query | `cache/ast/` — local AST extraction, purged on every version bump |
| `GRAPH_REPORT.md` — human-readable summary | `cache/stat-index.json` — machine-local stat signatures |
| `.graphify_labels.json` — LLM-named communities | `cost.json` — local token accounting |
| `manifest.json` — content hashes | `.graphify_python`, `.graphify_root` — absolute paths of whoever built it |
| `cache/semantic/` — LLM-derived per-file extractions | |

`manifest.json` and `cache/semantic/` matter more than they look: a fresh clone has new mtimes for every file, so without them `graphify extract` treats the whole corpus as new and **re-bills semantic extraction**. `graph.html` is regenerable — commit it if you want the viz browsable from a clone, ignore it if you'd rather not carry the churn.

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

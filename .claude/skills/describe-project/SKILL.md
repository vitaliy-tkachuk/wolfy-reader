---
name: describe-project
description: Use when the developer wants to fill project-specific documentation in this ai-spec-template — phrased as "describe project", "fill template docs", "set project description", "/describe-project". Asks for project type (web / desktop / CLI / library / other) to drive an adaptive stack category set, renders docs/readme-template.md → README.md, patches docs/architecture.md, appends stack-specific .gitignore entries, and updates the AGENTS.md "Project-specific guidance" section. No code, dependencies, or source tree. For scaffolding, use the analyze + implement skills afterward.
---

# Describe-project skill

Documentation bootstrap. Replace template stubs in `docs/architecture.md` + `AGENTS.md` (`Unknown`, `TBD — fill in once the tech stack is established`) with real project info supplied by the developer, and regenerate `README.md` from `docs/readme-template.md` (substituting identity tokens during render — the template itself is never modified). Safe to re-run (e.g. after a stack pivot) — overwrites the same fields, `README.md` is rebuilt from the template each time.

The skill collects project info (including project **type**, which drives the stack categories), patches `docs/architecture.md`, renders `docs/readme-template.md` → `README.md` (substituting `{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{PROJECT_PURPOSE}}`; template kept in place), appends stack-specific entries to `.gitignore`, and updates the `## Project-specific guidance` block in `AGENTS.md`.

**Bootstrap only.** This skill writes Markdown docs plus a managed `.gitignore` block. It does not install dependencies, scaffold code, create source files, or initialize a source tree. Stack values entered here are descriptive text recorded in `docs/architecture.md` — not setup actions. For actual scaffolding, run the `analyze` skill on a setup task afterward.

The user's most recent message is the trigger. It may include some project details inline (e.g. "describe project: a Next.js todo app called Foo") — extract whatever is provided before asking.

## Step 1 — Gather project info

Use `AskUserQuestion` for any field the developer did NOT supply inline. Batch related questions into one multi-question call where possible. Collect:

1. **Project name** — short, used as repo title (e.g. "Foo", "Acme Dashboard").
2. **One-line description** — what the project is, in one sentence.
3. **Purpose** — 2–4 sentences on what problem it solves and for whom.
4. **Project type** — pick the closest; it determines which stack categories apply and which `.gitignore` entries to append:
   - **Full-stack / web app**
   - **Desktop app** (Windows / Linux / macOS / cross-platform)
   - **CLI tool**
   - **Library / package**
   - **Other** (developer names the categories)
5. **Stack** — ask only the categories relevant to the chosen type (see below). Accept "TBD" for any not yet decided; write `TBD` (not `Unknown`) to mark intentional deferral.
6. **Main application areas** — top-level source directories and what each contains (e.g. `src/app — routes`, `src/lib — domain logic`, `src/cli — entrypoints`). Accept "TBD" if not started.

### Stack categories by project type

Ask only these, in this order. Always include **Language**. Drop any category that does not apply rather than writing a meaningless row.

- **Full-stack / web app:** Framework · Language · Styling · Database · Auth · Deployment
- **Desktop app:** Framework / UI toolkit · Language · Target OS · Packaging / distribution · (Database, Auth — only if the app has them)
- **CLI tool:** Language · Runtime / framework · Distribution (package registry or binary release)
- **Library / package:** Language · Build system · Package registry · Target platforms / runtimes
- **Other:** ask the developer to name 3–6 stack categories and their values.

For free-form fields use the user-supplied text. Trust internal answers — no validation beyond non-empty.

## Step 2 — Patch `docs/architecture.md`

Run this **before** Step 3 so the README render in Step 3 can mirror the now-final stack values.

- **Purpose section**: replace the `> Unknown — fill in once the project has a clear product purpose.` blockquote body with the supplied purpose paragraph (drop the blockquote).
- **Current stack rows**: replace the entire bullet list under `## Current stack` with one `- <Category>: <value>` row per stack category gathered in Step 1, in the order asked, using the supplied value or `TBD`. Do not keep placeholder rows for categories that do not apply to this project type.
- **Main application areas**: replace the entire placeholder bullet (`- \`src/...\` — Unknown`) with the supplied areas, one bullet per directory in the form `` - `path` — description ``. If the developer supplied "TBD", write a single bullet: `- TBD — source tree not yet established.`

Leave `## Important boundaries` and `## Known constraints` as-is (they fill over time).

## Step 3 — Render `README.md` from `docs/readme-template.md`

1. Read `docs/readme-template.md`.
2. Substitute identity tokens with the answers from Step 1:
   - `{{PROJECT_NAME}}` → project name
   - `{{PROJECT_DESCRIPTION}}` → one-line description
   - `{{PROJECT_PURPOSE}}` → purpose paragraph
3. Replace the entire `## Stack` block in the rendered output with the rows mirrored verbatim from `docs/architecture.md ## Current stack` (single source of truth — architecture.md), one `- <Category>: <value>` per line, with the same categories and order architecture.md now uses.
4. Write the result to `README.md`, overwriting any prior content.

Leave `docs/readme-template.md` in place — it stays in the repo as a reference for the rendering contract.

**Warning:** Re-running this skill overwrites `README.md` entirely. Any `## Getting Started`, `## Running Locally`, or `## Building & Releasing` sections previously appended by the `implement` skill during scaffolding will be wiped. After re-render, re-run implement on the relevant scaffold task to restore them.

## Step 4 — Rewrite the AGENTS.md "Project-specific guidance" section

Locate the trailing section:

```md
## Project-specific guidance

TBD — fill in once the tech stack is established. See `docs/architecture.md`.
```

Replace its body with a short project-specific note: project name (wrapped in `**bold**`), one-line description, link to `docs/architecture.md`. Bold on the project name is required — the visual cue separates project header from the descriptive paragraph below. Example:

```md
## Project-specific guidance

**<project name>** — <one-line description>

See [`docs/architecture.md`](docs/architecture.md) for stack and main application areas. Add project-specific rules here as they are decided (e.g. module boundaries, isolation of platform-specific code, naming for feature folders).
```

Do not invent rules the developer did not state. If the developer offered specific rules during Step 1, capture them as bullets under that section.

## Step 5 — Append stack-specific `.gitignore` entries

The base `.gitignore` only covers OS / editor / env / logs and the local `docs/tasks/` scratch. Append the ignores for the chosen stack so build artifacts and dependencies are not committed.

Manage these idempotently inside a marked block. On first run, append it; on re-run (stack pivot), replace everything between the markers:

```
# --- stack-specific (managed by describe-project) ---
...entries...
# --- end stack-specific ---
```

Pick entries by language / toolchain — include every one that applies:

- **Node / JS / TS:** `node_modules/`, `dist/`, `build/`, `.next/`, `out/`, `coverage/`
- **Python:** `__pycache__/`, `*.pyc`, `.venv/`, `venv/`, `.pytest_cache/`, `*.egg-info/`, `dist/`, `build/`
- **Rust:** `target/`
- **.NET / C#:** `bin/`, `obj/`, `*.user`
- **Go:** `*.exe`, `*.test`, `*.out`
- **Java / Kotlin (Gradle / Maven):** `build/`, `target/`, `.gradle/`
- **Swift / Xcode:** `.build/`, `DerivedData/`, `*.xcuserstate`

If the stack is "TBD" or "Other" with no clear toolchain, skip this step (leave `.gitignore` untouched) and say so in the report.

## Step 6 — Do NOT touch

- `docs/feature-workflow.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`
- `docs/domains/` (domain docs are produced by implement, not here)
- `docs/tasks/` (gitignored local scratch)
- Any file under `.claude/skills/`
- `CLAUDE.md` (it only imports AGENTS.md)

## Step 7 — Report

Run `git status` to confirm which files changed, then print a short receipt:

```
Described project: <project name> (<project type>)
Updated: README.md (rendered from docs/readme-template.md), docs/architecture.md, AGENTS.md, .gitignore
Stack: <comma-separated category: value pairs, or "TBD" for deferred fields>
Next: review the diff (`git diff`), commit the docs changes. For scaffolding (install deps, create source tree, configure tooling), run analyze on a setup task.
```

If the repo has no `graphify-out/` yet, add one line to the receipt: `Once source exists, build the knowledge graph (/graphify . then graphify hook install) so later analyze/implement runs get cheap context.` Do not build it here — this skill writes docs only, and there is nothing to index yet.

## Hard rules

- Never scaffold code, install dependencies, or create source files. This skill writes Markdown docs and the managed `.gitignore` block only.
- Never edit files outside Steps 2–5 (`docs/architecture.md`, `README.md`, `AGENTS.md`, `.gitignore`).
- Only touch `.gitignore` inside the `# --- stack-specific (managed by describe-project) ---` markers — never rewrite the base entries above them.
- Never invent stack values — use `TBD` for anything the developer did not supply.
- Never invent stack categories beyond what the chosen project type defines (or what the developer named for "Other").
- Never delete `docs/readme-template.md` — leave it in the repo as the rendering contract reference.
- Never start scaffolding tasks or decisions — that is the `analyze` skill's job.

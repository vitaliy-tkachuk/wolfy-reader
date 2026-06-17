---
name: describe-project
description: Use when the developer wants to fill project-specific documentation in this ai-spec-template — phrased as "describe project", "fill template docs", "set project description", "/describe-project". Renders README.template.md → README.md, patches docs/architecture.md, and updates the AGENTS.md "Project-specific guidance" section. DOCS-ONLY — no code, dependencies, config files, or source tree. For scaffolding, use the plan + implement skills afterward.
---

# Describe-project skill

Documentation bootstrap. Replace template stubs in `docs/architecture.md` + `AGENTS.md` (`TBD` placeholders, `TBD — fill in once the tech stack is established`) with real project info supplied by the developer, and regenerate `README.md` from `README.template.md` (substituting identity tokens during render — the template itself is never modified). Safe to re-run (e.g. after a stack pivot) — overwrites the same fields, `README.md` is rebuilt from the template each time.

The skill collects project info, patches `docs/architecture.md`, renders `README.template.md` → `README.md` (substituting `{{PROJECT_NAME}}`, `{{PROJECT_DESCRIPTION}}`, `{{PROJECT_PURPOSE}}`; template kept in place), and updates the `## Project-specific guidance` block in `AGENTS.md`.

**Docs-only.** This skill writes Markdown. It does not install dependencies, scaffold code, create config files, or initialize a source tree. Stack values entered here are descriptive text recorded in `docs/architecture.md` — not setup actions. For actual scaffolding, run the `plan` skill on a setup task afterward.

The user's most recent message is the trigger. It may include some project details inline (e.g. "describe project: a CLI for parsing logs, called Foo") — extract whatever is provided before asking.

## Step 1 — Gather project info

Use `AskUserQuestion` for any field the developer did NOT supply inline. Batch into one multi-question call where possible. Required fields:

1. **Project name** — short, used as repo title (e.g. "Foo", "Acme Dashboard").
2. **One-line description** — what the project is, in one sentence.
3. **Purpose** — 2–4 sentences on what problem it solves and for whom.
4. **Stack** — free-form list of the tech choices that actually apply to this project. Only the categories that are relevant (e.g. a CLI may have language + runtime; a web app may add data layer, identity, distribution; a desktop app may add UI framework, packaging, update mechanism). Accept "TBD" for the whole field if nothing is decided. Do not invent categories the developer did not name.
5. **Main application areas** — top-level source directories and what each contains. Accept "TBD" if not started.

For free-form fields use the user-supplied text. Trust internal answers — no validation beyond non-empty.

## Step 2 — Patch `docs/architecture.md`

Run this **before** Step 3 so the README render in Step 3 can mirror the now-final stack values.

- **Purpose section**: replace the `> TBD — fill in once the project has a clear product purpose.` blockquote body with the supplied purpose paragraph (drop the blockquote).
- **Current stack**: replace the placeholder block (the `> Filled by /describe-project ...` blockquote + the `- TBD — stack not yet established.` bullet) with the supplied bullets — one bullet per tech choice in the form `- <Category>: <value>` (e.g. `- Language: Rust`, `- UI framework: Tauri`, `- Packaging: cargo-bundle`). If the developer supplied "TBD" for the whole stack, leave the placeholder block as-is.
- **Main application areas**: replace the placeholder bullet (`- TBD — source tree not yet established.`) with the supplied areas, one bullet per directory in the form `` - `path` — description ``. If the developer supplied "TBD", leave the placeholder bullet as-is.

Leave `## Important boundaries` and `## Known constraints` as-is (they fill over time).

## Step 3 — Render `README.md` from `README.template.md`

1. Read `README.template.md`.
2. Substitute identity tokens with the answers from Step 1:
   - `{{PROJECT_NAME}}` → project name
   - `{{PROJECT_DESCRIPTION}}` → one-line description
   - `{{PROJECT_PURPOSE}}` → purpose paragraph
3. Replace the entire `## Stack` block body in the rendered output with the same bullets used in `docs/architecture.md ## Current stack` (single source of truth — architecture.md), in the same order. If architecture.md still shows the placeholder block, write a single `- TBD` bullet under `## Stack`.
4. Write the result to `README.md`, overwriting any prior content.

Leave `README.template.md` in place — it stays in the repo as a reference for the rendering contract.

**Warning:** Re-running this skill overwrites `README.md` entirely. Any stack-specific sections previously appended by the `implement` skill during scaffolding (setup, run, build, release, etc.) will be wiped. After re-render, re-run implement on the relevant scaffold task to restore them.

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

See [`docs/architecture.md`](docs/architecture.md) for stack and main application areas. Add project-specific rules here as they are decided.
```

Do not invent rules the developer did not state. If the developer offered specific rules during Step 1, capture them as bullets under that section.

## Step 5 — Do NOT touch

- `docs/feature-workflow.md`
- `docs/coding-conventions.md`
- `docs/patterns.md`
- `docs/domains/` (domain docs are produced by implement, not here)
- `docs/tasks/` (gitignored local scratch)
- Any file under `.claude/skills/`
- `CLAUDE.md` (it only imports AGENTS.md)

## Step 6 — Report

Run `git status` to confirm which files changed, then print a short receipt. Branch the `Next:` line on whether stack was supplied:

**Stack supplied (not TBD)** — strong hand-off into scaffolding:

```
Described project: <project name>
Updated: README.md (rendered from README.template.md), docs/architecture.md, AGENTS.md
Stack: <comma-separated values>
Next: review the diff (`git diff`) and commit the docs changes. Then say `/plan scaffold the project` — I'll propose concrete setup options (package manager, config files, source tree, deps) for your stack via AskUserQuestion. After you approve, `/implement <slug>` writes the lockfile, configs, and source dirs so the project actually runs.
```

**Stack deferred (TBD)** — propose stack first:

```
Described project: <project name>
Updated: README.md (rendered from README.template.md), docs/architecture.md, AGENTS.md
Stack: TBD
Next: review the diff (`git diff`) and commit the docs changes. Then say `/plan propose a stack for this project` — I'll surface 2–4 stack bundles with trade-offs via AskUserQuestion. Once a bundle is picked, the same skill scaffolds the setup task; `/implement <slug>` brings the project to life.
```

## Hard rules

- Never scaffold code, install dependencies, or create config files. Markdown only.
- Never edit files outside the Step 2–4 list.
- Never invent stack values — use `TBD` for anything the developer did not supply.
- Never delete `README.template.md` — leave it in the repo as the rendering contract reference.
- Never start scaffolding tasks or decisions — that is the `plan` skill's job.

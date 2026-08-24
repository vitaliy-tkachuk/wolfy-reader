# wolfyReader

A from-scratch, zero-runtime-dependency ebook reading and display library for the browser.

## Overview

wolfyReader renders ebooks in the browser — EPUB, FB2 and plain text today, MOBI/AZW3 later — with paginated and scrolled reading, chapter and TOC navigation, in-book search, and live appearance controls for font, theme and margins. It is built from scratch on platform primitives, carries zero runtime dependencies, and treats its API as a promise rather than a moving target: the `Book` model and the `Position` format are covered by semver. Reading position survives font-size and layout changes, and untrusted book content renders inside a hardened sandboxed iframe. It targets developers who want a reader that is small, pleasant to use, and safe with untrusted files — not a spec-conformance or DRM reading system.

## Stack

- Language: TypeScript — ESM only (`"type": "module"`), no CJS build
- Build system: TypeScript compiler (`tsc`), no bundler; `node:test` for tests, Playwright for browser tests (dev-only)
- Package registry: npm — `wolfyreader` (unscoped; availability confirmed)
- Target platforms / runtimes: Browsers with `DecompressionStream` — Chrome 80+, Safari 16.4+, Firefox 113+

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

### Knowledge graph

If `graphify-out/graph.json` is present, it is a committed [graphify](https://github.com/safishamsi/graphify) knowledge graph of this repo. Agents query it before reading files (`graphify query "<question>"`), which is far cheaper than sweeping the tree — see [`AGENTS.md`](AGENTS.md#knowledge-graph--query-it-first-to-save-tokens).

The graph auto-rebuilds after each commit via local git hooks. Those hooks are not committed, so run `graphify hook install` once per clone. If the repo has no graph yet, build one with `/graphify .` and commit `graphify-out/`.

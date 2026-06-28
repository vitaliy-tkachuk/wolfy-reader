# Domains

Durable, per-domain knowledge lives here — one file per domain, e.g. `auth.md`, `billing.md`, `search.md`. A *domain* is a coherent slice of the product (a feature area, a subsystem), not a single task.

This is the **permanent record** of work in the project. Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored; when a task finishes, its durable knowledge is distilled into the relevant domain doc and the task file is deleted. Cross-cutting architectural decisions go in [`../architecture.md`](../architecture.md) instead; domain-local decisions stay here.

## Domain doc shape

Create a domain doc the first time a domain gets real implementation. Keep it short and current — prune what no longer holds. Use this section structure:

```md
# <Domain> domain

## Overview
What this domain is responsible for and where its code lives (`src/...`).

## Key decisions
Domain-local choices and why. Date significant ones. For cross-cutting
architectural decisions, link to docs/architecture.md instead of duplicating.

## Implementation notes
How it actually works — important flows, invariants, integration points.

## Gotchas
Non-obvious constraints, edge cases, things that bit us.

## Patterns
Reusable patterns local to this domain. Cross-domain patterns go in docs/patterns.md.
```

Omit sections that have nothing real in them yet.

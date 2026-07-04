# Domains

Durable, per-domain knowledge lives here — one file per domain, e.g. `auth.md`, `billing.md`, `search.md`. A *domain* is a coherent slice of the product (a feature area, a subsystem), not a single task.

This is the **permanent record** of work in the project. Task files (`docs/tasks/`) are ephemeral, local-only, and gitignored; when a task finishes, its durable knowledge is distilled into the relevant domain doc and the task file is deleted. Cross-cutting architectural decisions go in [`../architecture.md`](../architecture.md) instead; domain-local decisions stay here.

## Domain doc shape

Create a domain doc the first time a domain gets real implementation. Keep it short and current — prune what no longer holds. Use this section structure:

**Describe the current state, not the history of changes.** A domain doc says what the system *is* and *why* — not how it got there. No changelog narrative: no "was X, then became Y", "an earlier iteration", "before that", "later moved", "reverses the earlier approach". When you change behavior, **edit the affected lines to describe the new reality and delete the old** — do not append a note about what changed. Keep *live* rationale ("we use X rather than Y because Z" — it stops the choice being re-litigated); if a past reversal carries a real caution, state it in the present tense as a Gotcha ("STT auto-detects language — do not gate it on the user's recorded preference"), not as a story about what was tried.

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

# Architecture

> This file holds global architecture **and** cross-cutting decisions (stack, database, auth, deployment, API style, etc.) woven into the section each affects — date significant ones inline. Domain-local decisions live in `docs/domains/<domain>.md` instead. There is no separate decisions folder.

## Purpose

Short description of what this application does.

> Unknown — fill in once the project has a clear product purpose.

## Current stack

> Populated by `/describe-project` with the categories relevant to this project's type (web, desktop, CLI, library, …). The rows below are placeholders for an unknown type.

- Language: Unknown
- Framework: Unknown
- Deployment / distribution: Unknown

## Main application areas

- `src/...` — Unknown

## Important boundaries

Document architectural rules here as they are decided.

Examples (pick what fits the project type):

- Core logic stays free of I/O and side effects; I/O lives at the edges.
- External access (DB, network, filesystem) goes through one approved layer, not scattered across modules.
- Platform- or OS-specific code is isolated behind an abstraction, kept out of core logic.
- The public API surface stays separate from internal implementation details.

## Known constraints

- None recorded yet.

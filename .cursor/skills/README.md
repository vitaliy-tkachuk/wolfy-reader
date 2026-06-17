# Cursor skills mirror

These skill folders are a **byte-for-byte mirror** of `.claude/skills/`. They exist because Cursor reads skills from `.cursor/skills/` and Claude Code reads from `.claude/skills/`, but the `SKILL.md` format is identical across both.

## Sync rule

If you edit a `SKILL.md` here, mirror the change in `.claude/skills/<name>/SKILL.md` (and vice versa). Drift between the two breaks the cross-tool guarantee in [`AGENTS.md`](../../AGENTS.md).

Quick sync check from repo root:

```sh
diff -r .claude/skills .cursor/skills
```

Empty output = in sync.

## Why mirror instead of symlink

Symlinks survive `git`, but break on Windows checkouts without `core.symlinks=true`. A plain copy + diff check is portable and obvious.

# opencode-triage — Agent Guide

## What this is

Deterministic skill router for OpenCode. Published as `opencode-triage` on npm.

## Entrypoints

- **Plugin** (`src/index.ts`) — exports `TriagePlugin`, consumed by OpenCode Bun runtime. No build step.
- **CLI** (`cli.cjs`) — standalone Node.js script for user commands.

## Commands

```sh
npm run check    # tsc --noEmit (only check, no build/compile)
```

No test runner, no linter, no formatter config. No tsconfig.json in repo.

## Architecture

- Scans 6 directories: `.agent/skills/`, `.claude/skills/`, `.opencode/skills/` (project) + `~/.agents/skills/`, `~/.claude/skills/`, `~/.config/opencode/skills/` (global)
- Matches both `SKILL.md` (active) and `SKILL.md.disabled` (hidden from prompt)
- Keyword scoring: `THRESHOLD=30`, `MIN_WORD_LENGTH=3`, `NAME_WEIGHT=3`, `DESC_WEIGHT=1`
- "triage" directory is always excluded
- Frontmatter keys parsed: `name` (falls back to directory name), `description` (supports folded `>` syntax)

## CLI behavior

- `/triage on` — renames `SKILL.md` → `SKILL.md.disabled` (hides skills), adds `"triage"` to `opencode.json` plugin array
- `/triage off` — renames `SKILL.md.disabled` → `SKILL.md` (exposes skills), removes `"triage"` from plugin array
- Always requires restart after toggle

## Publishing

`npm publish` — files included via `"files": ["src/", "cli.cjs", "README.md"]` in package.json. `.npmignore` excludes `*.tgz`, `.eslintrc*`, `tsconfig.json`.

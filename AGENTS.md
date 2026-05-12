# opencode-triage — Agent Guide

## What this is

Deterministic skill router for OpenCode. Published as `opencode-triage` on npm.

## Entrypoints

- **Plugin** (`src/index.ts`) — exports `server`, consumed by OpenCode Bun runtime. No build step.
- **CLI** (`bin/opencode-triage.cjs`) — standalone Node.js script for user commands.
- **Postinstall** (`postinstall.cjs`) — auto-creates `/triage` command file on npm install.

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

- Default scope is **global**. Use `--local` flag for project-level, `--both` for both.
- `/triage on` — hides global skills
- `/triage on --local` — hides project skills
- `/triage on --both` — hides skills in both global and local scopes
- `/triage off` — exposes global skills
- `/triage off --local` — exposes project skills
- `/triage off --both` — exposes skills in both global and local scopes
- `/triage status` — shows plugin state + all skills (project + global)
- Each scope is independent — 4 possible combinations (or use `--both` for atomic toggle)
- Always requires restart after toggle

## Postinstall

- Detects global vs local via `npm_config_global` env var
- Auto-creates command file: `~/.config/opencode/commands/triage.md` (global) or `.opencode/commands/triage.md` (local)
- Command template uses `npx -y opencode-triage $ARGUMENTS`

## Publishing

`npm publish` — files included via `"files": ["src/", "bin/", "postinstall.cjs", "README.md"]` in package.json. `.npmignore` excludes `*.tgz`, `.eslintrc*`, `tsconfig.json`.

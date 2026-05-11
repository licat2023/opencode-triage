# opencode-triage

> Deterministic skill router for OpenCode. Save up to 94% of tokens by hiding skills from the system prompt and loading them only when needed.

## Quick Start

```bash
npm install -g opencode-triage
```

Restart OpenCode, then type `/triage on`. That's it.

## LLM Quick-Install

Copy-paste this into any LLM:

```text
Install opencode-triage (https://github.com/cascharly/opencode-triage) — a deterministic skill router for OpenCode.

1. Run: npm install -g opencode-triage
2. If any errors occur, visit the repo link above and resolve them.
3. Tell me to restart OpenCode.
```

## What It Does

Normally **all** your skills sit in the system prompt and burn tokens on every message — even when irrelevant. Triage hides them and loads the right one **only when the LLM needs it**.

```
No triage:   [skill A] [skill B] [skill C] ...  ← always burning tokens
With triage: triage({ query }) → finds the right skill → returns it only when needed
```

Skills are renamed from `SKILL.md` → `SKILL.md.disabled` to hide them from OpenCode's discovery. Run `/triage off` to restore.

## Install

### Global (recommended)

```bash
npm install -g opencode-triage
```

Restart OpenCode. `/triage` is available in **every** project. Type `/triage on` to enable.

### Per-project

```bash
npm install opencode-triage
```

Restart OpenCode. `/triage` is available only in this project. Type `/triage on --local` to enable.

## Commands

| Command | What it does |
|---|---|
| `/triage on` | Hide global skills |
| `/triage on --local` | Hide project skills for this project |
| `/triage off` | Show global skills again |
| `/triage off --local` | Show project skills again |
| `/triage status` | See what's hidden and what's active |
| `/triage compare` | Token savings estimate for your skills |

Global affects `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agent/skills/`.
Local affects `.opencode/skills/`, `.claude/skills/`, `.agent/skills/` in the current project.

## How It Works

The LLM calls `triage()` when it encounters a task it can't handle with general knowledge. The plugin scores all hidden skills against the query using keyword matching and returns the best match.

```
User: "backup my database"
  │
  ▼
LLM: triage({ query: "backup my database" })
  │
  ▼
Plugin: scans filesystem → scores skills → returns best match
  backup-restore     score=60  (matched: backup, database)
  database-sync      score=25  (matched: database)
  gap=35 ≥ threshold(30) → HIGH CONFIDENCE
```

No LLM reasoning overhead. No extra API calls. Just fast deterministic matching.

## Token Savings

| | Without Triage | With Triage |
|---|---|---|
| Skills in prompt (per msg, 20 skills) | ~1,000 | ~40 |
| Session total (10 msgs, 5 lookups) | ~11,050 | ~675 |
| **Savings** | — | **~94%** |

Run `/triage compare` for live numbers based on your skill inventory.

## IMPORTANT: Cross-Tool Impact

Triage renames `SKILL.md` → `SKILL.md.disabled` on disk. Other AI tools that scan the same directories (Claude Code, Cursor, Windsurf) will also see skills as hidden. Run `/triage off` to restore.

Use `/triage on --local` to isolate triage to one project without affecting global skills.

## Uninstall

**Expose skills** (reversible — plugin and command stay):

```
/triage off
```

**Remove the package:**

```bash
npm uninstall -g opencode-triage
```

Delete the command file if present:

```bash
rm ~/.config/opencode/commands/triage.md   # macOS/Linux
del %USERPROFILE%\.config\opencode\commands\triage.md   # Windows
```

Restart OpenCode. Clean.

For per-project installs, remove `"opencode-triage"` from `.opencode/opencode.json` and run `npm uninstall opencode-triage`.

## Compatibility

- OpenCode 1.14+
- Bun runtime (bundled with OpenCode)
- Node.js 18+ (for CLI script)

## License

MIT

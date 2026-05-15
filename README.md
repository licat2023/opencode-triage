# opencode-triage

> opencode-triage strips skill definitions from the main prompt and routes them on demand. Instead of loading every skill into every message, it uses keyword matching to activate only what you need. Cuts prompt token costs by up to 90% — no LLM overhead, no extra API calls, zero setup.

## What It Does

**This plugin saves tokens on skills only.** The rest of your system prompt (instructions, tools, etc.) is untouched.

Normally all your skills sit in the system prompt and burn tokens on every message — even when irrelevant. Triage hides just the skills and loads the right one **only when the LLM needs it**.

```
No triage:   [skill A] [skill B] [skill C] ...  ← always burning tokens
With triage: triage({ query }) → finds the right skill → returns it only when needed
```

Skills are renamed from `SKILL.md` → `SKILL.md.disabled` to hide them from OpenCode's discovery. Run `/triage off` to restore.

Since only the matched skill is loaded at lookup time, you can install virtually unlimited skills without burning any tokens on idle ones.

## Quick Start

```bash
npm install -g opencode-triage
```

Restart OpenCode, then type `/triage on`. That's it.

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

## LLM Quick-Install

Copy-paste this into any LLM:

```text
Install opencode-triage (https://github.com/cascharly/opencode-triage) — a deterministic skill router for OpenCode.

1. Run: npm install -g opencode-triage
2. If any errors occur, visit the repo link above and resolve them.
3. Tell me to restart OpenCode.
```

## Commands

| Command | What it does |
|---|---|
| `/triage on` | Hide skills in both scopes (global + local) |
| `/triage off` | Expose skills in both scopes (global + local) |
| `/triage status` | See what's hidden and what's exposed |
| `/triage compare` | Token savings estimate for your skills |

### Flags

| Flag | Where | What it does |
|---|---|---|
| `--json` | All commands | Machine-readable JSON output |
| `--quiet` | on/off | Suppress non-error output |
| `--dry-run` | on/off | Preview changes without renaming |
| `--all` | status | Show full skill list without truncation |

All commands can also be run directly in your terminal via `npx opencode-triage <command>` (e.g., `npx opencode-triage on --local`, `npx opencode-triage on --both`). No OpenCode session needed.

Global affects `~/.config/opencode/skills/`, `~/.claude/skills/`, `~/.agents/skills/`.
Local affects `.opencode/skills/`, `.claude/skills/`, `.agent/skills/`, `.agents/skills/` in the current project.

### Configuration Combinations

With a global skill A and a project skill B:

| State | Global (A) | Project (B) | How to configure |
|---|---|---|---|
| Full exposure | exposed | exposed | `/triage off` (or default state) |
| Full triage | hidden | hidden | `/triage on` |
| Triage globally only | hidden | exposed | `/triage on --global` (advanced) |
| Triage in project only | exposed | hidden | `/triage on --local` (advanced) |

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

### Why "Triage"?

In emergency medicine, a triage nurse quickly assesses each patient's condition and routes them to the right specialist — never loading every patient into every doctor's office at once. Same idea here.


## Under the Hood

### Plugin Activation

`opencode-triage` is a standard opencode plugin registered in the `"plugin"` array of `opencode.json` (both `~/.config/opencode/opencode.jsonc` globally and `.opencode/opencode.json` per-project). On startup, opencode loads all listed plugins, making their tools and commands available. The plugin registers the `triage` tool in the system prompt alongside `read`, `write`, `bash`, etc.

### How Hiding Skills Works

Skills live in up to seven directories:

| Path | Scope |
|------|-------|
| `.opencode/skills/<name>/` | Project |
| `.claude/skills/<name>/` | Project |
| `.agent/skills/<name>/` | Project |
| `.agents/skills/<name>/` | Project |
| `~/.config/opencode/skills/<name>/` | Global |
| `~/.claude/skills/<name>/` | Global |
| `~/.agents/skills/<name>/` | Global |

When you run `/triage on`, the CLI renames every `SKILL.md` to `SKILL.md.disabled` across all seven directories. OpenCode's system prompt only loads files named `SKILL.md` (not `.disabled`), so all skills disappear from the prompt instantly.

```
Before (/triage on):
  .agent/skills/backup-restore/SKILL.md          ← loaded into prompt
  ~/.agents/skills/database-sync/SKILL.md        ← loaded into prompt

After (/triage on):
  .agent/skills/backup-restore/SKILL.md.disabled  ← hidden
  ~/.agents/skills/database-sync/SKILL.md.disabled ← hidden
```

`/triage off` reverses the operation — it renames every `SKILL.md.disabled` back to `SKILL.md`, restoring native discovery.

The `/triage status` command detects the current state by scanning all seven directories for both `.md` and `.md.disabled` extensions, showing skills grouped by scope with `[hidden]`/`[exposed]` colored badges. It also warns when the plugin is ACTIVE but some skills remain exposed (out-of-sync state).

### How Routing Works

The triage router is a registered plugin tool. When called, it runs a deterministic 5-step routing process:

1. **Discover** — Scans directories for skill files, extracts name and description from frontmatter. Results are cached with a 5s TTL so CLI toggles are picked up without restart.

2. **Match** — Scores query keywords against each skill — exact word match = 15pts, partial = 10pts. Found in name → ×3, found in description → ×1. Name matches dominate.

3. **Route** — Auto-selects the clear winner (gap ≥ 30) or returns a top-5 shortlist for manual pick.

4. **Load** — Reads the matched file, strips frontmatter, returns the instructions.

5. **Notify** — Shows a TUI toast confirming the routing result.

This means adding a new skill to your triage-managed setup is as simple as creating `<name>/SKILL.md` in any of the seven directories and running `/triage on` — the router auto-discovers it after the next OpenCode restart via step 1. No configuration or registration needed.

## Token Savings (skills only)

Real data from this project (20 skills, full content):

```
Cost Comparison Global + Local

Skills: 20 hidden · 0 exposed · 20 total

                        WITH triage           WITHOUT
──────────────────      ────────────────────  ────────────────────
Prompt per call         3279 tokens           36398 tokens
  Tool definition       59 tokens             0 tokens
  Skill read            3220 tokens           36398 tokens
──────────────────      ────────────────────  ────────────────────
Saved per call          33119 tokens (91%)

Time: 0.2ms (triage) vs 7.3ms (all skills)

Top skills by full content size:
  code-security                  ~3220 tokens
  ai-agent-builder               ~3220 tokens
  security-monitoring            ~2971 tokens
  webhook-automation             ~2839 tokens
  database-sync                  ~2759 tokens
```

Run `/triage compare` for live numbers based on your skill inventory.

## Cross-Tool Impact

Triage renames `SKILL.md` → `SKILL.md.disabled` on disk. Other AI tools that scan the same directories (Claude Code, Cursor, Windsurf) will not see them either — the skills are hidden from all tools. Run `/triage off` to restore.

Use `/triage on --local` to isolate triage to one project without affecting global skills. Use `/triage on --both` to enable triage in all scopes at once.

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

```shell
rm ~/.config/opencode/commands/triage.md           # macOS / Linux
```

```cmd
del %USERPROFILE%\.config\opencode\commands\triage.md  # Windows (cmd)
```

Restart OpenCode. Clean.

For per-project installs, remove `"opencode-triage"` from `.opencode/opencode.json` and run `npm uninstall opencode-triage`.

## Compatibility

- OpenCode 1.14+
- Bun runtime (bundled with OpenCode)
- Node.js 18+ (for CLI script)

## License

MIT

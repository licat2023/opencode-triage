# opencode-triage

> OpenCode already lazy-loads skill bodies — but it still injects every skill's name and description (from `SKILL.md` frontmatter) into the prompt on every message. With a growing skill library and verbose descriptions, that can mean hundreds of tokens burned before you type a word. opencode-triage eliminates that XML list entirely, replacing it with a single 59-token tool definition and routing on-demand via keyword matching.

## What It Does

**This plugin saves tokens on skills only.** The rest of your system prompt (instructions, MCP tools, etc.) is untouched.

OpenCode already lazy-loads full skill bodies — they're only fetched when the LLM explicitly calls the `skill()` tool. What it always injects, on every message, is a listing of every skill's name and description (from `SKILL.md` frontmatter) inside the `skill` tool definition:

```xml
<available_skills>
  <skill><name>llm-security</name><description>Security guidelines for LLM applications...</description></skill>
  <skill><name>semgrep</name><description>Run Semgrep static analysis scans...</description></skill>
  ... (grows with every skill you add)
</available_skills>
```

With triage ON, all `SKILL.md` files are renamed to `.disabled` — OpenCode's skill tool disappears entirely. Only the triage tool remains (59 tokens). The right skill body is still fetched on demand when needed, same as before.

```
No triage:   [name+desc of A] [name+desc of B] [name+desc of C] ...  ← every message
With triage: triage({ query }) → keyword match → loads one skill body when needed
```

Since only the matched skill is loaded at lookup time, you can install virtually unlimited skills without burning any tokens on their idle name+description listings. And because the native `<available_skills>` XML grows with every skill you add, **the more skills you install, the more triage saves** — each new skill adds its name+description to the native prompt on every message, but adds zero tokens when triage is on.

## Quick Start

```bash
npm install -g opencode-triage
```

Restart OpenCode, then type `/triage on`. That's it.

## Install

### Global (recommended)

Same as Quick Start above. `/triage` is available in **every** project.

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
| `/triage dedupe` | Remove project-level duplicates of global skills |
| `/triage compare` | Token savings estimate for your skills |

### Flags

| Flag | Where | What it does |
|------|-------|--------------|
| `--json` | All commands | Machine-readable JSON output |
| `--quiet` | on/off | Suppress non-error output |
| `--dry-run` | on/off, dedupe | Preview changes without renaming |
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
  .agent/skills/backup-restore/SKILL.md          ← name+desc listed in prompt
  ~/.agents/skills/database-sync/SKILL.md        ← name+desc listed in prompt

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

## Token Savings (skills only)

Real data from this project (19 skills). The comparison is between what lives in the
prompt on **every message** — full skill bodies are fetched on-demand in both modes
and cost the same either way.

```
Cost Comparison Global + Local

Skills: 19 hidden · 0 exposed · 19 total

                        WITH triage           WITHOUT (native)
──────────────────      ────────────────────  ────────────────────
Prompt per call         59 tokens             1226 tokens
  Tool definition       59 tokens             32 tokens
  Skill list XML        0 tokens              1194 tokens
  (skill body*)         same for both →       loaded on-demand
──────────────────      ────────────────────  ────────────────────
Saved per call          1167 tokens (95%)

* Skill body is fetched on-demand in both modes — equal cost, not counted above.

Top skills by name+desc size (what actually costs per-prompt):
  llm-security                   ~167 tokens  (full body: ~1299)
  semgrep                        ~150 tokens  (full body: ~2419)
  vercel-react-best-practices    ~104 tokens  (full body: ~1576)
  context7-mcp                   ~84 tokens   (full body: ~641)
```

> **Note:** description verbosity directly drives prompt cost. `llm-security`'s
> 167-token description is the single biggest cost driver here — keep descriptions
> specific but concise for maximum savings.

Run `/triage compare` for live numbers based on your skill inventory.

## Cross-Tool Impact

Triage renames `SKILL.md` → `SKILL.md.disabled` on disk. Other AI tools that scan the same directories (Claude Code, Cursor, Windsurf) will not see them either — the skills are hidden from all tools. Run `/triage off` to restore.

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

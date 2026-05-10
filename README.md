# opencode-triage

> Deterministic skill router for OpenCode. Saves ~94% tokens by keeping skills
> out of the system prompt and routing via keyword matching instead of LLM reasoning.

## LLM Quick-Install

Copy-paste the entire section below into any LLM to install automatically:

**Install opencode-triage — deterministic skill router for OpenCode**

1. Fetch files from https://github.com/cascharly/opencode-triage
   - `src/index.ts` → write to `.opencode/plugins/triage.ts`
   - `cli.js` → write to `.opencode/plugins/triage-cli.js`

2. Open `.opencode/opencode.json`. Add `"triage"` to the `"plugin"` array:
   ```json
   { "plugin": ["triage"] }
   ```

3. Create `.opencode/commands/triage.md`:
   ```markdown
   ---
   description: Toggle, inspect, and benchmark the triage skill router
   ---
   Run `node .opencode/plugins/triage-cli.js $ARGUMENTS` and show the output verbatim.
   If output contains "Restart opencode", tell the user to restart.
   ```

4. Run `node .opencode/plugins/triage-cli.js on`

5. Tell the user to restart opencode.

## Features

- **94% token savings** — skills hidden from system prompt, routed on demand
- **Deterministic matching** — keyword scoring, not LLM guessing across a long list
- **Zero side effects** — read-only plugin, never modifies your skill files
- **Cross-platform** — macOS, Linux, Windows (native + WSL)
- **One-click uninstall** — `/triage off` restores everything to native

## Install

### npm (recommended)

Add to `.opencode/opencode.json`:

```json
{
  "plugin": ["opencode-triage"]
}
```

OpenCode auto-installs it via Bun on restart. Then run:

```
/triage on
```

### Manual

Copy `triage.ts` and `triage-cli.js` into `.opencode/plugins/`, `triage.md` into `.opencode/commands/`, and add `"triage"` to the plugin array.

## Commands

| Command | Description |
|---------|-------------|
| `/triage on` | Enable plugin + hide all skills from system prompt |
| `/triage off` | Disable plugin + restore native skill discovery |
| `/triage status` | Show plugin state, hidden/active counts, token estimate |
| `/triage compare` | Token/time cost comparison table |
| `/triage help` | Full usage guide |

## How it works

Skills remain as standard `SKILL.md` files with YAML frontmatter. The `.disabled` suffix hides them from OpenCode's native discovery. The triage plugin scans the filesystem directly and routes queries via keyword scoring.

```
User: "backup my database"
        │
        ▼
LLM:   triage({ query: "backup my database" })
        │
        ▼
Plugin: scans filesystem → scores skills against query
        backup-restore     score=60  (matched: backup, database)
        database-sync      score=25  (matched: database)
        gap=35 ≥ threshold(30) → HIGH CONFIDENCE
        │
        ▼
Plugin: returns matched skill content directly
```

## Token Savings

| | Without Triage | With Triage |
|---|---|---|
| System prompt (per msg, 20 skills) | ~1,000 | ~40 |
| Skill lookup overhead | ~210 | ~55 |
| Session total (10 msgs, 5 lookups) | ~11,050 | ~675 |
| **Savings** | — | **94%** |

Run `/triage compare` for live numbers based on your skill inventory.

## Discovery Paths

The plugin scans both `.md` and `.disabled` skill files in:

| Path | Scope |
|------|-------|
| `.opencode/skills/<name>/` | Project |
| `.claude/skills/<name>/` | Project |
| `.agent/skills/<name>/` | Project |
| `~/.config/opencode/skills/<name>/` | Global |
| `~/.claude/skills/<name>/` | Global |
| `~/.agents/skills/<name>/` | Global |

## Uninstall

```
/triage off
<restart opencode>
```

Remove `"opencode-triage"` from `opencode.json`. Zero residue.

## Compatibility

- OpenCode 1.14+
- Bun runtime (bundled with OpenCode)
- Node.js 18+ (for CLI script)

## License

MIT

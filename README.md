# opencode-triage

> Deterministic skill router for OpenCode. Save OpenCode tokens by keeping skills
> out of the system prompt and routing via keyword matching instead of LLM reasoning.

## Mental Model

Skills are specialized instructions loaded into the system prompt. Normally, **all** skills are visible and consume tokens on every message — even when irrelevant. This is the biggest source of wasted tokens in OpenCode's AI coding agent workflow.

Triage flips this: skills are hidden from the system prompt and fetched **on demand** via a `triage()` tool the LLM calls when it needs help. Reduce OpenCode token usage by up to 94% with zero impact on capability.

```
No triage:   [skill A] [skill B] [skill C] ...  ← all in prompt, always burning tokens
With triage: triage({ query }) → finds the right skill → returns it only when needed
```

**The lifecycle of a skill:**

```
SKILL.md                    SKILL.md.disabled
  │                              │
  │  exposed in prompt           │  hidden from prompt
  │  cost: ~50 tokens/msg        │  cost: 0 tokens/msg
  │                              │
  └─── /triage on ──────────────▶
  ◀─── /triage off ─────────────┘
```

The LLM calls `triage()` when it encounters a task it can't handle with general knowledge. The plugin scores installed skills against the query using keyword matching and returns the best match. No skills in the prompt, no LLM guessing across a long list, and no wasted tokens. This is the most effective OpenCode token optimization available.

## LLM Quick-Install

Copy-paste this into any LLM:

```text
Install opencode-triage — a deterministic skill router for OpenCode.

1. Read https://github.com/cascharly/opencode-triage/blob/main/src/index.ts and write it to .opencode/plugins/opencode-triage.ts
2. Read https://github.com/cascharly/opencode-triage/blob/main/triage-cli.cjs and write it to .opencode/commands/triage-cli.cjs
3. Open .opencode/opencode.json and add "opencode-triage" to the "plugin" array
4. Create .opencode/commands/triage.md with this content:
   ---
   description: Toggle, inspect, and benchmark the triage skill router
   ---
   Run node .opencode/commands/triage-cli.cjs $ARGUMENTS and show the output verbatim.
   If output contains "Restart opencode", tell the user to restart.
5. Run: node .opencode/commands/triage-cli.cjs on
6. Tell me to restart opencode.
```

## Features

- **94% token savings** — save OpenCode tokens by removing skills from the system prompt, zero token cost on every idle message
- **Deterministic routing** — same query always returns the same skill, no hallucinated names or wrong routes
- **Zero overhead when idle** — skills don't exist until `triage()` is called, no cost until you need one
- **Cross-platform** — macOS, Linux, Windows (native + WSL)
- **One-click uninstall** — `/triage off` restores everything to native
- **Open source & free** — MIT license, install via npm with zero dependencies beyond OpenCode itself

## Install

### npm (recommended)

The fastest way to reduce OpenCode token usage — install the opencode-triage plugin and hide all skills from the system prompt in seconds.

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

Copy `opencode-triage.ts` into `.opencode/plugins/`, `triage-cli.cjs` into `.opencode/commands/`, and add `"opencode-triage"` to the plugin array.

## Commands

| Command | Description |
|---------|-------------|
| `/triage on` | Enable plugin + hide all skills from system prompt |
| `/triage off` | Disable plugin + restore native skill discovery |
| `/triage status` | Show plugin state, hidden/active counts, token estimate |
| `/triage compare` | Token/time cost comparison table |
| `/triage help` | Full usage guide |

## How it works

Skills remain as standard `SKILL.md` files with YAML frontmatter. The `.disabled` suffix hides them from OpenCode's native discovery. The triage plugin scans the filesystem directly and routes queries via keyword scoring — no LLM reasoning overhead, no extra API calls, just fast deterministic matching.

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

## User Flow

Here's what a typical session looks like with opencode-triage enabled:

**1. Session starts** — all skills are hidden from the system prompt. Zero token overhead.

**2. General question — no skills needed:**

```
User: "What does this function do?"
```

The LLM answers with its general knowledge. No triage call fires. Zero extra tokens spent.

**3. Specialized task — clear match:**

```
User: "Backup my PostgreSQL database to S3"
```

The LLM recognizes this needs specialized knowledge and calls:

```
triage({ query: "Backup my PostgreSQL database to S3" })
```

The plugin scores all hidden skills:

```
backup-restore     score=60  (name:backup, desc:database)
database-sync      score=25  (desc:database)
webhook-automation score=0   (no match)
```

Gap = 35 ≥ threshold (30) → **high confidence**. The plugin returns the `backup-restore` skill content directly. The LLM now has the exact instructions it needs.

**4. Ambiguous task — multiple candidates:**

```
User: "Set up the database"
```

Multiple skills match with similar scores:

```
backup-restore     score=30  (desc:database)
database-sync      score=30  (name:database)
```

Gap = 0 < threshold → **ambiguous**. The plugin returns the top candidates:

```
Multiple matches for "Set up the database". Pick one:
1. backup-restore — Backup and restore databases
2. database-sync — Synchronize databases across servers

Example: triage({ query: "backup-restore" })
```

The LLM picks the right one based on context and calls triage again with the skill name.

## Token Savings

This is where opencode-triage delivers the most value. Every message without triage burns tokens on skills you don't need. With triage, you only pay for the skill you actually use.

| | Without Triage | With Triage |
|---|---|---|
| System prompt (per msg, 20 skills) | ~1,000 | ~40 |
| Skill lookup overhead | ~210 | ~55 |
| Session total (10 msgs, 5 lookups) | ~11,050 | ~675 |
| **Savings** | — | **94%** |

Run `/triage compare` for live numbers based on your skill inventory. The more skills you have, the more tokens you save with opencode-triage.

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

Remove `"opencode-triage"` from `opencode.json`. Zero residue. All skills work natively again.

## Compatibility

- OpenCode 1.14+
- Bun runtime (bundled with OpenCode)
- Node.js 18+ (for CLI script)

## License

MIT

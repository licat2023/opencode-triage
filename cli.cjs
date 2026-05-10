#!/usr/bin/env node
/*
 * opencode-triage CLI
 * ==================
 * Manage the triage skill router plugin.
 *
 * Usage: /triage on | off | status | compare | help
 *
 * Quickstart:
 *   /triage on        Enable plugin + hide skills from system prompt
 *   /triage off       Disable plugin + restore native skill discovery
 *   /triage status    Show current plugin state and skill counts
 *   /triage compare   Show token/time cost comparison table
 *   /triage help      Show full usage guide
 */

const fs = require("fs")
const path = require("path")
const os = require("os")

const CMD = process.argv[2] || "help"
const WORKTREE = process.cwd()
const CONFIG_PATH = path.join(WORKTREE, ".opencode", "opencode.json")
const HOMEDIR = os.homedir()

const SKILL_DIRS = [
  { base: path.join(WORKTREE, ".agent", "skills"), label: ".agent/" },
  { base: path.join(WORKTREE, ".claude", "skills"), label: ".claude/" },
  { base: path.join(WORKTREE, ".opencode", "skills"), label: ".opencode/" },
  { base: path.join(HOMEDIR, ".agents", "skills"), label: "~/.agents/" },
  { base: path.join(HOMEDIR, ".claude", "skills"), label: "~/.claude/" },
  { base: path.join(HOMEDIR, ".config", "opencode", "skills"), label: "~/.config/opencode/" },
]

const YELLOW = "\x1b[33m"
const GREEN = "\x1b[32m"
const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"

// ── Main Router ───────────────────────────────────────────

function main() {
  switch (CMD) {
    case "on":
    case "enable":
      return toggle(true)
    case "off":
    case "disable":
      return toggle(false)
    case "status":
      return showStatus()
    case "compare":
      return showCompare()
    case "help":
    case "--help":
    case "-h":
      return showHelp()
    default:
      console.error(`Unknown command: ${CMD}`)
      console.error()
      console.error(`Usage: /triage on | off | status | compare | help`)
      console.error(`Try /triage help for detailed usage.`)
      process.exit(1)
  }
}

// ── toggle ────────────────────────────────────────────────

function toggle(enable) {
  const fromExt = enable ? ".md" : ".md.disabled"
  const toExt = enable ? ".md.disabled" : ".md"
  let renamedProject = 0
  let renamedGlobal = 0

  for (const { base, label } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory() || d.name === "triage") continue
      const src = path.join(base, d.name, `SKILL${fromExt}`)
      const dst = path.join(base, d.name, `SKILL${toExt}`)
      if (fs.existsSync(src)) {
        fs.renameSync(src, dst)
        if (label.startsWith("~")) renamedGlobal++
        else renamedProject++
      }
    }
  }

  // Update opencode.json
  let config = {}
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"))
  } catch {
    config = { "$schema": "https://opencode.ai/config.json" }
  }
  config.plugin = config.plugin || []
  if (enable && !config.plugin.includes("triage")) {
    config.plugin.push("triage")
  } else if (!enable) {
    config.plugin = config.plugin.filter(p => p !== "triage")
  }
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")

  const totalRenamed = renamedProject + renamedGlobal
  console.log()
  console.log(BOLD + (enable ? "Triage ON" : "Triage OFF") + RESET)
  console.log()
  console.log(`Skills ${enable ? "hidden" : "exposed"}: ${totalRenamed} file(s) renamed`)
  if (renamedProject) console.log(`  Project: ${renamedProject}`)
  if (renamedGlobal) console.log(`  Global:  ${renamedGlobal}`)
  console.log(`Config:   plugin ${enable ? "added to" : "removed from"} opencode.json`)
  console.log()
  console.log(YELLOW + "Restart opencode for changes to take effect." + RESET)
  console.log()
}

// ── status ────────────────────────────────────────────────

function showStatus() {
  let config = { plugin: [] }
  try { config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8")) } catch {}

  const pluginActive = (config.plugin || []).some(p => p === "triage" || p === "opencode-triage")
  let disabledCount = 0
  let activeCount = 0
  const skillLines = []

  for (const { base, label } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory() || d.name === "triage") continue
      const hasDisabled = fs.existsSync(path.join(base, d.name, "SKILL.md.disabled"))
      const hasActive = fs.existsSync(path.join(base, d.name, "SKILL.md"))
      if (hasDisabled) { disabledCount++; skillLines.push(`  [hidden]  ${d.name}  ${label}`) }
      else if (hasActive) { activeCount++; skillLines.push(`  [active]  ${d.name}  ${label}`) }
    }
  }

  const total = disabledCount + activeCount
  const savedTokens = disabledCount * 50
  const exposedTokens = activeCount * 50

  console.log()
  console.log(BOLD + "Triage Status" + RESET)
  console.log()
  console.log(`Plugin:   ${pluginActive ? GREEN + "ACTIVE" + RESET : "inactive"}  (in opencode.json)`)
  console.log(`Hidden:   ${disabledCount} skill(s)   (~${savedTokens} tokens saved from prompt)`)
  console.log(`Exposed:  ${activeCount} skill(s)    (~${exposedTokens} tokens in prompt)`)
  console.log(`Total:    ${total} skill(s)`)

  if (pluginActive && activeCount > 0) {
    console.log()
    console.log(YELLOW + "Tip: /triage on to hide exposed skills and save tokens." + RESET)
  }
  if (!pluginActive && disabledCount > 0) {
    console.log()
    console.log(YELLOW + "Tip: /triage off to restore native skill discovery." + RESET)
  }

  if (total > 0) {
    console.log()
    skillLines.forEach(l => console.log(l))
  } else {
    console.log()
    console.log("(no skills found)")
    console.log()
    console.log("Create a skill to get started:")
    console.log("  .opencode/skills/<name>/SKILL.md")
  }
  console.log()
}

// ── compare ───────────────────────────────────────────────

function showCompare() {
  let hiddenCount = 0
  let exposedCount = 0

  for (const { base } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory() || d.name === "triage") continue
      if (fs.existsSync(path.join(base, d.name, "SKILL.md.disabled"))) hiddenCount++
      else if (fs.existsSync(path.join(base, d.name, "SKILL.md"))) exposedCount++
    }
  }

  const total = hiddenCount + exposedCount
  if (total === 0) {
    console.log()
    console.log("No skills found. Nothing to compare.")
    console.log()
    console.log("Create skills in .opencode/skills/ or .agent/skills/")
    console.log()
    return
  }

  const MSGS = 10
  const LOOKUPS = 5
  const withBaseline = 40
  const withoutBaseline = total * 50
  const withLookupCost = 55
  const withoutLookupCost = 210

  const withIdle = MSGS * withBaseline
  const withoutIdle = MSGS * withoutBaseline
  const withLookups = LOOKUPS * withLookupCost
  const withoutLookups = LOOKUPS * withoutLookupCost

  const withTotal = withIdle + withLookups
  const withoutTotal = withoutIdle + withoutLookups
  const tokenSaved = withoutTotal - withTotal
  const tokenPct = withoutTotal > 0 ? Math.round((tokenSaved / withoutTotal) * 100) : 0

  const withTime = MSGS * 0.01 + LOOKUPS * 0.4
  const withoutTime = MSGS * 0.1 + LOOKUPS * 2.0

  const pad = (s, w) => String(s).padEnd(w)

  console.log()
  console.log(BOLD + "Cost Comparison" + RESET)
  console.log()
  console.log(`Skills: ${hiddenCount} hidden · ${exposedCount} exposed · ${total} total`)
  console.log(`Model:  ${MSGS} messages, ${LOOKUPS} skill lookups per session`)
  console.log()
  console.log(pad("", 24) + pad("WITH triage", 22) + pad("WITHOUT", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log(pad("Baseline per msg", 24) + pad(withBaseline + " tokens", 22) + pad(withoutBaseline + " tokens", 22))
  console.log(pad("Per lookup", 24) + pad(withLookupCost + " tokens", 22) + pad(withoutLookupCost + " tokens", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log(pad(`${MSGS} idle messages`, 24) + pad(withIdle + " tokens", 22) + pad(withoutIdle + " tokens", 22))
  console.log(pad(`${LOOKUPS} skill lookups`, 24) + pad(withLookups + " tokens", 22) + pad(withoutLookups + " tokens", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log(BOLD + pad("Session total", 24) + pad(withTotal + " tokens", 22) + pad(withoutTotal + " tokens", 22) + RESET)
  console.log(pad("Session time", 24) + pad(withTime.toFixed(1) + "s", 22) + pad(withoutTime.toFixed(1) + "s", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log()
  console.log(GREEN + BOLD + `Saved: ${tokenSaved} tokens (${tokenPct}%)` + RESET)
  console.log()
}

// ── help ──────────────────────────────────────────────────

function showHelp() {
  console.log()
  console.log(BOLD + "opencode-triage" + RESET + " — Deterministic Skill Router")
  console.log("═══════════════════════════════════════════════")
  console.log()
  console.log("Routes to specialized skills via keyword matching.")
  console.log("Skills live as SKILL.md.disabled — hidden from prompt, routed on demand.")
  console.log()
  console.log(BOLD + "COMMANDS" + RESET)
  console.log()
  console.log("  /triage on       Enable plugin + hide skills from system prompt")
  console.log("  /triage off      Disable plugin + restore native skill discovery")
  console.log("  /triage status   Show state, hidden/active counts, token estimate")
  console.log("  /triage compare  Token/time cost comparison table")
  console.log("  /triage help     Show this help")
  console.log()
  console.log(BOLD + "HOW IT WORKS" + RESET)
  console.log()
  console.log("  Skills use SKILL.md.disabled — invisible to opencode's native")
  console.log("  discovery. The triage plugin scans the filesystem directly")
  console.log("  and routes queries via keyword scoring.")
  console.log()
  console.log(BOLD + "EXAMPLES" + RESET)
  console.log()
  console.log("  /triage on          # Enable (restart after)")
  console.log("  /triage off         # Disable (restart after)")
  console.log("  /triage status      # See active/hidden skills")
  console.log("  /triage compare     # Calculate savings")
  console.log()
  console.log(BOLD + "UNINSTALL" + RESET)
  console.log()
  console.log("  1. /triage off")
  console.log("  2. Restart opencode")
  console.log("  3. Remove \"triage\" from opencode.json plugin array")
  console.log("  4. Delete .opencode/plugins/triage.*")
  console.log("  5. Delete .opencode/commands/triage.md")
  console.log()
  console.log("  Zero residue. All skills work natively again.")
  console.log()
  console.log(BOLD + "LINKS" + RESET)
  console.log()
  console.log("  https://github.com/cascharly/opencode-triage")
  console.log()
}

// ── Run ───────────────────────────────────────────────────

main()

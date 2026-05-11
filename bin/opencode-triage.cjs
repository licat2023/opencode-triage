#!/usr/bin/env node
/*
 * opencode-triage CLI
 * ==================
 * Manage the opencode-triage skill router plugin.
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
const https = require("https")

const PLUGIN_NAME = "opencode-triage"
const CMD = process.argv[2] || "help"

let CURRENT_VERSION
try { CURRENT_VERSION = require(path.join(__dirname, "..", "package.json")).version }
catch { CURRENT_VERSION = "0.0.0" }

const WORKTREE = findProjectRoot(process.cwd())
const CONFIG_PATH = path.join(WORKTREE, ".opencode", "opencode.json")
const HOMEDIR = os.homedir()

const SKILL_DIRS = [
  { base: path.join(WORKTREE, ".agent", "skills"), label: ".agent/" },
  { base: path.join(WORKTREE, ".agents", "skills"), label: ".agents/" },
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

// ── Helpers ───────────────────────────────────────────────

function findProjectRoot(startDir) {
  let dir = startDir
  while (true) {
    const configPath = path.join(dir, ".opencode", "opencode.json")
    if (fs.existsSync(configPath)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

function safeRenameSync(src, dst) {
  try {
    const srcStat = fs.lstatSync(src)
    if (srcStat.isSymbolicLink()) {
      console.error(`[opencode-triage] Skipping symlink: ${src}`)
      return false
    }
    fs.renameSync(src, dst)
    return true
  } catch (err) {
    if (err.code === "EXDEV") {
      fs.copyFileSync(src, dst)
      fs.unlinkSync(src)
      return true
    } else {
      throw err
    }
  }
}

function sanitizeName(name) {
  return name.replace(/[\x1b\x9b]/g, "")
}

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
    case "version":
    case "--version":
    case "-v":
      return showVersion()
    case "help":
    case "--help":
    case "-h":
      return showHelp()
    default:
      console.error(`Unknown command: ${CMD}`)
      console.error()
      console.error(`Usage: /triage on | off | status | compare | version | help`)
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
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
      const src = path.join(base, d.name, `SKILL${fromExt}`)
      const dst = path.join(base, d.name, `SKILL${toExt}`)
      if (fs.existsSync(src)) {
        safeRenameSync(src, dst)
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
  if (enable && !config.plugin.includes(PLUGIN_NAME)) {
    config.plugin.push(PLUGIN_NAME)
  } else if (!enable) {
    config.plugin = config.plugin.filter(p => p !== PLUGIN_NAME)
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

  const pluginActive = (config.plugin || []).some(p => p === PLUGIN_NAME)
  let disabledCount = 0
  let activeCount = 0
  const skillLines = []

  for (const { base, label } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
      const hasDisabled = fs.existsSync(path.join(base, d.name, "SKILL.md.disabled"))
      const hasActive = fs.existsSync(path.join(base, d.name, "SKILL.md"))
      const safeName = sanitizeName(d.name)
      if (hasDisabled) { disabledCount++; skillLines.push(`  [hidden]  ${safeName}  ${label}`) }
      else if (hasActive) { activeCount++; skillLines.push(`  [active]  ${safeName}  ${label}`) }
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
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
      if (fs.existsSync(path.join(base, d.name, "SKILL.md.disabled"))) hiddenCount++
      else if (fs.existsSync(path.join(base, d.name, "SKILL.md"))) exposedCount++
    }
  }

  const total = hiddenCount + exposedCount
  if (total === 0) {
    console.log()
    console.log("No skills found. Nothing to compare.")
    console.log()
    console.log("Create skills in .opencode/skills/, .agent/skills/, or .agents/skills/")
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

// ── version ───────────────────────────────────────────────

function showVersion() {
  console.log(`opencode-triage v${CURRENT_VERSION}`)
}

// ── semver ────────────────────────────────────────────────

function semverGt(a, b) {
  const pa = a.split(".").map(Number)
  const pb = b.split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return true
    if (na < nb) return false
  }
  return false
}

function checkForUpdate() {
  https.get("https://registry.npmjs.org/opencode-triage/latest", { timeout: 3000 }, (res) => {
    let data = ""
    res.on("data", (chunk) => data += chunk)
    res.on("end", () => {
      try {
        const pkg = JSON.parse(data)
        const latest = pkg.version
        if (latest && semverGt(latest, CURRENT_VERSION)) {
          console.log()
          console.log(YELLOW + BOLD + "Update available:" + RESET + YELLOW + ` ${CURRENT_VERSION} → ${latest}` + RESET)
          console.log(YELLOW + `  npm install -g opencode-triage@latest` + RESET)
          console.log()
        }
      } catch {}
    })
  }).on("error", () => {})
}

// ── help ──────────────────────────────────────────────────

function showHelp() {
  console.log()
  console.log(BOLD + "opencode-triage v" + CURRENT_VERSION + RESET + " -- Deterministic Skill Router")
  console.log()
  console.log("  on       Hide skills from prompt, enable triage (restart after)")
  console.log("  off      Expose skills, disable triage (restart after)")
  console.log("  status   Show active/hidden skills + token estimate")
  console.log("  compare  Token/time cost comparison")
  console.log("  version  Show version and check for updates")
  console.log("  help     Show this help")
  console.log()
  console.log(BOLD + "MORE" + RESET)
  console.log()
  console.log("  " + BOLD + "Uninstall:" + RESET + "  /triage off, restart, remove from opencode.json, delete plugin files")
  console.log("  " + BOLD + "Docs:" + RESET + "      https://github.com/cascharly/opencode-triage")
  console.log()
}

// ── Run ───────────────────────────────────────────────────

main()
checkForUpdate()

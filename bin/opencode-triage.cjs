#!/usr/bin/env node
/*
 * opencode-triage CLI
 * ==================
 * Manage the opencode-triage skill router plugin.
 *
 * Usage: /triage on | off | status | compare | version | help
 *
 * Quickstart:
 *   /triage on    Hide all skills from the AI prompt (global + local)
 *   /triage off   Expose all skills to the AI prompt (global + local)
 *   /triage status  Show current state and skill counts
 *
 * Use /triage off before switching to Cursor or another AI tool.
 * Use /triage on to return to routed mode.
 *
 * Advanced: --local or --global to target a single scope instead of both.
 */

const fs = require("fs")
const path = require("path")
const os = require("os")
const https = require("https")

const PLUGIN_NAME = "opencode-triage"
const CMD = process.argv[2] || "help"
const FLAGS = process.argv.slice(3)

const isJson = FLAGS.includes("--json")
const isQuiet = FLAGS.includes("--quiet")
const isDryRun = FLAGS.includes("--dry-run")
const showAll = FLAGS.includes("--all")

let CURRENT_VERSION
try { CURRENT_VERSION = require(path.join(__dirname, "..", "package.json")).version }
catch { CURRENT_VERSION = "0.0.0" }

const WORKTREE = findProjectRoot(process.cwd())
const HOMEDIR = os.homedir()

const CMD_TEMPLATE = `---
description: Toggle, inspect, and benchmark the triage skill router
---
Run npx -y opencode-triage $ARGUMENTS and show the output verbatim.
If output contains "Restart opencode", tell the user to restart.
`
const LOCAL_CFG_PATH  = path.join(WORKTREE, ".opencode", "opencode.json")
const LOCAL_CMD_DIR   = path.join(WORKTREE, ".opencode", "commands")
const LOCAL_CMD_FILE  = path.join(LOCAL_CMD_DIR, "triage.md")
const GLOBAL_CFG_PATH = path.join(HOMEDIR, ".config", "opencode", "opencode.jsonc")
const GLOBAL_CMD_DIR  = path.join(HOMEDIR, ".config", "opencode", "commands")
const GLOBAL_CMD_FILE = path.join(GLOBAL_CMD_DIR, "triage.md")

const SKILL_DIRS = [
  { base: path.join(WORKTREE, ".agent", "skills"), label: ".agent/", scope: "project" },
  { base: path.join(WORKTREE, ".agents", "skills"), label: ".agents/", scope: "project" },
  { base: path.join(WORKTREE, ".claude", "skills"), label: ".claude/", scope: "project" },
  { base: path.join(WORKTREE, ".opencode", "skills"), label: ".opencode/", scope: "project" },
  { base: path.join(HOMEDIR, ".agents", "skills"), label: "~/.agents/", scope: "global" },
  { base: path.join(HOMEDIR, ".claude", "skills"), label: "~/.claude/", scope: "global" },
  { base: path.join(HOMEDIR, ".config", "opencode", "skills"), label: "~/.config/opencode/", scope: "global" },
]

const YELLOW = "\x1b[33m"
const GREEN = "\x1b[32m"
const RED = "\x1b[31m"
const CYAN = "\x1b[36m"
const RESET = "\x1b[0m"
const BOLD = "\x1b[1m"
const DIM = "\x1b[2m"

// ── Helpers ───────────────────────────────────────────────

function findProjectRoot(startDir) {
  let dir = startDir
  while (true) {
    const candidates = [
      path.join(dir, ".opencode", "opencode.json"),
      path.join(dir, ".opencode", "opencode.jsonc"),
      path.join(dir, "opencode.json"),
      path.join(dir, "opencode.jsonc"),
    ]
    for (const configPath of candidates) {
      if (fs.existsSync(configPath)) return dir
    }
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

function safeRenameSync(src, dst) {
  try {
    if (fs.existsSync(dst)) fs.unlinkSync(dst)
    fs.renameSync(src, dst)
    return true
  } catch (err) {
    if (err.code === "EXDEV") {
      if (fs.existsSync(dst)) fs.unlinkSync(dst)
      fs.copyFileSync(src, dst)
      fs.unlinkSync(src)
      return true
    } else {
      throw err
    }
  }
}

function sanitizeName(name) {
  return name.replace(/[\x00-\x1f\x7f-\x9f]/g, "")
}

function stripJsoncComments(text) {
  let result = ""
  let inString = false
  let escape = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (escape) {
      result += ch
      escape = false
      i++
      continue
    }
    if (ch === "\\" && inString) {
      result += ch
      escape = true
      i++
      continue
    }
    if (ch === '"') {
      inString = !inString
      result += ch
      i++
      continue
    }
    if (!inString && ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++
      continue
    }
    if (!inString && ch === "/" && text[i + 1] === "*") {
      i += 2
      while (i < text.length - 1 && !(text[i] === "*" && text[i + 1] === "/")) i++
      i += 2
      continue
    }
    result += ch
    i++
  }
  return result
}

// Levenshtein distance for command suggestion
function levenshtein(a, b) {
  const m = a.length, n = b.length
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      )
    }
  }
  return dp[m][n]
}

function suggestCommand(input) {
  const commands = ["on", "off", "enable", "disable", "mode", "status", "compare", "version", "help"]
  let best = null, bestDist = Infinity
  for (const cmd of commands) {
    const d = levenshtein(input, cmd)
    if (d < bestDist) { bestDist = d; best = cmd }
  }
  return bestDist <= 3 ? best : null
}

// ── Main Router ───────────────────────────────────────────

function main() {
  const scopeFlag = FLAGS.includes("--both") ? "both"
    : FLAGS.includes("--local") ? "local"
    : FLAGS.includes("--global") ? "global"
    : null
  const toggleScope = scopeFlag || "both"

  switch (CMD) {
    case "on":
    case "enable":
      return toggle(true, toggleScope)
    case "off":
    case "disable":
      return toggle(false, toggleScope)
    case "status":
      return showStatus()
    case "mode":
      const modeArg = FLAGS.find(f => f === "auto" || f === "manual")
      return setMode(modeArg || "auto", toggleScope)
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
      const suggestion = suggestCommand(CMD)
      if (suggestion) {
        console.error(`Unknown command: ${CMD}. Did you mean "${suggestion}"?`)
      } else {
        console.error(`Unknown command: ${CMD}`)
      }
      console.error()
      console.error(`Usage: /triage on | off | status | compare | version | help`)
      console.error(`Try /triage help for detailed usage.`)
      process.exit(1)
  }
}

function isTriageEntry(entry) {
  return entry === PLUGIN_NAME || (Array.isArray(entry) && entry[0] === PLUGIN_NAME)
}

function findTriageIndex(plugin) {
  for (let i = 0; i < plugin.length; i++) {
    if (isTriageEntry(plugin[i])) return i
  }
  return -1
}

function setPluginMode(plugin, mode) {
  const idx = findTriageIndex(plugin)
  if (mode === "auto") {
    const entry = ["opencode-triage", { autoHide: true }]
    if (idx >= 0) plugin[idx] = entry
    else plugin.push(entry)
  } else {
    if (idx >= 0) {
      plugin.splice(idx, 1)
      plugin.push("opencode-triage")
    } else plugin.push("opencode-triage")
  }
}

// ── Collect skills data (shared by status, compare, toggle) ──

function collectSkills() {
  const skills = []
  for (const { base, label, scope } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
      const hasDisabled = fs.existsSync(path.join(base, d.name, "SKILL.md.disabled"))
      const hasActive = fs.existsSync(path.join(base, d.name, "SKILL.md"))
      if (hasDisabled || hasActive) {
        skills.push({
          name: sanitizeName(d.name),
          label,
          scope,
          state: hasDisabled ? "hidden" : "exposed",
          dirPath: path.join(base, d.name),
        })
      }
    }
  }
  return skills
}

function collectConfigState() {
  function readMode(path) {
    try {
      const raw = fs.readFileSync(path, "utf-8")
      const plugin = JSON.parse(stripJsoncComments(raw)).plugin || []
      const idx = findTriageIndex(plugin)
      if (idx < 0) return { active: false, mode: "manual" }
      return {
        active: true,
        mode: Array.isArray(plugin[idx]) && plugin[idx][1]?.autoHide === true ? "auto" : "manual",
      }
    } catch { return { active: false, mode: "manual" } }
  }

  const local = readMode(LOCAL_CFG_PATH)
  const global = readMode(GLOBAL_CFG_PATH)

  return { localActive: local.active, globalActive: global.active, localMode: local.mode, globalMode: global.mode }
}

// ── toggle ────────────────────────────────────────────────

function toggle(enable, scope) {
  const fromExt = enable ? ".md" : ".md.disabled"
  const toExt = enable ? ".md.disabled" : ".md"
  let renamedProject = 0
  let renamedGlobal = 0
  const changes = []

  for (const { base, label, scope: dirScope } of SKILL_DIRS) {
    const isGlobalDir = label.startsWith("~")
    if (scope !== "both") {
      if (scope === "local") { if (isGlobalDir) continue }
      if (scope === "global") { if (!isGlobalDir) continue }
    }
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
        if (!isDryRun) safeRenameSync(src, dst)
        changes.push({ name: sanitizeName(d.name), from: `SKILL${fromExt}`, to: `SKILL${toExt}` })
        if (label.startsWith("~")) renamedGlobal++
        else renamedProject++
      }
    }
  }

  // Cleanup both-file conflicts when enabling
  if (enable) {
    for (const { base, label } of SKILL_DIRS) {
      const isGlobalDir = label.startsWith("~")
      if (scope !== "both") {
        if (scope === "local") { if (isGlobalDir) continue }
        if (scope === "global") { if (!isGlobalDir) continue }
      }
      if (!fs.existsSync(base)) continue
      const dirs = fs.readdirSync(base, { withFileTypes: true })
      for (const d of dirs) {
        if (!d.isDirectory()) continue
        if (d.isSymbolicLink()) continue
        if (d.name === "triage") continue
        if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
        const activePath = path.join(base, d.name, "SKILL.md")
        const disabledPath = path.join(base, d.name, "SKILL.md.disabled")
        if (fs.existsSync(activePath) && fs.existsSync(disabledPath)) {
          if (!isDryRun) fs.unlinkSync(activePath)
          changes.push({ name: sanitizeName(d.name), from: "SKILL.md (duplicate)", to: "removed" })
          if (label.startsWith("~")) renamedGlobal++
          else renamedProject++
        }
      }
    }
  }

  const totalRenamed = renamedProject + renamedGlobal

  if (isDryRun) {
    const scopeLabel = scope === "both" ? " (both scopes)" : ` (${scope} scope)`
    console.log()
    console.log(BOLD + "Triage " + (enable ? "ON" : "OFF") + scopeLabel + RESET + DIM + " — dry run" + RESET)
    console.log()
    if (changes.length > 0) {
      console.log("  Would rename:")
      changes.slice(0, 20).forEach(c => {
        console.log(`    ${c.name.padEnd(35)} ${c.from} → ${c.to}`)
      })
      if (changes.length > 20) console.log(`    ... and ${changes.length - 20} more`)
      console.log()
      console.log(`  ${changes.length} file(s) would be renamed. No changes made.`)
    } else {
      console.log(`  No changes needed — all skills already ${enable ? "hidden" : "exposed"}.`)
    }
    console.log()
    return
  }

  // Persist ON/OFF state: write autoHide: true/false to config so next session respects the choice
  const scopes = scope === "both" ? ["global", "local"] : [scope]
  for (const s of scopes) {
    const cfgPath = s === "global" ? GLOBAL_CFG_PATH : LOCAL_CFG_PATH
    writeTriageState(cfgPath, enable)
  }

  const scopeLabel = scope === "both" ? " (both scopes)" : scope ? ` (${scope} scope)` : ""
  console.log()
  console.log(BOLD + "Triage " + (enable ? "ON" : "OFF") + scopeLabel + RESET)

  if (totalRenamed > 0) {
    console.log()
    changes.slice(0, 15).forEach(c => {
      console.log(`  ${c.name.padEnd(35)} ${c.from} → ${c.to}`)
    })
    if (changes.length > 15) console.log(`  ... and ${changes.length - 15} more`)
    console.log()
    console.log(`Skills ${enable ? "hidden" : "exposed"}: ${totalRenamed} file(s) renamed`)
    if (renamedProject) console.log(`  Project: ${renamedProject}`)
    if (renamedGlobal) console.log(`  Global:  ${renamedGlobal}`)
  } else {
    console.log()
    console.log(`  No changes — all skills already ${enable ? "hidden" : "exposed"}.`)
  }

  // Restart only needed when skill files changed (plugin reloads cache every 5s, but startup watcher needs restart)
  if (totalRenamed > 0) {
    console.log()
    console.log(YELLOW + "Restart opencode for changes to take effect." + RESET)
  }
  console.log()
}

// Write autoHide: true/false into the plugin entry in config.
// Does NOT add or remove the plugin — only sets the autoHide flag.
// Creates the config if enabling and it doesn't exist yet.
function writeTriageState(configPath, enable) {
  let config = {}
  let exists = false
  try {
    const raw = fs.readFileSync(configPath, "utf-8")
    config = JSON.parse(stripJsoncComments(raw))
    exists = true
  } catch {}

  // If config doesn't exist and we're disabling, nothing to persist
  if (!exists && !enable) return
  if (!exists) config = { "$schema": "https://opencode.ai/config.json" }

  config.plugin = config.plugin || []
  const idx = findTriageIndex(config.plugin)

  // If plugin not registered and we're disabling, nothing to persist
  if (idx < 0 && !enable) return

  const entry = [PLUGIN_NAME, { autoHide: enable }]
  if (idx >= 0) config.plugin[idx] = entry
  else config.plugin.push(entry)

  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8")
  if (!isQuiet) console.log(`Config:    autoHide=${enable} → ${configPath}`)
}

function updateLocalConfig(enable) {
  let config = {}
  let hadPlugin = false
  try {
    const raw = fs.readFileSync(LOCAL_CFG_PATH, "utf-8")
    config = JSON.parse(stripJsoncComments(raw))
    hadPlugin = (config.plugin || []).some(isTriageEntry)
  } catch {
    config = { "$schema": "https://opencode.ai/config.json" }
  }
  config.plugin = config.plugin || []
  const idx = findTriageIndex(config.plugin)
  if (enable && !hadPlugin) {
    config.plugin.push(PLUGIN_NAME)
    if (!isQuiet) console.log(`Config:    added to ${LOCAL_CFG_PATH}`)
  } else if (!enable && hadPlugin) {
    config.plugin.splice(idx, 1)
    if (!isQuiet) console.log(`Config:    removed from ${LOCAL_CFG_PATH}`)
  }
  fs.mkdirSync(path.dirname(LOCAL_CFG_PATH), { recursive: true })
  fs.writeFileSync(LOCAL_CFG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")
}

function updateGlobalConfig(enable) {
  if (!fs.existsSync(GLOBAL_CFG_PATH)) {
    if (!enable) return
    const config = { "$schema": "https://opencode.ai/config.json", plugin: [PLUGIN_NAME] }
    fs.mkdirSync(path.dirname(GLOBAL_CFG_PATH), { recursive: true })
    fs.writeFileSync(GLOBAL_CFG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")
    if (!isQuiet) console.log(`Config:    created ${GLOBAL_CFG_PATH} with plugin`)
    return
  }
  const raw = fs.readFileSync(GLOBAL_CFG_PATH, "utf-8")
  let config
  try {
    config = JSON.parse(raw)
  } catch {
    const stripped = stripJsoncComments(raw)
    try {
      config = JSON.parse(stripped)
    } catch {
      console.error(`Could not parse ${GLOBAL_CFG_PATH} — skipping plugin toggle`)
      return
    }
  }
  config.plugin = config.plugin || []
  const hadPlugin = config.plugin.some(isTriageEntry)
  const idx = findTriageIndex(config.plugin)
  if (enable) {
    if (!hadPlugin) {
      config.plugin.push(PLUGIN_NAME)
      fs.writeFileSync(GLOBAL_CFG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")
      if (!isQuiet) console.log(`Config:    added to ${GLOBAL_CFG_PATH}`)
    }
  } else {
    if (hadPlugin) {
      config.plugin.splice(idx, 1)
      fs.writeFileSync(GLOBAL_CFG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8")
      if (!isQuiet) console.log(`Config:    removed from ${GLOBAL_CFG_PATH}`)
    }
  }
}

function updatePluginConfigMode(configPath, mode) {
  let raw
  try {
    raw = fs.readFileSync(configPath, "utf-8")
  } catch { return false }

  const config = JSON.parse(stripJsoncComments(raw))
  config.plugin = config.plugin || []
  const idx = findTriageIndex(config.plugin)

  if (mode === "auto") {
    if (idx >= 0 && Array.isArray(config.plugin[idx]) && config.plugin[idx][1]?.autoHide === true) return false
    setPluginMode(config.plugin, "auto")
  } else {
    if (idx >= 0 && config.plugin[idx] === PLUGIN_NAME) return false
    setPluginMode(config.plugin, "manual")
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8")
  return true
}

function setMode(mode, scope) {
  const scopes = scope === "both" ? ["global", "local"] : [scope]
  let changed = 0

  for (const s of scopes) {
    const cfgPath = s === "global" ? GLOBAL_CFG_PATH : LOCAL_CFG_PATH
    if (updatePluginConfigMode(cfgPath, mode)) {
      if (!isQuiet) console.log(`Config:    updated ${cfgPath}`)
      changed++
    }
  }

  const modeLabel = mode === "auto" ? "AUTO" : "MANUAL"
  const scopeLabel = scope === "both" ? " (both scopes)" : ` (${scope} scope)`
  console.log()
  console.log(BOLD + "Triage mode: " + modeLabel + scopeLabel + RESET)
  console.log()
  if (changed > 0) {
    console.log(YELLOW + "Restart opencode for changes to take effect." + RESET)
  } else {
    console.log("  Already in " + mode + " mode — no changes.")
  }
  console.log()
}

// ── status ────────────────────────────────────────────────

function calcHiddenSkillTokens() {
  let totalTokens = 0
  for (const { base } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
      const dirPath = path.join(base, d.name)
      const file = fs.existsSync(path.join(dirPath, "SKILL.md.disabled"))
        ? path.join(dirPath, "SKILL.md.disabled")
        : fs.existsSync(path.join(dirPath, "SKILL.md"))
          ? path.join(dirPath, "SKILL.md")
          : null
      if (file) {
        try {
          const content = fs.readFileSync(file, "utf-8")
          totalTokens += estimateTokens(content)
        } catch {}
      }
    }
  }
  return totalTokens
}

function showStatus() {
  const { localActive, globalActive, localMode, globalMode } = collectConfigState()
  const skills = collectSkills()

  const projSkills = skills.filter(s => s.scope === "project")
  const gloSkills = skills.filter(s => s.scope === "global")
  const projHidden = projSkills.filter(s => s.state === "hidden").length
  const projExposed = projSkills.filter(s => s.state === "exposed").length
  const gloHidden = gloSkills.filter(s => s.state === "hidden").length
  const gloExposed = gloSkills.filter(s => s.state === "exposed").length
  const totalHidden = projHidden + gloHidden
  const totalExposed = projExposed + gloExposed
  const hiddenTokens = calcHiddenSkillTokens()

  // NET savings: hidden total minus triage overhead (tool def + one skill read)
  const TOOL_DEF_TEXT =
    "Discover and route to the right specialized skill. " +
    "Call this before any non-trivial task. " +
    "Pass a brief description. Returns the best match or a list of candidates." +
    "Brief description of what you need help with, e.g. 'backup my database'"
  const toolDefTokens = estimateTokens(TOOL_DEF_TEXT)
  let largestHiddenTokens = 0
  for (const { base } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
      const dirPath = path.join(base, d.name)
      const file = fs.existsSync(path.join(dirPath, "SKILL.md.disabled"))
        ? path.join(dirPath, "SKILL.md.disabled")
        : fs.existsSync(path.join(dirPath, "SKILL.md"))
          ? path.join(dirPath, "SKILL.md")
          : null
      if (file) {
        try {
          const content = fs.readFileSync(file, "utf-8")
          largestHiddenTokens = Math.max(largestHiddenTokens, estimateTokens(content))
        } catch {}
      }
    }
  }
  const netSavings = hiddenTokens - toolDefTokens - largestHiddenTokens

  // ON/OFF derived from skill file state (hidden/exposed), not plugin config
  const projState = projSkills.length === 0 ? "none"
    : projHidden > 0 && projExposed === 0 ? "on"
    : projHidden === 0 ? "off"
    : "mixed"
  const gloState = gloSkills.length === 0 ? "none"
    : gloHidden > 0 && gloExposed === 0 ? "on"
    : gloHidden === 0 ? "off"
    : "mixed"

  function stateColor(state) { return state === "on" ? GREEN : YELLOW }
  function stateText(state) {
    return state === "on" ? "ON" : state === "off" ? "OFF" : state === "mixed" ? "MIXED" : "—"
  }

  // Mixed-state warning: some skills hidden, some exposed in same scope
  const outOfSync = []
  if (projState === "mixed") outOfSync.push(`${projExposed} project skill(s) exposed · ${projHidden} hidden — run /triage on or /triage off to sync`)
  if (gloState === "mixed") outOfSync.push(`${gloExposed} global skill(s) exposed · ${gloHidden} hidden — run /triage on or /triage off to sync`)

  if (isJson) {
    const json = {
      project: {
        state: projState,
        hidden: projHidden,
        exposed: projExposed,
        total: projHidden + projExposed,
        command: fs.existsSync(LOCAL_CMD_FILE) ? "found" : "not found",
      },
      global: {
        state: gloState,
        hidden: gloHidden,
        exposed: gloExposed,
        total: gloHidden + gloExposed,
        command: fs.existsSync(GLOBAL_CMD_FILE) ? "found" : "not found",
      },
      totals: { hidden: totalHidden, exposed: totalExposed, total: totalHidden + totalExposed },
      tokens_saved: netSavings > 0 ? netSavings : 0,
      out_of_sync: outOfSync.length > 0 ? outOfSync : null,
      skills: skills.map(s => ({ name: s.name, state: s.state, scope: s.scope, dir: s.label })),
    }
    console.log(JSON.stringify(json, null, 2))
    return
  }

  const scopeSummary = []
  if (projSkills.length > 0) scopeSummary.push("local "  + stateColor(projState) + stateText(projState) + RESET)
  if (gloSkills.length  > 0) scopeSummary.push("global " + stateColor(gloState)  + stateText(gloState)  + RESET)
  if (scopeSummary.length === 0) scopeSummary.push(DIM + "no skills found" + RESET)

  console.log()
  console.log(BOLD + "● Triage Status" + RESET + DIM + " — " + scopeSummary.join(" · ") + RESET)
  console.log()

  // Project row
  const projLabel = projSkills.length > 0 ? stateColor(projState) + stateText(projState) + RESET : DIM + "—" + RESET
  console.log(`  Project:  ${projLabel}  │  ${projHidden} hidden · ${projExposed} exposed · ${projHidden + projExposed} total  │  ${fs.existsSync(LOCAL_CMD_FILE) ? GREEN + "command ✓" + RESET : DIM + "command ✗" + RESET}`)
  const gloLabel  = gloSkills.length  > 0 ? stateColor(gloState)  + stateText(gloState)  + RESET : DIM + "—" + RESET
  console.log(`  Global:   ${gloLabel}  │  ${gloHidden} hidden · ${gloExposed} exposed · ${gloHidden + gloExposed} total  │  ${fs.existsSync(GLOBAL_CMD_FILE) ? GREEN + "command ✓" + RESET : DIM + "command ✗" + RESET}`)
  console.log()

  // Out-of-sync warning
  if (outOfSync.length > 0) {
    console.log(`  ${YELLOW}⚠ ${outOfSync.join("; ")} — run /triage on to hide them${RESET}`)
    console.log()
  }

  // Grouped skill lists
  if (projSkills.length > 0) {
    console.log(`  ${DIM}── Project skills ──────────────────────────────────────${RESET}`)
    projSkills.forEach(s => {
      const badge = s.state === "hidden" ? GREEN + "[hidden]" + RESET : YELLOW + "[exposed]" + RESET
      console.log(`  ${badge}  ${s.name.padEnd(30)} ${s.label}`)
    })
    console.log()
  }

  if (gloSkills.length > 0) {
    const maxShow = showAll ? gloSkills.length : 10
    console.log(`  ${DIM}── Global skills ───────────────────────────────────────${RESET}`)
    gloSkills.slice(0, maxShow).forEach(s => {
      const badge = s.state === "hidden" ? GREEN + "[hidden]" + RESET : YELLOW + "[exposed]" + RESET
      console.log(`  ${badge}  ${s.name.padEnd(30)} ${s.label}`)
    })
    if (!showAll && gloSkills.length > maxShow) {
      console.log(`  ${DIM}  ... and ${gloSkills.length - maxShow} more${RESET}`)
    }
    console.log()
  }

  const savedLabel = netSavings > 0 ? netSavings.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") : "0"
  console.log(`  ${DIM}~${savedLabel} tokens saved from prompt${RESET}`)

  if (skills.length === 0) {
    console.log()
    console.log("(no skills found)")
    console.log()
    console.log("Create a skill to get started:")
    console.log("  .opencode/skills/<name>/SKILL.md")
  }
  console.log()
}

// ── compare ───────────────────────────────────────────────

function estimateTokens(text) {
  return Math.ceil(text.length / 4)
}

function readSkillContent(dirPath) {
  const disabled = path.join(dirPath, "SKILL.md.disabled")
  const active = path.join(dirPath, "SKILL.md")
  const file = fs.existsSync(disabled) ? disabled : fs.existsSync(active) ? active : null
  if (!file) return { content: "", filePath: null }
  try { return { content: fs.readFileSync(file, "utf-8"), filePath: file } } catch { return { content: "", filePath: null } }
}

function showCompare() {
  const hiddenEntries = []
  const exposedEntries = []

  for (const { base } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      if (d.name.includes(path.sep) || d.name === ".." || d.name === ".") continue
      const dirPath = path.join(base, d.name)
      const hasDisabled = fs.existsSync(path.join(dirPath, "SKILL.md.disabled"))
      const hasActive = fs.existsSync(path.join(dirPath, "SKILL.md"))
      const { content, filePath } = readSkillContent(dirPath)
      const entry = { name: d.name, content, filePath, tokens: estimateTokens(content) }
      if (hasDisabled) hiddenEntries.push(entry)
      else if (hasActive) exposedEntries.push(entry)
    }
  }

  const total = hiddenEntries.length + exposedEntries.length
  if (total === 0) {
    console.log()
    console.log("No skills found. Nothing to compare.")
    console.log()
    console.log("Create skills in .opencode/skills/, .agent/skills/, or .agents/skills/")
    console.log()
    return
  }

  const TOOL_DEF_TEXT =
    "Discover and route to the right specialized skill. " +
    "Call this before any non-trivial task. " +
    "Pass a brief description. Returns the best match or a list of candidates." +
    "Brief description of what you need help with, e.g. 'backup my database'"
  const toolDefTokens = estimateTokens(TOOL_DEF_TEXT)

  // Without triage: ALL skills loaded in full (body content, not just frontmatter)
  const allSkillsFullTokens = hiddenEntries.concat(exposedEntries).reduce((sum, s) => {
    return sum + estimateTokens(s.content)
  }, 0)

  // With triage: tool def + full body of ONE matched skill
  const sampleSkill = hiddenEntries[0] || exposedEntries[0]
  const sampleContent = sampleSkill.content
  const singleSkillTokens = estimateTokens(sampleContent)

  const t0 = process.hrtime.bigint()
  fs.readFileSync(sampleSkill.filePath, "utf-8")
  const t1 = process.hrtime.bigint()
  const singleReadMs = Number(t1 - t0) / 1_000_000

  const t2 = process.hrtime.bigint()
  for (const { base } of SKILL_DIRS) {
    if (!fs.existsSync(base)) continue
    const dirs = fs.readdirSync(base, { withFileTypes: true })
    for (const d of dirs) {
      if (!d.isDirectory()) continue
      if (d.isSymbolicLink()) continue
      if (d.name === "triage") continue
      readSkillContent(path.join(base, d.name)).content
    }
  }
  const t3 = process.hrtime.bigint()
  const allReadMs = Number(t3 - t2) / 1_000_000

  const withoutCost = allSkillsFullTokens
  const withCost = toolDefTokens + singleSkillTokens
  const saved = withoutCost - withCost
  const pct = withoutCost > 0 ? Math.round((saved / withoutCost) * 100) : 0

  // Top skills by full content size
  const allSkills = hiddenEntries.concat(exposedEntries).sort((a, b) => b.tokens - a.tokens)
  const topSkills = allSkills.slice(0, 5)

  if (isJson) {
    const json = {
      skills: { hidden: hiddenEntries.length, exposed: exposedEntries.length, total },
      with_triage: { total: withCost, tool_def: toolDefTokens, skill_read: singleSkillTokens },
      without_triage: { total: withoutCost },
      saved: { tokens: saved, percent: pct },
      time: { triage_ms: +singleReadMs.toFixed(1), all_ms: +allReadMs.toFixed(1) },
      top_skills: topSkills.map(s => ({ name: s.name, tokens: s.tokens })),
    }
    console.log(JSON.stringify(json, null, 2))
    return
  }

  const pad = (s, w) => String(s).padEnd(w)

  console.log()
  console.log(BOLD + "Cost Comparison Global + Local" + RESET)
  console.log()
  console.log(`Skills: ${hiddenEntries.length} hidden · ${exposedEntries.length} exposed · ${total} total`)
  console.log()
  console.log(pad("", 24) + pad("WITH triage", 22) + pad("WITHOUT", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log(pad("Prompt per call", 24) + pad(withCost + " tokens", 22) + pad(withoutCost + " tokens", 22))
  console.log(pad("  Tool definition", 24) + pad(toolDefTokens + " tokens", 22) + pad("0 tokens", 22))
  console.log(pad("  Skill read", 24) + pad(singleSkillTokens + " tokens", 22) + pad(withoutCost + " tokens", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log(BOLD + pad("Saved per call", 24) + pad(saved + " tokens (" + pct + "%)", 22) + RESET)
  console.log()
  console.log(`Time: ${singleReadMs.toFixed(1)}ms (triage) vs ${allReadMs.toFixed(1)}ms (all skills)`)
  console.log()

  if (topSkills.length > 0) {
    console.log("Top skills by full content size:")
    topSkills.forEach(s => {
      console.log(`  ${s.name.padEnd(30)} ~${s.tokens} tokens`)
    })
    console.log()
  }

  console.log()
}

// ── version ───────────────────────────────────────────────

function showVersion() {
  if (isJson) {
    console.log(JSON.stringify({ version: CURRENT_VERSION }))
    return
  }
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
  if (isJson) {
    console.log(JSON.stringify({
      version: CURRENT_VERSION,
      commands: ["on", "off", "status", "compare", "version", "help"],
      flags: ["--local", "--global", "--both", "--json", "--quiet", "--dry-run", "--all"],
    }, null, 2))
    return
  }
  console.log()
  console.log(BOLD + "opencode-triage v" + CURRENT_VERSION + RESET + " — Deterministic Skill Router")
  console.log()
  console.log("  " + BOLD + "on" + RESET + "       Hide all skills from the AI prompt   (restart after)")
  console.log("  " + BOLD + "off" + RESET + "      Expose all skills to the AI prompt    (restart after)")
  console.log("  " + BOLD + "status" + RESET + "   Show current state and skill counts")
  console.log("  " + BOLD + "compare" + RESET + "  Token/time cost comparison")
  console.log("  " + BOLD + "version" + RESET + "  Show version and check for updates")
  console.log("  " + BOLD + "help" + RESET + "     Show this help")
  console.log()
  console.log(DIM + "  Use /triage off before switching to Cursor or another AI tool." + RESET)
  console.log(DIM + "  Use /triage on  to return to routed mode." + RESET)
  console.log()
  console.log(BOLD + "Advanced" + RESET + DIM + "  (override default: both scopes)" + RESET)
  console.log()
  console.log("  --local       Target current project only")
  console.log("  --global      Target global skills only")
  console.log("  --dry-run     Preview changes without applying (on/off)")
  console.log("  --json        Output as JSON (all commands)")
  console.log("  --quiet       Suppress non-error output (on/off)")
  console.log("  --all         Show full skill list without truncation (status)")
  console.log()
  console.log("  " + BOLD + "Uninstall:" + RESET + "  npm uninstall -g opencode-triage")
  console.log("  " + BOLD + "Docs:" + RESET + "      https://github.com/cascharly/opencode-triage")
  console.log()
}

// ── Run ───────────────────────────────────────────────────

main()
checkForUpdate()

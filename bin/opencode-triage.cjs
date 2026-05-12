#!/usr/bin/env node
/*
 * opencode-triage CLI
 * ==================
 * Manage the opencode-triage skill router plugin.
 *
 * Usage: /triage on [--local | --global | --both] | off [--local | --global | --both] | status | compare | help
 *
 * Quickstart:
 *   /triage on        Enable plugin + hide skills from system prompt (global)
 *   /triage on --both Enable in both scopes (global + local)
 *   /triage off       Disable plugin + restore native skill discovery (global)
 *   /triage off --both Disable in both scopes
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

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")
}

// ── Main Router ───────────────────────────────────────────

function main() {
  const scopeFlag = process.argv.includes("--both") ? "both"
    : process.argv.includes("--local") ? "local"
    : process.argv.includes("--global") ? "global"
    : null
  const toggleScope = scopeFlag || "global" // no flag = global by default
  switch (CMD) {
    case "on":
    case "enable":
      return toggle(true, toggleScope)
    case "off":
    case "disable":
      return toggle(false, toggleScope)
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

function toggle(enable, scope) {
  const fromExt = enable ? ".md" : ".md.disabled"
  const toExt = enable ? ".md.disabled" : ".md"
  let renamedProject = 0
  let renamedGlobal = 0

  for (const { base, label } of SKILL_DIRS) {
    // strict scoping: local → project dirs only; global → global dirs only; both → all dirs
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
        safeRenameSync(src, dst)
        if (label.startsWith("~")) renamedGlobal++
        else renamedProject++
      }
    }
  }

  const scopes = scope === "both" ? ["global", "local"] : [scope]

  for (const s of scopes) {
    const cmdFile = s === "global" ? GLOBAL_CMD_FILE : LOCAL_CMD_FILE

    if (s === "global") {
      updateGlobalConfig(enable)
    } else {
      updateLocalConfig(enable)
    }

    if (enable) {
      fs.mkdirSync(path.dirname(cmdFile), { recursive: true })
      fs.writeFileSync(cmdFile, CMD_TEMPLATE, "utf-8")
      console.log(`Command:  created ${s === "global" ? "global" : "local"} /triage command`)
    }
  }

  const totalRenamed = renamedProject + renamedGlobal
  const scopeLabel = scope === "both" ? " (both scopes)" : scope ? ` (${scope} scope)` : ""
  console.log()
  console.log(BOLD + (enable ? "Triage ON" : "Triage OFF") + scopeLabel + RESET)
  console.log()
  console.log(`Skills ${enable ? "hidden" : "exposed"}: ${totalRenamed} file(s) renamed`)
  if (renamedProject) console.log(`  Project: ${renamedProject}`)
  if (renamedGlobal) console.log(`  Global:  ${renamedGlobal}`)
  console.log()
  console.log(YELLOW + "Restart opencode for changes to take effect." + RESET)
  console.log()
}

function updateLocalConfig(enable) {
  let config = {}
  try {
    config = JSON.parse(fs.readFileSync(LOCAL_CFG_PATH, "utf-8"))
  } catch {
    config = { "$schema": "https://opencode.ai/config.json" }
  }
  config.plugin = config.plugin || []
  if (enable && !config.plugin.includes(PLUGIN_NAME)) {
    config.plugin.push(PLUGIN_NAME)
    console.log(`Config:    added to ${LOCAL_CFG_PATH}`)
  } else if (!enable) {
    config.plugin = config.plugin.filter(p => p !== PLUGIN_NAME)
    console.log(`Config:    removed from ${LOCAL_CFG_PATH}`)
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
    console.log(`Config:    created ${GLOBAL_CFG_PATH} with plugin`)
    return
  }
  let text = fs.readFileSync(GLOBAL_CFG_PATH, "utf-8")

  // Try to parse as JSON first (no comments case)
  try {
    const config = JSON.parse(text)
    if (enable) {
      config.plugin = config.plugin || []
      if (!config.plugin.includes(PLUGIN_NAME)) {
        config.plugin.push(PLUGIN_NAME)
        text = JSON.stringify(config, null, 2) + "\n"
        fs.writeFileSync(GLOBAL_CFG_PATH, text, "utf-8")
        console.log(`Config:    added to ${GLOBAL_CFG_PATH}`)
      }
    } else {
      if (config.plugin && config.plugin.includes(PLUGIN_NAME)) {
        config.plugin = config.plugin.filter(p => p !== PLUGIN_NAME)
        text = JSON.stringify(config, null, 2) + "\n"
        fs.writeFileSync(GLOBAL_CFG_PATH, text, "utf-8")
        console.log(`Config:    removed from ${GLOBAL_CFG_PATH}`)
      }
    }
    return
  } catch { /* JSONC with comments — fall through to regex approach */ }

  if (enable) {
    const hasPlugin = text.includes(`"${PLUGIN_NAME}"`)
    if (!hasPlugin) {
      text = text.replace(/"plugin":\s*\[/m, `"plugin": [\n    "${PLUGIN_NAME}",`)
      fs.writeFileSync(GLOBAL_CFG_PATH, text, "utf-8")
      console.log(`Config:    added to ${GLOBAL_CFG_PATH}`)
    }
  } else {
    // Target only the plugin name within the "plugin" array context
    const pluginArrayMatch = text.match(/"plugin"\s*:\s*\[([^\]]*)\]/s)
    if (pluginArrayMatch) {
      const arrayContent = pluginArrayMatch[1]
      const escaped = escapeRegex(PLUGIN_NAME)
      const newContent = arrayContent.replace(new RegExp(`\\s*"${escaped}"\\s*,?\\s*`, "g"), "")
      if (newContent !== arrayContent) {
        const fullMatch = pluginArrayMatch[0]
        const newMatch = fullMatch.replace(arrayContent, newContent.replace(/,\s*\]/, "]"))
        text = text.replace(fullMatch, newMatch)
        fs.writeFileSync(GLOBAL_CFG_PATH, text, "utf-8")
        console.log(`Config:    removed from ${GLOBAL_CFG_PATH}`)
      }
    }
  }
}

// ── status ────────────────────────────────────────────────

function showStatus() {
  // Check configs
  let localCfg = { plugin: [] }
  try { localCfg = JSON.parse(fs.readFileSync(LOCAL_CFG_PATH, "utf-8")) } catch {}
  const localActive = (localCfg.plugin || []).includes(PLUGIN_NAME)

  let globalText = ""
  try { globalText = fs.readFileSync(GLOBAL_CFG_PATH, "utf-8") } catch {}
  const globalActive = globalText.includes(`"${PLUGIN_NAME}"`)

  // Count skills per scope
  let projDisabled = 0, projActive = 0, gloDisabled = 0, gloActive = 0
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
      if (hasDisabled) {
        if (label.startsWith("~")) { gloDisabled++ } else { projDisabled++ }
        skillLines.push(`  [hidden]  ${safeName}  ${label}`)
      } else if (hasActive) {
        if (label.startsWith("~")) { gloActive++ } else { projActive++ }
        skillLines.push(`  [active]  ${safeName}  ${label}`)
      }
    }
  }

  const totalDisabled = projDisabled + gloDisabled
  const totalActive = projActive + gloActive

  console.log()
  console.log(BOLD + "Triage Status" + RESET)
  console.log()

  const localCmd = fs.existsSync(LOCAL_CMD_FILE)
  console.log(`  Project:`)
  console.log(`    plugin:   ${localActive ? GREEN + "ACTIVE" + RESET : "inactive"}  (opencode.json)`)
  console.log(`    skills:   ${projDisabled} hidden · ${projActive} exposed · ${projDisabled + projActive} total`)
  console.log(`    command:  ${localCmd ? GREEN + "found" + RESET : "not found"}  (.opencode/commands/triage.md)`)
  console.log()

  const globalCmd = fs.existsSync(GLOBAL_CMD_FILE)
  console.log(`  Global:`)
  console.log(`    plugin:   ${globalActive ? GREEN + "ACTIVE" + RESET : "inactive"}  (~/.config/opencode/opencode.jsonc)`)
  console.log(`    skills:   ${gloDisabled} hidden · ${gloActive} exposed · ${gloDisabled + gloActive} total`)
  console.log(`    command:  ${globalCmd ? GREEN + "found" + RESET : "not found"}  (~/.config/opencode/commands/triage.md)`)
  console.log()

  console.log(`Totals:   ${totalDisabled} hidden  · ${totalActive} exposed  · ${totalDisabled + totalActive} skills`)
  console.log(`          ~${totalDisabled * 50} tokens saved from prompt`)

  if (skillLines.length > 0) {
    console.log()
    skillLines.forEach(l => console.log(l))
  }
  if (totalDisabled + totalActive === 0) {
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
  // Rough estimate: ~4 chars per token for English text
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
  const hiddenSkills = []
  const exposedSkills = []

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
      if (hasDisabled) hiddenSkills.push(entry)
      else if (hasActive) exposedSkills.push(entry)
    }
  }

  const total = hiddenSkills.length + exposedSkills.length
  if (total === 0) {
    console.log()
    console.log("No skills found. Nothing to compare.")
    console.log()
    console.log("Create skills in .opencode/skills/, .agent/skills/, or .agents/skills/")
    console.log()
    return
  }

  // Measure actual tool definition text from source
  const TOOL_DEF_TEXT =
    "Discover and route to the right specialized skill. " +
    "Call this before any non-trivial task. " +
    "Pass a brief description. Returns the best match or a list of candidates." +
    "Brief description of what you need help with, e.g. 'backup my database'"
  const toolDefTokens = estimateTokens(TOOL_DEF_TEXT)

  // Measure frontmatter tokens for all skills (what goes into prompt without triage)
  const allSkillsFmTokens = hiddenSkills.concat(exposedSkills).reduce((sum, s) => {
    const fmPreview = s.content.slice(0, 500)
    return sum + estimateTokens(fmPreview)
  }, 0)

  // Measure single skill read cost (what triage pays per lookup)
  const sampleSkill = hiddenSkills[0] || exposedSkills[0]
  const sampleContent = sampleSkill.content
  const fmEnd = sampleContent.indexOf("\n---", 4)
  const fmContent = fmEnd !== -1 ? sampleContent.slice(4, fmEnd) : sampleContent.slice(0, 500)
  const singleSkillTokens = estimateTokens(fmContent)

  // Benchmark: time to read one skill file from disk (triage path)
  const samplePath = sampleSkill.filePath
  const t0 = process.hrtime.bigint()
  fs.readFileSync(samplePath, "utf-8")
  const t1 = process.hrtime.bigint()
  const singleReadMs = Number(t1 - t0) / 1_000_000

  // Benchmark: time to read all skill files (without triage path)
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

  // Per-call comparison
  const withoutCost = allSkillsFmTokens  // all skills in prompt
  const withCost = toolDefTokens + singleSkillTokens  // tool def + one skill read
  const saved = withoutCost - withCost
  const pct = withoutCost > 0 ? Math.round((saved / withoutCost) * 100) : 0

  const pad = (s, w) => String(s).padEnd(w)

  console.log()
  console.log(BOLD + "Cost Comparison" + RESET)
  console.log()
  console.log(`Skills: ${hiddenSkills.length} hidden · ${exposedSkills.length} exposed · ${total} total`)
  console.log()
  console.log(pad("", 24) + pad("WITH triage", 22) + pad("WITHOUT", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log(pad("Prompt per call", 24) + pad(withCost + " tokens", 22) + pad(withoutCost + " tokens", 22))
  console.log(pad("  Tool definition", 24) + pad(toolDefTokens + " tokens", 22) + pad("0 tokens", 22))
  console.log(pad("  Skill read", 24) + pad(singleSkillTokens + " tokens", 22) + pad(allSkillsFmTokens + " tokens", 22))
  console.log(pad("──────────────────", 24) + pad("────────────────────", 22) + pad("────────────────────", 22))
  console.log(BOLD + pad("Saved per call", 24) + pad(saved + " tokens (" + pct + "%)", 22) + RESET)
  console.log()
  console.log(`Time: ${singleReadMs.toFixed(1)}ms (triage) vs ${allReadMs.toFixed(1)}ms (all skills)`)
  console.log()
  console.log("Token counts measured from actual skill files. Timing from filesystem benchmarks.")
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
  console.log("  on              Hide global skills from prompt, enable triage (restart after)")
  console.log("  on --local      Enable only in current project")
  console.log("  on --both       Enable in both scopes (global + local)")
  console.log("  off             Expose global skills, disable triage (restart after)")
  console.log("  off --local     Disable only in current project")
  console.log("  off --both      Disable in both scopes")
  console.log("  status          Show active/hidden skills + token estimate")
  console.log("  compare         Token/time cost comparison")
  console.log("  version         Show version and check for updates")
  console.log("  help            Show this help")
  console.log()
  console.log(BOLD + "MORE" + RESET)
  console.log()
  console.log("  " + BOLD + "Scopes:" + RESET + "     on/off default to global. Use --local or --both.")
  console.log("  " + BOLD + "Examples:" + RESET + "  /triage on --both        Enable triage everywhere")
  console.log("  " + BOLD + "  " + RESET + "            /triage off --both       Disable everywhere")
  console.log("  " + BOLD + "Uninstall:" + RESET + "  npm uninstall -g opencode-triage  (or --save-dev)")
  console.log("  " + BOLD + "Docs:" + RESET + "      https://github.com/cascharly/opencode-triage")
  console.log()
}

// ── Run ───────────────────────────────────────────────────

main()
checkForUpdate()

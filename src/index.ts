/*
 * opencode-triage — Skill Router Plugin
 * ======================================
 * Version: 1.2.7
 * License: MIT
 *
 * Deterministic skill routing for OpenCode. Registers a `triage()` custom tool
 * that discovers SKILL.md(.disabled) files and routes LLM queries to matching
 * skills via keyword scoring — no PowerShell, no LLM parsing overhead.
 *
 * Install:  { "plugin": ["opencode-triage"] }  in opencode.json
 * Toggle:   /triage on   |   /triage off
 * Docs:     https://github.com/cascharly/opencode-triage
 */

import type { Plugin } from "@opencode-ai/plugin"
import { tool } from "@opencode-ai/plugin"
import { homedir } from "node:os"
import { join, basename } from "node:path"
import { readdir, readFile, realpath } from "node:fs/promises"
import notify from "./notify.js"
import {
  THRESHOLD,
  MIN_WORD_LENGTH,
  NAME_WEIGHT,
  DESC_WEIGHT,
  MAX_SKILL_SIZE,
  stripBOM,
  extractFrontmatter,
  scoreSkills,
  getWordBonus,
  escapeRegex,
  isValidSkillName,
} from "./utils.js"
import type { SkillEntry, ScoredSkill } from "./utils.js"

// Exclude the triage skill itself — self-referencing would create infinite loops
const EXCLUDED_SKILLS = new Set(["triage"])

/**
 * Builds the list of directories to scan for skill files.
 *
 * Searches both project-level (`.agent/`, `.agents/`, `.claude/`, `.opencode/`)
 * and global (`~/.agents/`, `~/.claude/`, `~/.config/opencode/`) skills directories.
 * Project skills take precedence over global skills of the same name.
 *
 * @param worktree - Git worktree root or current working directory
 */
function buildSkillLocations(worktree: string) {
  return [
    { base: join(worktree, ".agent", "skills"), scope: "project" as const },
    { base: join(worktree, ".agents", "skills"), scope: "project" as const },
    { base: join(worktree, ".claude", "skills"), scope: "project" as const },
    { base: join(worktree, ".opencode", "skills"), scope: "project" as const },
    { base: join(homedir(), ".agents", "skills"), scope: "global" as const },
    { base: join(homedir(), ".claude", "skills"), scope: "global" as const },
    { base: join(homedir(), ".config", "opencode", "skills"), scope: "global" as const },
  ]
}

/**
 * Triage skill router plugin — main entry point.
 *
 * Registers the `triage` and `notify` custom tools, plus a
 * `tool.execute.after` hook that renders TUI toasts for routing
 * results and explicit notification calls.
 */
export const server: Plugin = async ({ worktree, client }) => {
  // Cache: discovered skills per worktree
  let cache: SkillEntry[] | null = null

  async function getCachedSkills(): Promise<SkillEntry[]> {
    if (cache === null) {
      const locations = buildSkillLocations(worktree)
      cache = await discoverAllSkills(locations)
    }
    return cache
  }

  return {
    tool: {
      triage: tool({
        description:
          "Discover and route to the right specialized skill. " +
          "Call this before any non-trivial task. " +
          "Pass a brief description. Returns the best match or a list of candidates.",
        args: {
          query: tool.schema.string().optional().describe(
            "Brief description of what you need help with, e.g. 'backup my database'"
          ),
        },
        async execute(args, context) {
          const skills = await getCachedSkills()

          if (skills.length === 0) {
            return [
              "No skills installed.",
              "",
              "To add a skill:",
              "",
              "  Project:",
              "    .opencode/skills/<name>/SKILL.md",
              "    .claude/skills/<name>/SKILL.md",
              "    .agent/skills/<name>/SKILL.md",
              "    .agents/skills/<name>/SKILL.md",
              "",
              "  Global:",
              "    ~/.config/opencode/skills/<name>/SKILL.md",
              "    ~/.claude/skills/<name>/SKILL.md",
              "    ~/.agents/skills/<name>/SKILL.md",
              "",
              "Use /triage status to verify your setup.",
            ].join("\n")
          }

          const query = (args.query ?? "").trim()
          if (!query) {
            return "Describe what you need -- triage will find the best matching skill."
          }

          if (context.abort.aborted) {
            return "Triage cancelled."
          }

          const scored = scoreSkills(query, skills)
            .filter(s => s.score > 0)
            .sort((a, b) => b.score - a.score)

          if (scored.length === 0) {
            return `No skill matches "${query}". Try different keywords.`
          }

          // Confidence gap: top match vs runner-up. Large gap = clear winner
          const gap = scored[0].score - (scored[1]?.score ?? 0)

          if (gap >= THRESHOLD || scored.length === 1) {
            const match = scored[0]
            const content = await readSkillContent(match.path)
            return [
              `SKILL ROUTED: ${match.name}`,
              `Matched by: ${match.matchedBy}`,
              ``,
              content,
            ].join("\n")
          }

          const top = scored.slice(0, 5)
          const lines = [
            `Multiple matches for "${query}". Pick one and call triage with the skill name:`,
            ``,
          ]
          top.forEach((s, i) => {
            lines.push(`${i + 1}. ${s.name} -- ${s.desc}`)
          })
          lines.push(``)
          lines.push(`Example: triage({ query: "${top[0].name}" })`)
          return lines.join("\n")
        },
      }),
      notify,
    },
    // ── Notification routing ────────────────────────────
    // Catches triage results and notify() calls to show TUI toasts.
    // First-line pattern matching avoids parsing the full result.
    // Body isolation prevents false positives on content issue detection.
    "tool.execute.after": async (input, output) => {
      const result = output.output
      if (typeof result !== "string") return
      if (input.tool === "triage") {
        const first = result.split("\n")[0] ?? ""
        if (first.startsWith("SKILL ROUTED:")) {
          const skillName = first.replace("SKILL ROUTED:", "").trim()
          await client.tui.showToast({
            body: { message: `Loaded: ${skillName}`, variant: "success" },
          })
          const bodyIndex = result.indexOf("\n\n")
          if (bodyIndex !== -1) {
            const body = result.slice(bodyIndex + 2).trimStart()
            if (body.startsWith("(skill content truncated")) {
              await client.tui.showToast({
                body: { message: `Skill "${skillName}" exceeds 1MB limit — truncated`, variant: "warning" },
              })
            } else if (body.startsWith("(skill content unavailable")) {
              await client.tui.showToast({
                body: { message: `Could not read skill file for "${skillName}"`, variant: "error" },
              })
            }
          }
        } else if (first.startsWith("Multiple matches")) {
          await client.tui.showToast({
            body: { message: "Multiple skills matched — narrow your query", variant: "info" },
          })
        } else if (first.startsWith("No skill matches")) {
          await client.tui.showToast({
            body: { message: "No matching skill found — try different keywords", variant: "error" },
          })
        } else if (first.startsWith("No skills installed")) {
          await client.tui.showToast({
            body: { message: "No skills installed — add SKILL.md files to get started", variant: "info" },
          })
        }
      }
      if (input.tool === "notify") {
        const args = input.args as { message?: string; variant?: string }
        if (args.message) {
          await client.tui.showToast({
            body: {
              message: args.message,
              variant: (args.variant as "info" | "success" | "error" | "warning") ?? "info",
            },
          })
        }
      }
    },
  }
}

// ── Discovery ─────────────────────────────────────────────

/**
 * Discovers all skills from the provided filesystem locations.
 *
 * Resolves symlinks, enumerates subdirectories, reads frontmatter from
 * SKILL.md.disabled (priority) and SKILL.md files, deduplicates by name,
 * and sorts project skills before global ones.
 *
 * Non-ENOENT errors are logged to stderr but do not halt discovery.
 *
 * @param locations - Array of {base, scope} directory pairs to scan
 * @returns Deduplicated, sorted array of discovered skills
 */
async function discoverAllSkills(
  locations: { base: string; scope: "project" | "global" }[]
): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = []
  const seen = new Set<string>()

  for (const { base, scope } of locations) {
    try {
      const resolvedBase = await realpath(base)
      const entries = await readdir(resolvedBase, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.isSymbolicLink()) continue
        if (EXCLUDED_SKILLS.has(entry.name)) continue
        if (!isValidSkillName(entry.name)) continue

        const result = await tryReadSkill(join(resolvedBase, entry.name))
        if (result && !seen.has(result.name)) {
          seen.add(result.name)
          skills.push({ ...result, scope })
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        console.error(`[opencode-triage] Error scanning ${base}:`, err)
      }
    }
  }

  skills.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" })
  })

  return skills
}

/**
 * Attempts to read a skill definition from a directory.
 *
 * Checks SKILL.md.disabled first (triage-managed, hidden from system prompt),
 * then SKILL.md (exposed to system prompt). Disabled files take priority so
 * the triage router can still find and load skills even when they are hidden
 * from the agent's context.
 *
 * @param skillDir - Absolute path to a skill subdirectory
 * @returns Parsed skill entry (without scope), or null if neither file exists
 */
async function tryReadSkill(
  skillDir: string
): Promise<Omit<SkillEntry, "scope"> | null> {
  const filenames = ["SKILL.md.disabled", "SKILL.md"]
  for (const fn of filenames) {
    const filePath = join(skillDir, fn)
    try {
      const content = await readFile(filePath, "utf-8")
      const name = extractFrontmatter(content, "name") ?? basename(skillDir)
      const desc = extractFrontmatter(content, "description") ?? ""
      return { name, desc, path: filePath }
    } catch { /* try next filename */ }
  }
  return null
}

/**
 * Reads a skill file, strips YAML frontmatter, returns body content.
 *
 * Enforces a 1MB size limit to prevent memory exhaustion. Strips UTF-8
 * BOM for Windows compatibility. Returns error strings on failure rather
 * than throwing, so the triage tool always returns a usable string.
 *
 * @param filePath - Absolute path to SKILL.md or SKILL.md.disabled
 * @returns Body content without frontmatter, or an error string
 */
async function readSkillContent(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8")
    if (content.length > MAX_SKILL_SIZE) {
      return `(skill content truncated: exceeds 1MB limit)`
    }
    const clean = stripBOM(content)
    const bodyMatch = clean.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n*([\s\S]*)/)
    return bodyMatch ? bodyMatch[1].trim() : clean.trim()
  } catch {
    return "(skill content unavailable)"
  }
}

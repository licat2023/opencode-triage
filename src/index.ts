/*
 * opencode-triage — Skill Router Plugin
 * ======================================
 * Version: 1.0.0
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
import { readdir, readFile, access } from "node:fs/promises"

// ── Configuration ──────────────────────────────────────────

const THRESHOLD = 30
const MIN_WORD_LENGTH = 3
const NAME_WEIGHT = 3
const DESC_WEIGHT = 1

interface SkillEntry {
  name: string
  desc: string
  path: string
  scope: "project" | "global"
}

interface ScoredSkill extends SkillEntry {
  score: number
  matchedBy: string
}

const EXCLUDED_SKILLS = new Set(["triage"])

function buildSkillLocations(worktree: string) {
  return [
    { base: join(worktree, ".agent", "skills"), scope: "project" as const },
    { base: join(worktree, ".claude", "skills"), scope: "project" as const },
    { base: join(worktree, ".opencode", "skills"), scope: "project" as const },
    { base: join(homedir(), ".agents", "skills"), scope: "global" as const },
    { base: join(homedir(), ".claude", "skills"), scope: "global" as const },
    { base: join(homedir(), ".config", "opencode", "skills"), scope: "global" as const },
  ]
}

// ── Plugin ────────────────────────────────────────────────

export const TriagePlugin: Plugin = async ({ directory }) => ({
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
      async execute(args) {
        const worktree = directory
        const skillLocations = buildSkillLocations(worktree)
        const skills = await discoverAllSkills(skillLocations)

        if (skills.length === 0) {
          return [
            "No skills installed.",
            "",
            "To add a skill:",
            "  .opencode/skills/<name>/SKILL.md",
            "  .agent/skills/<name>/SKILL.md",
            "",
            "Use /triage status to verify your setup.",
          ].join("\n")
        }

        const query = (args.query ?? "").trim()
        if (!query) {
          return formatAll(skills)
        }

        const scored = scoreSkills(query, skills)
          .filter(s => s.score > 0)
          .sort((a, b) => b.score - a.score)

        if (scored.length === 0) {
          return `No skill matches "${query}".\n\n${formatAll(skills)}`
        }

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
          lines.push(`${i + 1}. ${s.name} — ${s.desc}`)
        })
        lines.push(``)
        lines.push(`Example: triage({ query: "${top[0].name}" })`)
        return lines.join("\n")
      },
    }),
  },
})

// ── Discovery ─────────────────────────────────────────────

async function discoverAllSkills(
  locations: { base: string; scope: "project" | "global" }[]
): Promise<SkillEntry[]> {
  const skills: SkillEntry[] = []
  const seen = new Set<string>()

  for (const { base, scope } of locations) {
    try {
      await access(base)
      const entries = await readdir(base, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (EXCLUDED_SKILLS.has(entry.name)) continue

        const result = await tryReadSkill(join(base, entry.name))
        if (result && !seen.has(result.name)) {
          seen.add(result.name)
          skills.push({ ...result, scope })
        }
      }
    } catch { /* directory missing — skip */ }
  }

  skills.sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "project" ? -1 : 1
    return a.name.localeCompare(b.name)
  })

  return skills
}

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

function extractFrontmatter(content: string, key: string): string | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/)
  if (!match) return null
  const fm = match[1]

  const multiRe = new RegExp(`^${key}:\\s*>(.+?)(?=\\n\\S|$)`, "sm")
  const multiMatch = fm.match(multiRe)
  if (multiMatch) {
    return multiMatch[1].replace(/\n\s*/g, " ").trim()
  }

  const singleRe = new RegExp(`^${key}:\\s*(.+)$`, "m")
  const singleMatch = fm.match(singleRe)
  return singleMatch ? singleMatch[1].trim() : null
}

// ── Scoring ───────────────────────────────────────────────

function scoreSkills(query: string, skills: SkillEntry[]): ScoredSkill[] {
  const words = query.toLowerCase()
    .split(/\s+/)
    .filter(w => w.length >= MIN_WORD_LENGTH)

  if (words.length === 0) return []

  return skills.map(skill => {
    const nameLower = skill.name.toLowerCase()
    const descLower = skill.desc.toLowerCase()
    let score = 0
    const matched: string[] = []

    for (const word of words) {
      const bonus = getWordBonus(word, nameLower)
      if (bonus > 0) { score += NAME_WEIGHT * bonus; matched.push(`name:${word}`) }
    }
    for (const word of words) {
      const bonus = getWordBonus(word, descLower)
      if (bonus > 0) { score += DESC_WEIGHT * bonus; matched.push(`desc:${word}`) }
    }

    return { ...skill, score, matchedBy: matched.join(", ") }
  })
}

function getWordBonus(word: string, target: string): number {
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "i")
  if (re.test(target)) return 15
  if (target.includes(word)) return 10
  return 0
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// ── Formatting ────────────────────────────────────────────

function formatAll(skills: SkillEntry[]): string {
  const lines = ["Available skills:", ""]
  for (const s of skills) {
    const scope = s.scope === "global" ? "[global]" : "[project]"
    lines.push(`${scope} ${s.name} — ${s.desc}`)
  }
  lines.push("")
  lines.push(`Call triage({ query: "brief description" }) to search.`)
  return lines.join("\n")
}

async function readSkillContent(filePath: string): Promise<string> {
  try {
    const content = await readFile(filePath, "utf-8")
    const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n*([\s\S]*)/)
    return bodyMatch ? bodyMatch[1].trim() : content.trim()
  } catch {
    return "(skill content unavailable)"
  }
}

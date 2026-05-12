/**
 * Pure utility functions for the opencode-triage plugin.
 *
 * This module has zero external dependencies — it only uses built-in
 * JavaScript/TypeScript features. This makes it fully testable in isolation
 * with Node's built-in test runner (`node --test`).
 *
 * Key responsibilities:
 *   - Parse YAML frontmatter from SKILL.md files
 *   - Score skills against user queries using keyword matching
 *   - Validate skill directory names (security)
 */

// ── Configuration constants ────────────────────────────────

/**
 * Minimum score gap required between the top two matches for auto-routing.
 * If the gap is below this threshold, the LLM gets a list of candidates
 * to choose from instead of a single skill.
 *
 * Scoring: exact word match = 15pts, substring match = 10pts.
 * Name matches are weighted 3x, description matches 1x.
 * So a single exact name match (15 * 3 = 45) exceeds this threshold alone.
 */
export const THRESHOLD = 30

/**
 * Minimum word length to consider during query tokenization.
 * Filters out common short words like "a", "an", "to", "do" that
 * would create false positive matches across many skills.
 */
export const MIN_WORD_LENGTH = 3

/**
 * Multiplier applied to score bonuses from skill name matches.
 * Names are more specific than descriptions, so they get higher weight.
 * A name match contributes 3x more to the final score than a description match.
 */
export const NAME_WEIGHT = 3

/**
 * Multiplier applied to score bonuses from skill description matches.
 * Descriptions are broader and less specific, so they get baseline weight.
 */
export const DESC_WEIGHT = 1

/**
 * Maximum allowed size for a skill file in bytes (1MB).
 * Prevents memory exhaustion attacks where a maliciously large SKILL.md
 * would be loaded into the LLM context window.
 */
export const MAX_SKILL_SIZE = 1024 * 1024 // 1MB

// ── Type definitions ───────────────────────────────────────

/**
 * Represents a discovered skill from the filesystem.
 * Populated during the discovery phase before any scoring occurs.
 */
export interface SkillEntry {
  /** Skill name from frontmatter, or directory name as fallback */
  name: string
  /** Skill description from frontmatter, or empty string if missing */
  desc: string
  /** Absolute path to the SKILL.md or SKILL.md.disabled file */
  path: string
  /** Whether this skill was found in a project-level or global directory */
  scope: "project" | "global"
}

/**
 * A skill entry enriched with its relevance score for a specific query.
 * Returned by scoreSkills() and used to rank candidates.
 */
export interface ScoredSkill extends SkillEntry {
  /** Computed relevance score based on keyword matching */
  score: number
  /** Human-readable list of which words matched and where (e.g. "name:backup, desc:database") */
  matchedBy: string
}

// ── String utilities ───────────────────────────────────────

/**
 * Removes the UTF-8 Byte Order Mark (BOM) from the beginning of a string.
 *
 * Windows editors (Notepad, some VS Code configurations) prepend the BOM
 * character (U+FEFF) to UTF-8 files. If not stripped, the BOM breaks
 * frontmatter regex matching since `---` won't be at position 0.
 *
 * @param content - Raw file content that may start with a BOM
 * @returns Content with BOM removed, or unchanged if no BOM present
 */
export function stripBOM(content: string): string {
  if (content.charCodeAt(0) === 0xFEFF) return content.slice(1)
  return content
}

/**
 * Extracts a value from YAML frontmatter by key.
 *
 * Supports two frontmatter formats:
 *   1. Single-line: `description: Some text here`
 *   2. Folded block: `description: >` followed by indented lines
 *
 * Uses indexOf() instead of regex for the frontmatter boundary to avoid
 * catastrophic backtracking (ReDoS) on files with many `---` sequences.
 *
 * @param content - Full file content including frontmatter delimiters
 * @param key - The frontmatter key to extract (e.g. "name", "description")
 * @returns The extracted value, or null if the key is not found
 */
export function extractFrontmatter(content: string, key: string): string | null {
  const clean = stripBOM(content)
  // Find the closing `---` delimiter. Start search at position 4
  // (after the opening `---\n`) to avoid matching the opening delimiter.
  const fmEnd = clean.indexOf("\n---", 4)
  if (fmEnd === -1) return null
  const fm = clean.slice(4, fmEnd)

  // Try folded block syntax first: `key: >` followed by indented lines
  // The regex captures everything after `>` until a non-indented line or end
  const safeKey = escapeRegex(key)
  const multiRe = new RegExp(`^${safeKey}:\\s*>(.+?)(?=\\r?\\n\\S|$)`, "sm")
  const multiMatch = fm.match(multiRe)
  if (multiMatch) {
    // Collapse multi-line folded text into a single space-separated line
    return multiMatch[1].replace(/\n\s*/g, " ").trim()
  }

  // Fall back to single-line syntax: `key: value`
  const singleRe = new RegExp(`^${safeKey}:\\s*(.+)$`, "m")
  const singleMatch = fm.match(singleRe)
  return singleMatch ? singleMatch[1].trim() : null
}

// ── Regex utilities ────────────────────────────────────────

/**
 * Escapes all special regex metacharacters in a string.
 *
 * This is critical for security: user query words are used to build
 * dynamic regex patterns for word-boundary matching. Without escaping,
 * a query like `te.st` would match `test`, `teast`, `te1st`, etc.
 *
 * @param s - Raw string that may contain regex metacharacters
 * @returns Safely escaped string for use inside a RegExp constructor
 */
export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&")
}

// ── Scoring engine ─────────────────────────────────────────

/**
 * Calculates a relevance bonus for a single query word against a target string.
 *
 * Scoring tiers:
 *   - 15 points: Exact word-boundary match (e.g. "db" matches "backup db restore")
 *   - 10 points: Substring match (e.g. "back" matches "backup")
 *   - 0 points: No match at all
 *
 * Word-boundary matches score higher because they indicate a more precise
 * semantic match. Substring matches catch related terms but are less specific.
 *
 * @param word - A single tokenized query word (already lowercased, punctuation stripped)
 * @param target - The skill name or description to match against (already lowercased)
 * @returns Score bonus: 15, 10, or 0
 */
export function getWordBonus(word: string, target: string): number {
  const re = new RegExp(`\\b${escapeRegex(word)}\\b`, "i")
  if (re.test(target)) return 15
  if (target.includes(word)) return 10
  return 0
}

/**
 * Scores all skills against a user query using keyword matching.
 *
 * The scoring pipeline:
 *   1. Tokenize query: split on whitespace, strip punctuation, filter short words
 *   2. For each skill, check each query word against the name (3x weight)
 *   3. Then check each query word against the description (1x weight)
 *   4. Return all skills with their computed scores and match details
 *
 * Note: This returns ALL skills, including those with score 0.
 * The caller should filter with `.filter(s => s.score > 0)` to get only matches.
 *
 * @param query - The user's natural language query (e.g. "backup my database")
 * @param skills - Array of discovered skills to score against
 * @returns All skills with computed scores (filter for score > 0 to get matches)
 */
export function scoreSkills(query: string, skills: SkillEntry[]): ScoredSkill[] {
  // Tokenize: lowercase → split on whitespace → strip non-alphanumeric chars → filter short words
  // Unicode letter/number classes (\p{L}\p{N}) support international queries
  const words = query.toLowerCase()
    .split(/\s+/)
    .map(w => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(w => w.length >= MIN_WORD_LENGTH)

  if (words.length === 0) return []

  return skills.map(skill => {
    const nameLower = skill.name.toLowerCase()
    const descLower = skill.desc.toLowerCase()
    let score = 0
    const matched: string[] = []

    // Score name matches first (higher weight)
    for (const word of words) {
      const bonus = getWordBonus(word, nameLower)
      if (bonus > 0) { score += NAME_WEIGHT * bonus; matched.push(`name:${word}`) }
    }
    // Then score description matches (lower weight)
    for (const word of words) {
      const bonus = getWordBonus(word, descLower)
      if (bonus > 0) { score += DESC_WEIGHT * bonus; matched.push(`desc:${word}`) }
    }

    return { ...skill, score, matchedBy: matched.join(", ") }
  })
}

// ── Security ───────────────────────────────────────────────

/**
 * Validates that a directory name is safe to use as a skill identifier.
 *
 * Rejects names that could be used for path traversal attacks:
 *   - `..` and `.` — relative path navigation
 *   - `/` and `\` — path separators that could escape the skills directory
 *
 * This is a defense-in-depth check. The discovery code also resolves
 * symlinks and checks for symbolic links, but this provides an additional
 * layer of protection at the name validation level.
 *
 * @param name - Directory name from filesystem enumeration
 * @returns true if the name is safe to use, false if it should be skipped
 */
export function isValidSkillName(name: string): boolean {
  return name !== ".." && name !== "." && !name.includes("/") && !name.includes("\\")
}

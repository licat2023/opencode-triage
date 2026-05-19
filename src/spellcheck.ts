/**
 * Spell correction module.
 *
 * Detects unmatched query words and suggests corrections using Levenshtein
 * distance against skill vocabulary (names + descriptions).
 *
 * How it works:
 *   1. Build vocabulary set from all skill names and descriptions
 *   2. Tokenize query and check each word against vocab
 *   3. If a word has no exact match in vocab (length >= 4), find closest
 *      vocab word by Levenshtein distance (max 2 edits)
 *   4. Return correction hints like '"scurity" → "security"'
 *
 * Hints are injected into triage tool results for the LLM to self-correct
 * silently — transparent to the user.
 */

import { MIN_WORD_LENGTH } from "./config.ts"
import type { SkillEntry } from "./config.ts"

/**
 * Computes the Levenshtein (edit) distance between two strings.
 *
 * Uses dynamic programming with O(m*n) time and space complexity.
 * Returns the minimum number of single-character edits (insert, delete,
 * substitute) needed to transform string a into string b.
 *
 * @param a - First string
 * @param b - Second string
 * @returns Number of single-character edits needed
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
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

/**
 * Finds unmatched query words and suggests corrections from skill vocabulary.
 *
 * Builds a vocabulary set from all skill names and descriptions, then checks
 * each query token. If a token has no exact match in the vocabulary, finds
 * the closest word by Levenshtein distance (max 2 edits).
 *
 * Words shorter than 4 characters are skipped to avoid false positives
 * on short common words like "app", "ten", "use".
 *
 * @param query - The user's raw query
 * @param skills - Array of discovered skills to build vocabulary from
 * @returns Array of correction strings like "scurity → security", or empty
 */
export function suggestCorrections(query: string, skills: SkillEntry[]): string[] {
  const words = query.toLowerCase().split(/\s+/).map(w => w.replace(/[^\p{L}\p{N}]/gu, "")).filter(w => w.length >= MIN_WORD_LENGTH)
  if (words.length === 0 || skills.length === 0) return []

  // Build vocabulary from skill names and descriptions
  const vocab = new Set<string>()
  for (const s of skills) {
    s.name.toLowerCase().split(/[-_\s]+/).forEach(w => { const clean = w.replace(/[^\p{L}\p{N}]/gu, ""); if (clean.length >= MIN_WORD_LENGTH) vocab.add(clean) })
    s.desc.toLowerCase().split(/\s+/).forEach(w => { const clean = w.replace(/[^\p{L}\p{N}]/gu, ""); if (clean.length >= MIN_WORD_LENGTH) vocab.add(clean) })
  }

  // Check each query word against vocabulary
  const hints: string[] = []
  for (const word of words) {
    const hasExactMatch = [...vocab].some(v => v === word)
    if (!hasExactMatch && word.length >= 4) {
      let best = ""
      let bestDist = Infinity
      for (const v of vocab) {
        const d = levenshtein(word, v)
        if (d < bestDist) { bestDist = d; best = v }
      }
      if (bestDist <= 2 && bestDist > 0 && best) hints.push(`"${word}" → "${best}"`)
    }
  }
  return hints
}

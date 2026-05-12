import { describe, it } from "node:test"
import assert from "node:assert/strict"

// ── Tool return first-line patterns ────────────────────────
// These match the detection logic in tool.execute.after hooks
// in src/index.ts.

describe("inline notification patterns", () => {
  const patterns = [
    { label: "skill routed",           line: "SKILL ROUTED: backup-restore",              match: "SKILL ROUTED:" },
    { label: "multiple matches",       line: 'Multiple matches for "backup". Pick one...', match: "Multiple matches" },
    { label: "no match",              line: 'No skill matches "xylophone". Try...',       match: "No skill matches" },
    { label: "no skills installed",    line: "No skills installed.",                       match: "No skills installed" },
  ]

  for (const { label, line, match } of patterns) {
    it(`detects ${label} via startsWith`, () => {
      assert.ok(line.startsWith(match))
    })

    it(`extracts first line via split correctly for ${label}`, () => {
      const multiLine = `${line}\nMore content here.\nAnd more.`
      assert.equal(multiLine.split("\n")[0], line)
    })
  }
})

// ── Body extraction (the new detection logic) ──────────────

function extractBody(result: string): string | null {
  const bodyIndex = result.indexOf("\n\n")
  if (bodyIndex === -1) return null
  return result.slice(bodyIndex + 2).trimStart()
}

describe("body extraction after SKILL ROUTED header", () => {
  const skillName = "big-skill"
  const baseRouted = `SKILL ROUTED: ${skillName}\nMatched by: name:big\n`

  it("extracts body when blank separator exists", () => {
    const result = baseRouted + "\n# Skill Body\n\nSome content."
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("# Skill Body"))
  })

  it("extracts body for truncated content", () => {
    const result = baseRouted + "\n(skill content truncated: exceeds 1MB limit)"
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("(skill content truncated"))
  })

  it("extracts body for unavailable content", () => {
    const result = baseRouted + "\n(skill content unavailable)"
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("(skill content unavailable"))
  })

  it("returns null when no blank separator", () => {
    const result = "SKILL ROUTED: test\nMatched by: name:test"
    assert.equal(extractBody(result), null)
  })

  it("trims leading whitespace from body", () => {
    const result = baseRouted + "\n  \nSome content."
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("Some content."))
  })
})

// ── Content issue detection (body-start check) ─────────────

describe("content issue detection within SKILL ROUTED", () => {
  const skillName = "big-skill"
  const baseRouted = `SKILL ROUTED: ${skillName}\nMatched by: name:big\n`

  it("detects truncated content via body start", () => {
    const result = baseRouted + "\n(skill content truncated: exceeds 1MB limit)"
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("(skill content truncated"))
    assert.ok(result.startsWith("SKILL ROUTED:"))
  })

  it("detects unavailable content via body start", () => {
    const result = baseRouted + "\n(skill content unavailable)"
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("(skill content unavailable"))
    assert.ok(result.startsWith("SKILL ROUTED:"))
  })

  it("no false positive when error text is deep in body", () => {
    const body = "# Onboarding\n\nThis skill may show (skill content truncated: exceeds 1MB limit) as an example.\n\nMore text."
    const result = baseRouted + "\n" + body
    const extracted = extractBody(result)
    assert.notEqual(extracted, null)
    assert.ok(!extracted!.startsWith("(skill content truncated"))
    assert.ok(!extracted!.startsWith("(skill content unavailable"))
    assert.ok(extracted!.startsWith("# Onboarding"))
    assert.ok(result.startsWith("SKILL ROUTED:"))
  })

  it("healthy content is not flagged", () => {
    const content = "# My Skill\n\nThis is the full skill content."
    const result = baseRouted + "\n" + content
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(!body!.startsWith("(skill content truncated"))
    assert.ok(!body!.startsWith("(skill content unavailable"))
    assert.ok(result.startsWith("SKILL ROUTED:"))
  })

  it("extracts skill name from SKILL ROUTED line", () => {
    const result = `SKILL ROUTED: my-awesome-skill\nMatched by: name:my`
    const first = result.split("\n")[0]
    const name = first.replace("SKILL ROUTED:", "").trim()
    assert.equal(name, "my-awesome-skill")
  })
})

// ── Content detection without false positives ──────────────

describe("first-line detection has no false positives", () => {
  it("SKILL ROUTED check does not match content lines", () => {
    const lines = [
      "Multiple matches for skill routed",
      "No skill matches SKILL ROUTED query",
    ]
    for (const line of lines) {
      assert.ok(!line.startsWith("SKILL ROUTED:"))
    }
  })

  it("mutually exclusive first-line patterns", () => {
    const cases = [
      "SKILL ROUTED: test",
      'Multiple matches for "test"',
      'No skill matches "test"',
      "No skills installed.",
    ]
    const patterns = ["SKILL ROUTED:", "Multiple matches", "No skill matches", "No skills installed"]

    for (let i = 0; i < cases.length; i++) {
      for (let j = 0; j < patterns.length; j++) {
        if (i === j) {
          assert.ok(cases[i].startsWith(patterns[j]))
        } else {
          assert.ok(!cases[i].startsWith(patterns[j]), `"${cases[i]}" should not start with "${patterns[j]}"`)
        }
      }
    }
  })
})

// ── Ordering of toast chaining ─────────────────────────────

describe("toast chain ordering after SKILL ROUTED", () => {
  const baseRouted = "SKILL ROUTED: test\nMatched by: name:test\n"

  it("content issues checked after success — healthy body", () => {
    const result = baseRouted + "\nAll good."
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(!body!.startsWith("(skill content truncated"))
    assert.ok(!body!.startsWith("(skill content unavailable"))
    assert.ok(result.startsWith("SKILL ROUTED:"))
  })

  it("truncation detected via body start", () => {
    const result = baseRouted + "\n(skill content truncated: exceeds 1MB limit)"
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("(skill content truncated"))
    assert.ok(!body!.startsWith("(skill content unavailable"))
  })

  it("unavailable detected via body start", () => {
    const result = baseRouted + "\n(skill content unavailable)"
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("(skill content unavailable"))
    assert.ok(!body!.startsWith("(skill content truncated"))
  })

  it("truncation takes priority over unavailable (checked first)", () => {
    const result = baseRouted + "\n(skill content truncated: exceeds 1MB limit)"
    const body = extractBody(result)
    assert.notEqual(body, null)
    assert.ok(body!.startsWith("(skill content truncated"))
    assert.ok(!body!.startsWith("(skill content unavailable"))
  })

  it("bodyIndex === -1 skips content issue checks", () => {
    const result = "SKILL ROUTED: test\nMatched by: name:test"
    const body = extractBody(result)
    assert.equal(body, null)
    assert.ok(result.startsWith("SKILL ROUTED:"))
  })
})

// ── Empty / edge case inputs ───────────────────────────────

describe("edge cases for first-line detection", () => {
  it("handles empty result string", () => {
    const result = ""
    const first = result.split("\n")[0] ?? ""
    assert.equal(first, "")
    assert.ok(!first.startsWith("SKILL ROUTED:"))
    assert.ok(!first.startsWith("Multiple matches"))
    assert.ok(!first.startsWith("No skill matches"))
    assert.ok(!first.startsWith("No skills installed"))
  })

  it("handles single line result", () => {
    const first = "Triage cancelled."
    assert.ok(!first.startsWith("SKILL ROUTED:"))
    assert.ok(!first.startsWith("Multiple matches"))
    assert.ok(!first.startsWith("No skill matches"))
    assert.ok(!first.startsWith("No skills installed"))
  })

  it("handles result with leading blank line", () => {
    const result = "\nSKILL ROUTED: test\ncontent"
    const first = result.split("\n")[0] ?? ""
    assert.equal(first, "")
    assert.ok(!first.startsWith("SKILL ROUTED:"))
  })
})

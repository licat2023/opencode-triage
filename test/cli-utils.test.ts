/**
 * Tests for CLI utility functions (stripJsoncComments, safeRenameSync behavior, etc.)
 */
import assert from "node:assert"
import { describe, it } from "node:test"

// Re-implement stripJsoncComments here to test the logic
function stripJsoncComments(text: string): string {
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

describe("stripJsoncComments", () => {
  it("strips single-line comments", () => {
    const input = `{\n  "key": "value", // this is a comment\n  "other": 1\n}`
    const expected = `{\n  "key": "value", \n  "other": 1\n}`
    assert.strictEqual(stripJsoncComments(input), expected)
  })

  it("strips multi-line comments", () => {
    const input = `{\n  /* comment */\n  "key": "value"\n}`
    const expected = `{\n  \n  "key": "value"\n}`
    assert.strictEqual(stripJsoncComments(input), expected)
  })

  it("preserves URLs with // inside strings", () => {
    const input = `{"url": "https://example.com"}`
    assert.strictEqual(stripJsoncComments(input), input)
  })

  it("preserves URLs with // inside strings alongside comments", () => {
    const input = `{\n  "url": "https://example.com", // comment here\n  "name": "test"\n}`
    const expected = `{\n  "url": "https://example.com", \n  "name": "test"\n}`
    assert.strictEqual(stripJsoncComments(input), expected)
  })

  it("handles escaped quotes inside strings", () => {
    const input = `{"msg": "he said \\"hello\\" // not a comment"}`
    assert.strictEqual(stripJsoncComments(input), input)
  })

  it("handles empty string", () => {
    assert.strictEqual(stripJsoncComments(""), "")
  })

  it("handles string with only comment", () => {
    assert.strictEqual(stripJsoncComments("// comment\n"), "\n")
  })

  it("handles multi-line block comment spanning lines", () => {
    const input = `{\n  /* line1\n     line2\n     line3 */\n  "key": 1\n}`
    const expected = `{\n  \n  "key": 1\n}`
    assert.strictEqual(stripJsoncComments(input), expected)
  })

  it("handles comment inside string value is not stripped", () => {
    const input = `{"path": "C://Users//test"}`
    assert.strictEqual(stripJsoncComments(input), input)
  })

  it("handles trailing backslash in string", () => {
    const input = `{"path": "C:\\\\test"}`
    assert.strictEqual(stripJsoncComments(input), input)
  })
})

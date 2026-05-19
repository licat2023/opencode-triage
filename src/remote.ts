/**
 * Remote skill search module.
 *
 * Handles external skill discovery from online registries:
 *   - skills.sh — public skill registry with install commands
 *   - obra/superpowers — GitHub repository of curated skills
 *
 * Both searches have 3-second timeouts and fail silently on errors.
 * Used as fallback when no local skills match the query.
 */

/**
 * Searches the skills.sh registry for matching skills.
 *
 * Queries the public API with the user's query string, returns up to 5
 * results with install commands and install counts.
 *
 * @param query - The user's search query
 * @returns Formatted string with suggestions, or empty string on failure
 */
export async function searchRemoteSkills(query: string): Promise<string> {
  const url = `https://skills.sh/api/v1/skills/search?q=${encodeURIComponent(query)}&limit=5`
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return ""
    const contentType = res.headers.get("content-type") ?? ""
    if (!contentType.includes("application/json")) return ""
    const body = await res.json() as Record<string, unknown>
    if (!body || typeof body !== "object" || !Array.isArray(body.data)) return ""
    const data = body.data as Array<Record<string, unknown>>
    if (data.length === 0) return ""
    const lines = data.slice(0, 5).map(s => {
      const name = typeof s.name === "string" ? s.name : ""
      const source = typeof s.source === "string" ? s.source : ""
      const installs = typeof s.installs === "number" ? s.installs : 0
      const installUrl = typeof s.installUrl === "string" ? s.installUrl : null
      const url = typeof s.url === "string" ? s.url : ""
      if (!name) return ""
      const install = installUrl ? `npx skills add ${source}` : url
      return `  - ${name} (\`${install}\`) ${installs.toLocaleString()} installs`
    }).filter(Boolean)
    return lines.length > 0 ? "\n\nSuggestions from skills.sh:\n" + lines.join("\n") : ""
  } catch {
    return ""
  }
}

/**
 * Searches the obra/superpowers GitHub repository for available skills.
 *
 * Lists the top-level directories in the repository, which represent
 * individual skill packages. Returns up to 10 results with GitHub URLs.
 *
 * @returns Formatted string with superpowers suggestions, or empty string on failure
 */
export async function searchSuperpowers(): Promise<string> {
  const url = "https://api.github.com/repos/obra/superpowers/contents"
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 3000)
    const res = await fetch(url, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return ""
    const contentType = res.headers.get("content-type") ?? ""
    if (!contentType.includes("application/json")) return ""
    const body = await res.json() as unknown
    if (!Array.isArray(body)) return ""
    const dirs = (body as Array<Record<string, unknown>>)
      .filter(e => e.type === "dir" && typeof e.name === "string" && typeof e.html_url === "string")
      .slice(0, 10)
    if (dirs.length === 0) return ""
    const lines = dirs.map(d => `  - ${d.name} (${d.html_url})`)
    return "\n\nSuperpowers from obra/superpowers:\n" + lines.join("\n")
  } catch {
    return ""
  }
}

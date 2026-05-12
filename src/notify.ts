import { tool } from "@opencode-ai/plugin"

/**
 * notify — Show an in-OpenCode toast notification.
 *
 * This tool is registered alongside `triage` in the main plugin.
 * The LLM can call `notify()` to display progress, confirmations,
 * errors, or warnings. The actual toast rendering is handled by
 * the `tool.execute.after` hook in index.ts.
 *
 * @example
 *   notify({ message: "Build complete",    variant: "success" })
 *   notify({ message: "Fetching data...",   variant: "info" })
 *   notify({ message: "Operation failed",   variant: "error" })
 *   notify({ message: "Disk almost full",   variant: "warning" })
 */
export default tool({
  description:
    "Show an in-OpenCode toast notification. " +
    "Use this to display progress messages, confirmations, " +
    "errors, or warnings prominently in the TUI.",
  args: {
    message: tool.schema
      .string()
      .describe("The message to display in the toast notification"),
    variant: tool.schema
      .enum(["info", "success", "error", "warning"])
      .optional()
      .default("info")
      .describe(
        "Visual style of the notification:\n" +
        "  info    - blue, neutral information\n" +
        "  success - green, operation completed\n" +
        "  error   - red, something failed\n" +
        "  warning - yellow, caution needed"
      ),
  },
  /**
   * Returns a confirmation string visible to the LLM.
   * The actual toast is shown by the tool.execute.after hook.
   *
   * @returns A human-readable confirmation string
   */
  async execute(args) {
    return `Toast: [${args.variant ?? "info"}] ${args.message}`
  },
})

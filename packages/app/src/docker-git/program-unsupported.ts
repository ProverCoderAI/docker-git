export type UnsupportedOperationalCommandTag =
  | "Attach"
  | "Panes"
  | "ScrapExport"
  | "ScrapImport"
  | "McpPlaywrightUp"
  | "Apply"
  | "AuthClaudeStatus"
  | "AuthClaudeLogout"
  | "AuthGeminiStatus"
  | "AuthGeminiLogout"

export const unsupportedOperationalCommands: Record<
  UnsupportedOperationalCommandTag,
  { readonly command: string; readonly message: string }
> = {
  Attach: { command: "attach", message: "Host-side SSH attach is disabled in API-only mode." },
  Panes: { command: "panes", message: "Host-side pane inspection is disabled in API-only mode." },
  ScrapExport: { command: "scrap export", message: "Scrap export is disabled in API-only host mode." },
  ScrapImport: { command: "scrap import", message: "Scrap import is disabled in API-only host mode." },
  McpPlaywrightUp: {
    command: "mcp-playwright",
    message: "Playwright browser management is disabled in API-only host mode."
  },
  Apply: {
    command: "Apply",
    message: "Command Apply is not available in API-only host mode."
  },
  AuthClaudeStatus: {
    command: "auth claude status",
    message: "Claude status is not routed through the controller in host API mode."
  },
  AuthClaudeLogout: {
    command: "auth claude logout",
    message: "Claude logout is not routed through the controller in host API mode."
  },
  AuthGeminiStatus: {
    command: "auth gemini status",
    message: "Gemini status is not routed through the controller in host API mode."
  },
  AuthGeminiLogout: {
    command: "auth gemini logout",
    message: "Gemini logout is not routed through the controller in host API mode."
  }
}

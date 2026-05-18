export type UnsupportedOperationalCommandTag =
  | "Attach"
  | "Panes"
  | "ScrapExport"
  | "ScrapImport"
  | "McpPlaywrightUp"
  | "Apply"
  | "AuthClaudeLogin"
  | "AuthClaudeStatus"
  | "AuthClaudeLogout"
  | "AuthGeminiLogin"
  | "AuthGeminiStatus"
  | "AuthGeminiLogout"
  | "AuthGrokLogin"
  | "AuthGrokStatus"
  | "AuthGrokLogout"

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
  AuthClaudeLogin: {
    command: "auth claude login",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthClaudeStatus: {
    command: "auth claude status",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthClaudeLogout: {
    command: "auth claude logout",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthGeminiLogin: {
    command: "auth gemini login",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthGeminiStatus: {
    command: "auth gemini status",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthGeminiLogout: {
    command: "auth gemini logout",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthGrokLogin: {
    command: "auth grok login",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthGrokStatus: {
    command: "auth grok status",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  },
  AuthGrokLogout: {
    command: "auth grok logout",
    message: "Only GitHub, GitLab, and Codex auth are routed through the controller in host API mode."
  }
}

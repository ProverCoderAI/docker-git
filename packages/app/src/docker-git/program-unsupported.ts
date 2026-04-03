export type UnsupportedOperationalCommandTag =
  | "Attach"
  | "Panes"
  | "SessionsList"
  | "SessionsKill"
  | "SessionsLogs"
  | "ScrapExport"
  | "ScrapImport"
  | "McpPlaywrightUp"
  | "Apply"
  | "SessionGistBackup"
  | "SessionGistList"
  | "SessionGistView"
  | "SessionGistDownload"
  | "AuthClaudeLogin"
  | "AuthClaudeStatus"
  | "AuthClaudeLogout"
  | "AuthGeminiLogin"
  | "AuthGeminiStatus"
  | "AuthGeminiLogout"

export const unsupportedOperationalCommands: Record<
  UnsupportedOperationalCommandTag,
  { readonly command: string; readonly message: string }
> = {
  Attach: { command: "attach", message: "Host-side SSH attach is disabled in API-only mode." },
  Panes: { command: "panes", message: "Host-side pane inspection is disabled in API-only mode." },
  SessionsList: { command: "sessions", message: "Terminal session inspection is disabled in API-only mode." },
  SessionsKill: { command: "sessions kill", message: "Terminal session control is disabled in API-only mode." },
  SessionsLogs: { command: "sessions logs", message: "Terminal session log access is disabled in API-only mode." },
  ScrapExport: { command: "scrap export", message: "Scrap export is disabled in API-only host mode." },
  ScrapImport: { command: "scrap import", message: "Scrap import is disabled in API-only host mode." },
  McpPlaywrightUp: {
    command: "mcp-playwright",
    message: "Playwright sidecar management is disabled in API-only host mode."
  },
  Apply: {
    command: "Apply",
    message: "Command Apply is not available in API-only host mode."
  },
  SessionGistBackup: {
    command: "session-gists backup",
    message: "Session gist backup is disabled in API-only host mode."
  },
  SessionGistList: {
    command: "session-gists list",
    message: "Session gist list is disabled in API-only host mode."
  },
  SessionGistView: {
    command: "session-gists view",
    message: "Session gist view is disabled in API-only host mode."
  },
  SessionGistDownload: {
    command: "session-gists download",
    message: "Session gist download is disabled in API-only host mode."
  },
  AuthClaudeLogin: {
    command: "auth claude login",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthClaudeStatus: {
    command: "auth claude status",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthClaudeLogout: {
    command: "auth claude logout",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthGeminiLogin: {
    command: "auth gemini login",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthGeminiStatus: {
    command: "auth gemini status",
    message: "Only GitHub auth is routed through the controller in host API mode."
  },
  AuthGeminiLogout: {
    command: "auth gemini logout",
    message: "Only GitHub auth is routed through the controller in host API mode."
  }
}

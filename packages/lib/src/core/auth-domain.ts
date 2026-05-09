export interface AuthGithubLoginCommand {
  readonly _tag: "AuthGithubLogin"
  readonly label: string | null
  readonly token: string | null
  readonly scopes: string | null
  readonly envGlobalPath: string
}

export interface AuthGithubStatusCommand {
  readonly _tag: "AuthGithubStatus"
  readonly envGlobalPath: string
}

export interface AuthGithubLogoutCommand {
  readonly _tag: "AuthGithubLogout"
  readonly label: string | null
  readonly envGlobalPath: string
}

export interface AuthGitlabLoginCommand {
  readonly _tag: "AuthGitlabLogin"
  readonly label: string | null
  readonly token: string | null
  readonly envGlobalPath: string
}

export interface AuthGitlabStatusCommand {
  readonly _tag: "AuthGitlabStatus"
  readonly envGlobalPath: string
}

export interface AuthGitlabLogoutCommand {
  readonly _tag: "AuthGitlabLogout"
  readonly label: string | null
  readonly envGlobalPath: string
}

export interface AuthCodexLoginCommand {
  readonly _tag: "AuthCodexLogin"
  readonly label: string | null
  readonly codexAuthPath: string
}

export interface AuthCodexStatusCommand {
  readonly _tag: "AuthCodexStatus"
  readonly label: string | null
  readonly codexAuthPath: string
}

export interface AuthCodexLogoutCommand {
  readonly _tag: "AuthCodexLogout"
  readonly label: string | null
  readonly codexAuthPath: string
}

export interface AuthCodexImportCommand {
  readonly _tag: "AuthCodexImport"
  readonly label: string | null
  readonly codexAuthPath: string
}

export interface AuthClaudeLoginCommand {
  readonly _tag: "AuthClaudeLogin"
  readonly label: string | null
  readonly claudeAuthPath: string
}

export interface AuthClaudeStatusCommand {
  readonly _tag: "AuthClaudeStatus"
  readonly label: string | null
  readonly claudeAuthPath: string
}

export interface AuthClaudeLogoutCommand {
  readonly _tag: "AuthClaudeLogout"
  readonly label: string | null
  readonly claudeAuthPath: string
}

// CHANGE: add Gemini CLI auth commands
// WHY: enable Gemini CLI authentication management similar to Claude/Codex
// QUOTE(ТЗ): "Добавь поддержку gemini CLI"
// REF: issue-146
// SOURCE: https://geminicli.com/docs/get-started/authentication/
// FORMAT THEOREM: forall cmd ∈ AuthGeminiCommand: cmd.geminiAuthPath is valid path
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: authentication state is isolated by label
// COMPLEXITY: O(1)
export interface AuthGeminiLoginCommand {
  readonly _tag: "AuthGeminiLogin"
  readonly label: string | null
  readonly geminiAuthPath: string
  readonly isWeb: boolean
}

export interface AuthGeminiStatusCommand {
  readonly _tag: "AuthGeminiStatus"
  readonly label: string | null
  readonly geminiAuthPath: string
}

export interface AuthGeminiLogoutCommand {
  readonly _tag: "AuthGeminiLogout"
  readonly label: string | null
  readonly geminiAuthPath: string
}

export type AuthCommand =
  | AuthGithubLoginCommand
  | AuthGithubStatusCommand
  | AuthGithubLogoutCommand
  | AuthGitlabLoginCommand
  | AuthGitlabStatusCommand
  | AuthGitlabLogoutCommand
  | AuthCodexLoginCommand
  | AuthCodexStatusCommand
  | AuthCodexLogoutCommand
  | AuthCodexImportCommand
  | AuthClaudeLoginCommand
  | AuthClaudeStatusCommand
  | AuthClaudeLogoutCommand
  | AuthGeminiLoginCommand
  | AuthGeminiStatusCommand
  | AuthGeminiLogoutCommand

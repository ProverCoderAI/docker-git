export type { MenuAction, ParseError } from "./menu.js"
export { parseMenuSelection } from "./menu.js"
export { deriveRepoPathParts, deriveRepoSlug, resolveRepoInput } from "./repo.js"

export interface TemplateConfig {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly repoUrl: string
  readonly repoRef: string
  readonly targetDir: string
  readonly volumeName: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
  readonly pnpmVersion: string
}

export interface ProjectConfig {
  readonly schemaVersion: 1
  readonly template: TemplateConfig
}

export interface CreateCommand {
  readonly _tag: "Create"
  readonly config: TemplateConfig
  readonly outDir: string
  readonly runUp: boolean
  readonly force: boolean
  readonly waitForClone: boolean
}

export interface MenuCommand {
  readonly _tag: "Menu"
}

export interface AttachCommand {
  readonly _tag: "Attach"
  readonly projectDir: string
}

export interface PanesCommand {
  readonly _tag: "Panes"
  readonly projectDir: string
}

export interface SessionsListCommand {
  readonly _tag: "SessionsList"
  readonly projectDir: string
  readonly includeDefault: boolean
}

export interface SessionsKillCommand {
  readonly _tag: "SessionsKill"
  readonly projectDir: string
  readonly pid: number
}

export interface SessionsLogsCommand {
  readonly _tag: "SessionsLogs"
  readonly projectDir: string
  readonly pid: number
  readonly lines: number
}

export interface HelpCommand {
  readonly _tag: "Help"
  readonly message: string
}

export interface StatusCommand {
  readonly _tag: "Status"
}

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

export type SessionsCommand =
  | SessionsListCommand
  | SessionsKillCommand
  | SessionsLogsCommand

export type AuthCommand =
  | AuthGithubLoginCommand
  | AuthGithubStatusCommand
  | AuthGithubLogoutCommand
  | AuthCodexLoginCommand
  | AuthCodexStatusCommand
  | AuthCodexLogoutCommand

export type Command =
  | CreateCommand
  | MenuCommand
  | AttachCommand
  | PanesCommand
  | SessionsCommand
  | HelpCommand
  | StatusCommand
  | AuthCommand

export const defaultTemplateConfig = {
  containerName: "dev-ssh",
  serviceName: "dev",
  sshUser: "dev",
  sshPort: 2222,
  repoRef: "main",
  targetDir: "/home/dev/app",
  volumeName: "dev_home",
  authorizedKeysPath: "./.docker-git/authorized_keys",
  envGlobalPath: "./.docker-git/.orch/env/global.env",
  envProjectPath: "./.orch/env/project.env",
  codexAuthPath: "./.docker-git/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  pnpmVersion: "10.27.0"
}

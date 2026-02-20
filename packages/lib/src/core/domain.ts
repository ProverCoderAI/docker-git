export type { MenuAction, ParseError } from "./menu.js"
export { parseMenuSelection } from "./menu.js"
export { deriveRepoPathParts, deriveRepoSlug, resolveRepoInput } from "./repo.js"

export type DockerNetworkMode = "shared" | "project"

export const defaultDockerNetworkMode: DockerNetworkMode = "shared"

export const defaultDockerSharedNetworkName = "docker-git-shared"

export interface TemplateConfig {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly repoUrl: string
  readonly repoRef: string
  readonly forkRepoUrl?: string
  readonly gitTokenLabel?: string | undefined
  readonly codexAuthLabel?: string | undefined
  readonly claudeAuthLabel?: string | undefined
  readonly targetDir: string
  readonly volumeName: string
  readonly dockerGitPath: string
  readonly authorizedKeysPath: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexSharedAuthPath: string
  readonly codexHome: string
  readonly dockerNetworkMode: DockerNetworkMode
  readonly dockerSharedNetworkName: string
  readonly enableMcpPlaywright: boolean
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
  readonly forceEnv: boolean
  readonly waitForClone: boolean
  readonly openSsh: boolean
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

// CHANGE: remove scrap cache mode and keep only the reproducible session snapshot.
// WHY: cache archives include large, easily-rebuildable artifacts (e.g. node_modules) that should not be stored in git.
// QUOTE(ТЗ): "не должно быть старого режима где он качает весь шлак типо node_modules"
// REF: user-request-2026-02-15
// SOURCE: n/a
// FORMAT THEOREM: forall m: ScrapMode, m = "session"
// PURITY: CORE
// EFFECT: Effect<never>
// INVARIANT: scrap exports/imports are always recipe-like (git state + small secrets), never full workspace caches
// COMPLEXITY: O(1)
export type ScrapMode = "session"

export interface ScrapExportCommand {
  readonly _tag: "ScrapExport"
  readonly projectDir: string
  readonly archivePath: string
  readonly mode: ScrapMode
}

export interface ScrapImportCommand {
  readonly _tag: "ScrapImport"
  readonly projectDir: string
  readonly archivePath: string
  readonly wipe: boolean
  readonly mode: ScrapMode
}

export interface McpPlaywrightUpCommand {
  readonly _tag: "McpPlaywrightUp"
  readonly projectDir: string
  readonly runUp: boolean
}

export interface ApplyCommand {
  readonly _tag: "Apply"
  readonly projectDir: string
  readonly runUp: boolean
  readonly gitTokenLabel?: string | undefined
  readonly codexTokenLabel?: string | undefined
  readonly claudeTokenLabel?: string | undefined
  readonly enableMcpPlaywright?: boolean | undefined
}

export interface HelpCommand {
  readonly _tag: "Help"
  readonly message: string
}

export interface StatusCommand {
  readonly _tag: "Status"
}

export interface DownAllCommand {
  readonly _tag: "DownAll"
}

export interface StatePathCommand {
  readonly _tag: "StatePath"
}

export interface StateInitCommand {
  readonly _tag: "StateInit"
  readonly repoUrl: string
  readonly repoRef: string
}

export interface StatePullCommand {
  readonly _tag: "StatePull"
}

export interface StatePushCommand {
  readonly _tag: "StatePush"
}

export interface StateStatusCommand {
  readonly _tag: "StateStatus"
}

export interface StateCommitCommand {
  readonly _tag: "StateCommit"
  readonly message: string
}

export interface StateSyncCommand {
  readonly _tag: "StateSync"
  readonly message: string | null
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

export type SessionsCommand =
  | SessionsListCommand
  | SessionsKillCommand
  | SessionsLogsCommand

export type ScrapCommand =
  | ScrapExportCommand
  | ScrapImportCommand

export type AuthCommand =
  | AuthGithubLoginCommand
  | AuthGithubStatusCommand
  | AuthGithubLogoutCommand
  | AuthCodexLoginCommand
  | AuthCodexStatusCommand
  | AuthCodexLogoutCommand
  | AuthClaudeLoginCommand
  | AuthClaudeStatusCommand
  | AuthClaudeLogoutCommand

export type StateCommand =
  | StatePathCommand
  | StateInitCommand
  | StatePullCommand
  | StatePushCommand
  | StateStatusCommand
  | StateCommitCommand
  | StateSyncCommand

export type Command =
  | CreateCommand
  | MenuCommand
  | AttachCommand
  | PanesCommand
  | SessionsCommand
  | ScrapCommand
  | McpPlaywrightUpCommand
  | ApplyCommand
  | HelpCommand
  | StatusCommand
  | DownAllCommand
  | StateCommand
  | AuthCommand

// CHANGE: validate docker network mode values at the CLI/config boundary
// WHY: keep compose network behavior explicit and type-safe
// QUOTE(ТЗ): "Что бы среды были изолированы?"
// REF: user-request-2026-02-20-networks
// SOURCE: n/a
// FORMAT THEOREM: ∀x: isDockerNetworkMode(x) -> x ∈ {"shared","project"}
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: returns true only for known modes
// COMPLEXITY: O(1)
export const isDockerNetworkMode = (value: string): value is DockerNetworkMode =>
  value === "shared" || value === "project"

// CHANGE: derive compose network name from typed template config
// WHY: keep network naming deterministic across template generation and runtime checks
// QUOTE(ТЗ): "Если я хочу уникальную сеть на каждый контейнер?"
// REF: user-request-2026-02-20-networks
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: resolveComposeNetworkName(cfg) = n -> deterministic(n)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: shared mode always resolves to dockerSharedNetworkName; project mode to "<service>-net"
// COMPLEXITY: O(1)
export const resolveComposeNetworkName = (
  config: Pick<TemplateConfig, "serviceName" | "dockerNetworkMode" | "dockerSharedNetworkName">
): string =>
  config.dockerNetworkMode === "shared"
    ? config.dockerSharedNetworkName
    : `${config.serviceName}-net`

export const defaultTemplateConfig = {
  containerName: "dev-ssh",
  serviceName: "dev",
  sshUser: "dev",
  sshPort: 2222,
  repoRef: "main",
  targetDir: "/home/dev/app",
  volumeName: "dev_home",
  dockerGitPath: "./.docker-git",
  authorizedKeysPath: "./.docker-git/authorized_keys",
  envGlobalPath: "./.docker-git/.orch/env/global.env",
  envProjectPath: "./.orch/env/project.env",
  codexAuthPath: "./.docker-git/.orch/auth/codex",
  codexSharedAuthPath: "./.docker-git/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: defaultDockerNetworkMode,
  dockerSharedNetworkName: defaultDockerSharedNetworkName,
  enableMcpPlaywright: false,
  pnpmVersion: "10.27.0"
}

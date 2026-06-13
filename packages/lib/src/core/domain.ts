import type { AuthCommand } from "./auth-domain.js"
import type { SessionsCommand } from "./sessions-domain.js"
import type { StateCommand } from "./state-domain.js"

export type {
  AuthClaudeLoginCommand,
  AuthClaudeLogoutCommand,
  AuthClaudeStatusCommand,
  AuthCodexImportCommand,
  AuthCodexLoginCommand,
  AuthCodexLogoutCommand,
  AuthCodexStatusCommand,
  AuthCommand,
  AuthGeminiLoginCommand,
  AuthGeminiLogoutCommand,
  AuthGeminiStatusCommand,
  AuthGithubLoginCommand,
  AuthGithubLogoutCommand,
  AuthGithubStatusCommand,
  AuthGitlabLoginCommand,
  AuthGitlabLogoutCommand,
  AuthGitlabStatusCommand,
  AuthGitLoginCommand,
  AuthGitLogoutCommand,
  AuthGitStatusCommand,
  AuthGrokLoginCommand,
  AuthGrokLogoutCommand,
  AuthGrokStatusCommand
} from "./auth-domain.js"
export type { MenuAction, ParseError } from "./menu.js"
export { parseMenuSelection } from "./menu.js"
export { deriveRepoPathParts, deriveRepoSlug, resolveRepoInput } from "./repo.js"
export type {
  SessionsCommand,
  SessionsKillCommand,
  SessionsListCommand,
  SessionsLogsCommand
} from "./sessions-domain.js"
export type {
  StateCommand,
  StateCommitCommand,
  StateInitCommand,
  StatePathCommand,
  StatePullCommand,
  StatePushCommand,
  StateStatusCommand,
  StateSyncCommand
} from "./state-domain.js"
export {
  defaultCpuLimit,
  defaultDockerNetworkMode,
  defaultDockerSharedNetworkName,
  defaultPlaywrightCpuLimit,
  defaultPlaywrightRamLimit,
  defaultRamLimit,
  defaultTemplateConfig,
  dockerGitSharedCacheVolumeName,
  dockerGitSharedCodexVolumeName
} from "./template-defaults.js"

export type AgentMode = "claude" | "codex" | "gemini" | "grok"

export type DockerNetworkMode = "shared" | "project"
export type GpuMode = "none" | "all"

const unixUsernamePattern = /^[a-z_][a-z0-9_-]{0,31}$/

export const sshUsernamePatternDescription = "^[a-z_][a-z0-9_-]{0,31}$"

// CHANGE: define the SSH user name invariant in the core domain
// WHY: generated Dockerfiles and entrypoints interpolate sshUser into shell-sensitive user commands
// QUOTE(ТЗ): n/a
// REF: PR-281-coderabbit-sshUser-validation
// SOURCE: n/a
// FORMAT THEOREM: forall u: isUnixUsername(u) -> not contains_shell_metacharacters(u)
// PURITY: CORE
// INVARIANT: accepted user names contain only lowercase Linux account-name characters
// COMPLEXITY: O(n)/O(1) where n = |value|
export const isUnixUsername = (value: string): boolean => unixUsernamePattern.test(value)

export interface TemplateConfig {
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly repoUrl: string
  readonly repoRef: string
  readonly forkRepoUrl?: string
  readonly gitTokenLabel?: string | undefined
  readonly skipGithubAuth: boolean
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
  readonly geminiAuthLabel?: string | undefined
  readonly geminiAuthPath: string
  readonly geminiHome: string
  readonly grokAuthLabel?: string | undefined
  readonly grokAuthPath: string
  readonly grokHome: string
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly playwrightCpuLimit?: string | undefined
  readonly playwrightRamLimit?: string | undefined
  readonly gpu: GpuMode
  readonly dockerNetworkMode: DockerNetworkMode
  readonly dockerSharedNetworkName: string
  readonly enableMcpPlaywright: boolean
  readonly bunVersion: string
  readonly agentMode?: AgentMode | undefined
  readonly agentAuto?: boolean | undefined
  readonly clonedOnHostname?: string | undefined
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

export interface OpenCommand {
  readonly _tag: "Open"
  readonly projectRef?: string | undefined
  readonly projectDir?: string | undefined
}

export interface PanesCommand {
  readonly _tag: "Panes"
  readonly projectDir: string
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
  readonly geminiTokenLabel?: string | undefined
  readonly grokTokenLabel?: string | undefined
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly playwrightCpuLimit?: string | undefined
  readonly playwrightRamLimit?: string | undefined
  readonly gpu?: GpuMode | undefined
  readonly enableMcpPlaywright?: boolean | undefined
}

// CHANGE: add apply-all command to apply docker-git config to every known project; support --active flag
// WHY: allow bulk-updating all containers in one command; --active restricts to currently running containers only
// QUOTE(ТЗ): "Сделать команду которая сама на все контейнеры применит новые настройки"
// QUOTE(ТЗ): "сделать это возможным через атрибут --active применять только к активным контейнерам, а не ко всем"
// REF: issue-164, issue-185
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: when activeOnly=false applies to all discovered projects; when activeOnly=true applies only to running containers; individual failures do not abort the batch
// COMPLEXITY: O(1)
export interface ApplyAllCommand {
  readonly _tag: "ApplyAll"
  readonly activeOnly: boolean
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

export type ScrapCommand =
  | ScrapExportCommand
  | ScrapImportCommand

export type Command =
  | CreateCommand
  | MenuCommand
  | AttachCommand
  | OpenCommand
  | PanesCommand
  | SessionsCommand
  | ScrapCommand
  | McpPlaywrightUpCommand
  | ApplyCommand
  | ApplyAllCommand
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

export const isGpuMode = (value: string): value is GpuMode => value === "none" || value === "all"

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

// CHANGE: derive a stable bootstrap volume name for per-project runtime bootstrap data
// WHY: API/controller mode cannot rely on host bind mounts for auth/env material
// QUOTE(ТЗ): "У нас есть CLI который вызывает docker ? ... Поднимается сервер и ты через него можешь общаться с контейнером"
// REF: user-request-2026-03-15-api-controller
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: resolveProjectBootstrapVolumeName(cfg) = v -> deterministic(v)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: bootstrap volume name is derived solely from project volumeName
// COMPLEXITY: O(1)
export const resolveProjectBootstrapVolumeName = (
  config: Pick<TemplateConfig, "volumeName">
): string => `${config.volumeName}-bootstrap`

// CHANGE: derive a stable docker compose project name from typed template config
// WHY: managed project lifecycle must not depend on the output directory basename, otherwise "docker compose down -v"
// can target an unrelated stack that happens to share the same folder name (for example the controller repo itself).
// QUOTE(ТЗ): "Весь процесс должен быть высроен так что основной бекенд крутится в docker"
// REF: user-request-2026-04-03-compose-project-isolation
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: resolveComposeProjectName(cfg) = p -> deterministic(p) ∧ isolated_compose_project(p)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: compose project identity is derived solely from serviceName, never cwd basename
// COMPLEXITY: O(1)
export const resolveComposeProjectName = (
  config: Pick<TemplateConfig, "serviceName">
): string => config.serviceName

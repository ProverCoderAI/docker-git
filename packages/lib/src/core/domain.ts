import type { GpuMode, TemplateConfig } from "@prover-coder-ai/docker-git-container"

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
// CHANGE: re-export the container-definition domain from its dedicated package (issue #412)
// WHY: TemplateConfig, container naming and template defaults now live in
//      @prover-coder-ai/docker-git-container; lib re-exports them so existing "./domain.js"
//      consumers keep working while the container package stays a dependency-free leaf.
// REF: issue-412
// PURITY: CORE
export {
  defaultCpuLimit,
  defaultDockerNetworkMode,
  defaultDockerSharedNetworkName,
  defaultPlaywrightCpuLimit,
  defaultPlaywrightRamLimit,
  defaultRamLimit,
  defaultTemplateConfig,
  dockerGitSharedCacheVolumeName,
  dockerGitSharedCodexVolumeName,
  isDockerNetworkMode,
  isGpuMode,
  isUnixUsername,
  resolveComposeNetworkName,
  resolveComposeProjectName,
  resolveProjectBootstrapVolumeName,
  sshUsernamePatternDescription
} from "@prover-coder-ai/docker-git-container"
export type {
  AgentMode,
  DockerNetworkMode,
  GpuMode,
  ProjectConfig,
  TemplateConfig
} from "@prover-coder-ai/docker-git-container"

export interface CreateCommand {
  readonly _tag: "Create"
  readonly config: TemplateConfig
  readonly outDir: string
  readonly runUp: boolean
  readonly force: boolean
  readonly forceEnv: boolean
  readonly waitForClone: boolean
  readonly openSsh: boolean
  readonly dockerComposeUpBuildMode?: "build" | "reuse" | undefined
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

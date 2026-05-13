import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import type * as Effect from "effect/Effect"

import type { GpuMode } from "./frontend-lib/core/domain.js"
import type { MenuError } from "./menu-errors.js"
import type { ProjectItem } from "./project-item.js"

// CHANGE: isolate TUI types/constants into a shared module
// WHY: keep menu rendering and input handling small and focused
// QUOTE(ТЗ): "TUI? Красивый, удобный"
// REF: user-request-2026-02-01-tui
// SOURCE: n/a
// FORMAT THEOREM: forall s: state(s) -> wellTyped(s)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: createSteps is ordered and total over CreateStep
// COMPLEXITY: O(1)

export type MenuState = {
  readonly cwd: string
  readonly activeDir: string | null
}

export type MenuEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

export type MenuRunner = {
  readonly runEffect: <E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) => void
  readonly runInteractiveEffect: <E extends MenuError>(effect: Effect.Effect<void, E, MenuEnv>) => void
}

export type MenuViewContext = {
  readonly setView: (view: ViewState) => void
  readonly setMessage: (message: string | null) => void
  readonly setActiveDir: (dir: string | null) => void
}

export type MenuKeyInput = {
  readonly upArrow?: boolean
  readonly downArrow?: boolean
  readonly return?: boolean
  readonly escape?: boolean
  readonly shift?: boolean
  readonly backspace?: boolean
  readonly delete?: boolean
}

export type CreateInputs = {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly cpuLimit: string
  readonly ramLimit: string
  readonly gpu: GpuMode
  readonly runUp: boolean
  readonly enableMcpPlaywright: boolean
  readonly force: boolean
  readonly forceEnv: boolean
}

export type CreateStep =
  | "repoUrl"
  | "repoRef"
  | "outDir"
  | "cpuLimit"
  | "ramLimit"
  | "gpu"
  | "runUp"
  | "mcpPlaywright"
  | "force"

export const createSteps: ReadonlyArray<CreateStep> = [
  "repoUrl",
  "cpuLimit",
  "ramLimit",
  "gpu",
  "runUp",
  "mcpPlaywright",
  "force"
]

export type AuthFlow =
  | "GithubOauth"
  | "GithubRemove"
  | "GitSet"
  | "GitRemove"
  | "ClaudeOauth"
  | "ClaudeLogout"
  | "GeminiOauth"
  | "GeminiApiKey"
  | "GeminiLogout"

export interface AuthSnapshot {
  readonly globalEnvPath: string
  readonly claudeAuthPath: string
  readonly geminiAuthPath: string
  readonly totalEntries: number
  readonly githubTokenEntries: number
  readonly gitTokenEntries: number
  readonly gitUserEntries: number
  readonly claudeAuthEntries: number
  readonly geminiAuthEntries: number
}

export type ProjectAuthFlow =
  | "ProjectGithubConnect"
  | "ProjectGithubDisconnect"
  | "ProjectGitConnect"
  | "ProjectGitDisconnect"
  | "ProjectClaudeConnect"
  | "ProjectClaudeDisconnect"
  | "ProjectGeminiConnect"
  | "ProjectGeminiDisconnect"

export interface ProjectAuthSnapshot {
  readonly projectDir: string
  readonly projectName: string
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly claudeAuthPath: string
  readonly geminiAuthPath: string
  readonly githubTokenEntries: number
  readonly gitTokenEntries: number
  readonly claudeAuthEntries: number
  readonly geminiAuthEntries: number
  readonly activeGithubLabel: string | null
  readonly activeGitLabel: string | null
  readonly activeClaudeLabel: string | null
  readonly activeGeminiLabel: string | null
}

export type ViewState =
  | { readonly _tag: "Menu" }
  | { readonly _tag: "Create"; readonly step: number; readonly buffer: string; readonly values: Partial<CreateInputs> }
  | { readonly _tag: "AuthMenu"; readonly selected: number; readonly snapshot: AuthSnapshot }
  | {
    readonly _tag: "AuthPrompt"
    readonly flow: AuthFlow
    readonly step: number
    readonly buffer: string
    readonly values: Readonly<Record<string, string>>
    readonly snapshot: AuthSnapshot
  }
  | {
    readonly _tag: "ProjectAuthMenu"
    readonly selected: number
    readonly project: ProjectItem
    readonly snapshot: ProjectAuthSnapshot
  }
  | {
    readonly _tag: "ProjectAuthPrompt"
    readonly flow: ProjectAuthFlow
    readonly step: number
    readonly buffer: string
    readonly values: Readonly<Record<string, string>>
    readonly project: ProjectItem
    readonly snapshot: ProjectAuthSnapshot
  }
  | {
    readonly _tag: "SelectProject"
    readonly purpose: "Connect" | "Down" | "Info" | "Delete" | "Auth"
    readonly allItems: ReadonlyArray<ProjectItem>
    readonly items: ReadonlyArray<ProjectItem>
    readonly query: string
    readonly runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
    readonly selected: number
    readonly confirmDelete: boolean
    readonly connectEnableMcpPlaywright: boolean
  }

export type SelectProjectRuntime = {
  readonly running: boolean
  readonly sshSessions: number
  readonly startedAtIso: string | null
  readonly startedAtEpochMs: number | null
}

export type MenuAction =
  | { readonly _tag: "Create" }
  | { readonly _tag: "Select" }
  | { readonly _tag: "Auth" }
  | { readonly _tag: "ProjectAuth" }
  | { readonly _tag: "Info" }
  | { readonly _tag: "Up" }
  | { readonly _tag: "Status" }
  | { readonly _tag: "Logs" }
  | { readonly _tag: "Down" }
  | { readonly _tag: "DownAll" }
  | { readonly _tag: "Delete" }
  | { readonly _tag: "Quit" }

export const menuItems: ReadonlyArray<{ readonly id: MenuAction; readonly label: string }> = [
  { id: { _tag: "Create" }, label: "Create project" },
  { id: { _tag: "Select" }, label: "Select project" },
  { id: { _tag: "Auth" }, label: "Auth profiles (keys)" },
  { id: { _tag: "ProjectAuth" }, label: "Project auth (bind labels)" },
  { id: { _tag: "Info" }, label: "Show connection info" },
  { id: { _tag: "Up" }, label: "docker compose up" },
  { id: { _tag: "Status" }, label: "docker compose ps" },
  { id: { _tag: "Logs" }, label: "docker compose logs --tail=200" },
  { id: { _tag: "Down" }, label: "docker compose down" },
  { id: { _tag: "DownAll" }, label: "docker compose down (ALL projects)" },
  { id: { _tag: "Delete" }, label: "Delete project (folder + container)" },
  { id: { _tag: "Quit" }, label: "Quit" }
]

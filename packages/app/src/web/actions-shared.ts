import { Effect } from "effect"
import type { Dispatch, SetStateAction } from "react"

import type { ActionPromptState } from "./action-prompt.js"
import { createAuthActionPrompt } from "./action-prompt.js"
import type {
  AuthSnapshot,
  ContainerTaskSnapshot,
  GithubAuthStatus,
  ProjectAuthSnapshot,
  ProjectBrowserSession,
  ProjectDatabaseForward,
  ProjectDatabaseProfile,
  ProjectDatabaseSession,
  ProjectDetails,
  ProjectPortForward
} from "./api.js"
import { githubAuthGateMessage, shouldRequireGithubAuth } from "./github-auth-gate.js"
import { browserMenuIndex } from "./menu.js"
import type { BrowserScreen } from "./screen.js"
import { menuScreen } from "./screen.js"
import type { ActiveTerminalSession } from "./terminal.js"

type Setter<A> = Dispatch<SetStateAction<A>>

type BusyAction<A> = {
  readonly context: BrowserActionContext
  readonly effect: Effect.Effect<A, string>
  readonly label: string
  readonly onFailure?: (error: string) => void
  readonly onFinally?: () => void
  readonly onSuccess: (value: A) => void
}

type SelectedProjectBusyAction<A> = {
  readonly context: BrowserActionContext
  readonly effect: (projectId: string) => Effect.Effect<A, string>
  readonly label: string
  readonly onMissing: () => void
  readonly onSuccess: (value: A) => void
}

type AuthSuccessState = {
  readonly githubStatus: GithubAuthStatus
  readonly message: string
  readonly snapshot: AuthSnapshot
}

const outputLineLimit = 4000

export type BrowserActionContext = {
  readonly databaseConnectionInput: string
  readonly databaseLabelInput: string
  readonly addTerminalSession: (session: ActiveTerminalSession) => void
  readonly closeTerminalSession: (sessionId: string) => void
  readonly githubStatus: GithubAuthStatus | null
  readonly portForwardInput: string
  readonly projectTasksIncludeDefault: boolean
  readonly reloadDashboard: () => void
  readonly selectedProjectId: string | null
  readonly selectedProjectKey: string | null
  readonly selectedProjectName: string | null
  readonly setActionPrompt: Setter<ActionPromptState | null>
  readonly setActiveScreen: Setter<BrowserScreen>
  readonly setAuthSnapshot: Setter<AuthSnapshot | null>
  readonly setBusyLabel: Setter<string | null>
  readonly setDatabaseConnectionInput: Setter<string>
  readonly setDatabaseForwards: Setter<ReadonlyArray<ProjectDatabaseForward>>
  readonly setDatabaseLabelInput: Setter<string>
  readonly setDatabaseProfiles: Setter<ReadonlyArray<ProjectDatabaseProfile>>
  readonly setDatabaseSession: Setter<ProjectDatabaseSession | null>
  readonly setGithubStatus: Setter<GithubAuthStatus | null>
  readonly setMessage: Setter<string | null>
  readonly setOutput: Setter<string>
  readonly setPortForwardInput: Setter<string>
  readonly setPortForwards: Setter<ReadonlyArray<ProjectPortForward>>
  readonly setProjectAuthSnapshot: Setter<ProjectAuthSnapshot | null>
  readonly setProjectBrowser: Setter<ProjectBrowserSession | null>
  readonly setProjectTaskLogs: Setter<string>
  readonly setProjectTasks: Setter<ContainerTaskSnapshot | null>
  readonly setProjectTasksIncludeDefault: Setter<boolean>
  readonly setSelectedMenuIndex: Setter<number>
  readonly setSelectedProject: Setter<ProjectDetails | null>
  readonly setSelectedProjectId: Setter<string | null>
}

export const confirmAction = (label: string): boolean => {
  const dialog = globalThis.confirm
  return typeof dialog === "function" && dialog(label)
}

export const defaultLabel = (value: string | null | undefined): string => {
  const trimmed = (value ?? "").trim()
  return trimmed.length === 0 ? "default" : trimmed
}

export const nullableValue = (value: string | undefined): string | null => {
  const trimmed = (value ?? "").trim()
  return trimmed.length === 0 ? null : trimmed
}

export const withBusy = <A>({ context, effect, label, onFailure, onFinally, onSuccess }: BusyAction<A>) => {
  context.setBusyLabel(label)
  void Effect.runPromise(
    effect.pipe(
      Effect.match({
        onFailure: (error) => {
          context.setMessage(error)
          onFailure?.(error)
        },
        onSuccess
      })
    )
  ).finally(() => {
    context.setBusyLabel(null)
    onFinally?.()
  })
}

export const appendOutputChunk = (context: BrowserActionContext, chunk: string) => {
  if (chunk.length === 0) {
    return
  }
  context.setOutput((current) => {
    const next = current.length === 0 ? chunk : `${current}${chunk}`
    const lines = next.split("\n")
    return lines.length <= outputLineLimit ? next : lines.slice(-outputLineLimit).join("\n")
  })
}

export const applyAuthSuccessState = (context: BrowserActionContext, state: AuthSuccessState) => {
  context.setActionPrompt(null)
  context.setAuthSnapshot(state.snapshot)
  context.setGithubStatus(state.githubStatus)
  context.setMessage(state.message)
}

export const requireSelectedProjectId = (
  context: BrowserActionContext
): string | null => {
  if (context.selectedProjectId !== null) {
    return context.selectedProjectId
  }
  context.setMessage("No project selected.")
  return null
}

export const requireSelectedProjectKey = (
  context: BrowserActionContext
): string | null => {
  if (context.selectedProjectKey !== null) {
    return context.selectedProjectKey
  }
  context.setMessage("No project key selected.")
  return null
}

export const withSelectedProjectBusy = <A>(
  { context, effect, label, onMissing, onSuccess }: SelectedProjectBusyAction<A>
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    onMissing()
    return
  }
  withBusy({
    context,
    effect: effect(projectId),
    label,
    onSuccess
  })
}

export const requireGithubAuthConfigured = (context: BrowserActionContext): boolean => {
  if (context.githubStatus === null) {
    context.setSelectedMenuIndex(browserMenuIndex("Auth"))
    context.setActiveScreen({ tag: "Auth" })
    context.setMessage("Проверяю подключение GitHub перед продолжением.")
    return false
  }
  if (!shouldRequireGithubAuth(context.githubStatus)) {
    return true
  }
  context.setSelectedMenuIndex(browserMenuIndex("Auth"))
  context.setActiveScreen({ tag: "Auth" })
  context.setActionPrompt(createAuthActionPrompt("GithubOauth"))
  context.setMessage(githubAuthGateMessage(context.githubStatus))
  return false
}

export const returnToMainMenu = (context: BrowserActionContext) => {
  context.setActionPrompt(null)
  context.setActiveScreen(menuScreen())
  context.setMessage("Returned to main menu.")
}

export const projectActionLabel = (context: BrowserActionContext): string =>
  context.selectedProjectName ?? context.selectedProjectId ?? "selected project"

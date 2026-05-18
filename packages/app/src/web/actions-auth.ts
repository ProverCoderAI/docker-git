import { Effect } from "effect"

import {
  type AuthMenuAction,
  authViewSteps,
  authViewTitle,
  successMessage as authSuccessMessage,
  type TerminalAuthFlow,
  terminalAuthTitle
} from "../docker-git/menu-auth-shared.js"
import {
  type ProjectAuthMenuAction,
  projectAuthSuccessMessage,
  projectAuthViewSteps
} from "../docker-git/menu-project-auth-shared.js"
import {
  type ActionPromptState,
  createAuthActionPrompt,
  createProjectAuthActionPrompt,
  validateActionPrompt
} from "./action-prompt.js"
import { runGithubOauthMutation } from "./actions-github-oauth.js"
import {
  applyAuthSuccessState,
  type BrowserActionContext,
  defaultLabel,
  nullableValue,
  requireSelectedProjectId,
  returnToMainMenu,
  withBusy
} from "./actions-shared.js"
import {
  createAuthTerminalSession,
  loadAuthSnapshot,
  loadGithubStatus,
  loadProjectAuthSnapshot,
  runAuthMenuFlow,
  runProjectAuthFlow
} from "./api.js"
import { projectPickerScreen } from "./screen.js"

type SupportedAuthMutation = Extract<
  AuthMenuAction,
  | "GithubRemove"
  | "GitSet"
  | "GitRemove"
  | "ClaudeLogout"
  | "GeminiApiKey"
  | "GeminiLogout"
  | "GrokApiKey"
  | "GrokLogout"
>

type SupportedProjectMutation = Extract<
  ProjectAuthMenuAction,
  | "ProjectGithubConnect"
  | "ProjectGithubDisconnect"
  | "ProjectGitConnect"
  | "ProjectGitDisconnect"
  | "ProjectClaudeConnect"
  | "ProjectClaudeDisconnect"
  | "ProjectGeminiConnect"
  | "ProjectGeminiDisconnect"
  | "ProjectGrokConnect"
  | "ProjectGrokDisconnect"
>

export const refreshAuthPanel = (context: BrowserActionContext) => {
  withBusy({
    context,
    effect: Effect.all({
      githubStatus: loadGithubStatus(),
      snapshot: loadAuthSnapshot()
    }),
    label: "Loading auth profiles",
    onSuccess: ({ githubStatus, snapshot }) => {
      context.setAuthSnapshot(snapshot)
      context.setGithubStatus(githubStatus)
      context.setMessage("Auth profiles refreshed.")
    }
  })
}

export const refreshProjectAuthPanel = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setProjectAuthSnapshot(null)
    return
  }
  withBusy({
    context,
    effect: loadProjectAuthSnapshot(projectId),
    label: "Loading project auth",
    onSuccess: (snapshot) => {
      context.setProjectAuthSnapshot(snapshot)
      context.setMessage(`Project auth refreshed for ${snapshot.projectName}.`)
    }
  })
}

const runSupportedAuthMutation = (
  action: SupportedAuthMutation | "GithubOauth",
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  if (action === "GithubOauth") {
    runGithubOauthMutation(values, context)
    return
  }

  const label = defaultLabel(values["label"])
  withBusy({
    context,
    effect: runAuthMenuFlow({
      flow: action,
      label: nullableValue(values["label"]),
      token: nullableValue(values["token"]),
      user: nullableValue(values["user"]),
      apiKey: nullableValue(values["apiKey"])
    }).pipe(
      Effect.flatMap((snapshot) =>
        loadGithubStatus().pipe(
          Effect.map((githubStatus) => ({ githubStatus, snapshot }))
        )
      )
    ),
    label: action,
    onSuccess: ({ githubStatus, snapshot }) => {
      applyAuthSuccessState(context, {
        githubStatus,
        message: authSuccessMessage(action, label),
        snapshot
      })
    }
  })
}

const runTerminalOnlyAuthAction = (
  action: TerminalAuthFlow,
  values: Readonly<Record<string, string>>,
  context: BrowserActionContext
) => {
  const provider = terminalAuthTitle(action)
  const label = nullableValue(values["label"])
  const sessionLabel = defaultLabel(values["label"])
  withBusy({
    context,
    effect: createAuthTerminalSession(action, label),
    label: provider,
    onSuccess: (session) => {
      context.setActionPrompt(null)
      context.addTerminalSession({
        closePath: `/auth/terminal-sessions/${encodeURIComponent(session.id)}`,
        exitMessage: `${provider} finished (${sessionLabel}).`,
        header: provider,
        pendingDeleteMessage: `${provider} was closed before attach.`,
        readyMessage: `${provider} started (${sessionLabel}).`,
        session,
        subtitle: session.sshCommand,
        websocketPath: `/auth/terminal-sessions/${encodeURIComponent(session.id)}/ws`
      })
      context.setMessage(`${provider} is opening in the embedded terminal.`)
    }
  })
}

const runProjectAuthMutation = (
  action: SupportedProjectMutation,
  values: Readonly<Record<string, string>>,
  projectId: string,
  context: BrowserActionContext
) => {
  const label = defaultLabel(values["label"])
  withBusy({
    context,
    effect: runProjectAuthFlow(projectId, {
      flow: action,
      label: nullableValue(values["label"])
    }),
    label: action,
    onSuccess: (snapshot) => {
      context.setActionPrompt(null)
      context.setProjectAuthSnapshot(snapshot)
      context.setMessage(projectAuthSuccessMessage(action, label))
    }
  })
}

const openAuthPrompt = (
  action: Exclude<AuthMenuAction, "Back" | "Refresh">,
  context: BrowserActionContext
) => {
  context.setActionPrompt(createAuthActionPrompt(action))
  const steps = authViewSteps(action)
  const suffix = steps.length === 0 ? "" : ` • ${steps[0]?.label ?? "configure"}`
  context.setMessage(`${authViewTitle(action)}${suffix}`)
}

const openProjectAuthPrompt = (
  action: Exclude<ProjectAuthMenuAction, "Back" | "Refresh">,
  context: BrowserActionContext
) => {
  context.setActionPrompt(createProjectAuthActionPrompt(action))
  const steps = projectAuthViewSteps(action)
  context.setMessage(
    steps.length === 0 ? "Project auth action ready." : steps[0]?.label ?? "Project auth action ready."
  )
}

const isMenuNavigationAction = (
  action: AuthMenuAction | ProjectAuthMenuAction
): action is "Back" | "Refresh" => action === "Back" || action === "Refresh"

const handleBrowserMenuAction = (
  action: "Back" | "Refresh",
  context: BrowserActionContext,
  refresh: (context: BrowserActionContext) => void,
  returnToProjectPicker: boolean
): void => {
  if (action === "Refresh") {
    refresh(context)
    return
  }
  if (returnToProjectPicker) {
    context.setActionPrompt(null)
    context.setActiveScreen(projectPickerScreen())
    context.setMessage("Returned to project selection.")
    return
  }
  returnToMainMenu(context)
}

export const runBrowserAuthAction = (
  action: AuthMenuAction,
  context: BrowserActionContext
) => {
  if (isMenuNavigationAction(action)) {
    handleBrowserMenuAction(action, context, refreshAuthPanel, false)
    return
  }
  openAuthPrompt(action, context)
}

export const runBrowserProjectAuthAction = (
  action: ProjectAuthMenuAction,
  context: BrowserActionContext
) => {
  if (isMenuNavigationAction(action)) {
    handleBrowserMenuAction(action, context, refreshProjectAuthPanel, true)
    return
  }
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  const steps = projectAuthViewSteps(action)
  if (steps.length === 0) {
    runProjectAuthMutation(action, {}, projectId, context)
    return
  }
  openProjectAuthPrompt(action, context)
}

export const cancelBrowserActionPrompt = (
  prompt: ActionPromptState,
  context: BrowserActionContext
) => {
  context.setActionPrompt(null)
  context.setMessage(`${prompt.title} cancelled.`)
}

export const submitBrowserActionPrompt = (
  prompt: ActionPromptState,
  context: BrowserActionContext
) => {
  const error = validateActionPrompt(prompt)
  if (error !== null) {
    context.setMessage(error)
    return
  }
  if (prompt.kind === "Auth") {
    if (prompt.action === "GithubOauth") {
      runSupportedAuthMutation(prompt.action, prompt.values, context)
      return
    }
    if (prompt.action === "ClaudeOauth" || prompt.action === "GeminiOauth" || prompt.action === "GrokOauth") {
      runTerminalOnlyAuthAction(prompt.action, prompt.values, context)
      return
    }
    runSupportedAuthMutation(prompt.action, prompt.values, context)
    return
  }
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  runProjectAuthMutation(prompt.action, prompt.values, projectId, context)
}

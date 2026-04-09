import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import {
  type BrowserActionContext,
  loadSelectedProjectInfo,
  refreshAuthPanel,
  refreshProjectAuthPanel
} from "./actions.js"
import type { AuthSnapshot, DashboardData, GithubAuthStatus, ProjectAuthSnapshot, ProjectDetails } from "./api.js"
import { resetCreateView } from "./app-ready-create.js"
import { type BrowserShortcutArgs, dispatchBrowserShortcut } from "./app-ready-shortcut-runtime.js"
import {
  normalizeSelectedProjectId,
  shouldRefreshAuthPanel,
  shouldRefreshProjectAuthPanel,
  shouldRefreshProjectDetails
} from "./app-ready-shortcuts.js"
import type { BrowserMenuTag } from "./menu.js"
import type { ActiveTerminalSession } from "./terminal.js"

type Setter<A> = Dispatch<SetStateAction<A>>

type SelectionSyncArgs = {
  readonly dashboard: DashboardData
  readonly selectedProjectId: string | null
  readonly setProjectAuthSnapshot: Setter<ProjectAuthSnapshot | null>
  readonly setSelectedProject: Setter<ProjectDetails | null>
  readonly setSelectedProjectId: Setter<string | null>
}

type PanelAutoloadArgs = {
  readonly authSnapshot: AuthSnapshot | null
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly dashboardRefreshTick: number
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly selectedProjectId: string | null
}

type ReadyStateSetters = Pick<
  BrowserActionContext,
  | "setAuthSnapshot"
  | "setBusyLabel"
  | "setGithubStatus"
  | "setMessage"
  | "setOutput"
  | "setProjectAuthSnapshot"
  | "setSelectedMenuIndex"
  | "setSelectedProject"
  | "setSelectedProjectId"
>

export type ReadyState = ReadyStateSetters & {
  readonly actionPrompt: ActionPromptState | null
  readonly authSnapshot: AuthSnapshot | null
  readonly busyLabel: string | null
  readonly createView: CreateFlowView
  readonly githubStatus: GithubAuthStatus | null
  readonly message: string | null
  readonly output: string
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly setActionPrompt: Setter<ActionPromptState | null>
  readonly setCreateView: Setter<CreateFlowView>
  readonly setProjectNavigationArmed: Setter<boolean>
  readonly selectedMenuIndex: number
  readonly selectedProjectId: string | null
  readonly setTerminalSession: Setter<ActiveTerminalSession | null>
  readonly terminalSession: ActiveTerminalSession | null
}

export const useReadyState = (): ReadyState => {
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [actionPrompt, setActionPrompt] = useState<ActionPromptState | null>(null)
  const [project, setSelectedProject] = useState<ProjectDetails | null>(null)
  const [output, setOutput] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [authSnapshot, setAuthSnapshot] = useState<AuthSnapshot | null>(null)
  const [githubStatus, setGithubStatus] = useState<GithubAuthStatus | null>(null)
  const [projectNavigationArmed, setProjectNavigationArmed] = useState(false)
  const [projectAuthSnapshot, setProjectAuthSnapshot] = useState<ProjectAuthSnapshot | null>(null)
  const [createView, setCreateView] = useState<CreateFlowView>(resetCreateView())
  const [terminalSession, setTerminalSession] = useState<ActiveTerminalSession | null>(null)

  return {
    actionPrompt,
    authSnapshot,
    busyLabel,
    createView,
    githubStatus,
    message,
    output,
    project,
    projectNavigationArmed,
    projectAuthSnapshot,
    setActionPrompt,
    selectedMenuIndex,
    selectedProjectId,
    setTerminalSession,
    setAuthSnapshot,
    setBusyLabel,
    setCreateView,
    setGithubStatus,
    setMessage,
    setOutput,
    setProjectNavigationArmed,
    setProjectAuthSnapshot,
    setSelectedMenuIndex,
    setSelectedProject,
    setSelectedProjectId,
    terminalSession
  }
}

export const useProjectSelectionSync = ({
  dashboard,
  selectedProjectId,
  setProjectAuthSnapshot,
  setSelectedProject,
  setSelectedProjectId
}: SelectionSyncArgs) => {
  useEffect(() => {
    const nextProjectId = normalizeSelectedProjectId(dashboard, selectedProjectId)
    if (nextProjectId !== selectedProjectId) {
      setSelectedProjectId(nextProjectId)
      setProjectAuthSnapshot(null)
      setSelectedProject(null)
    }
  }, [dashboard.projects, selectedProjectId, setProjectAuthSnapshot, setSelectedProject, setSelectedProjectId])
}

export const useProjectAuthReset = (
  selectedProjectId: string | null,
  setProjectAuthSnapshot: Setter<ProjectAuthSnapshot | null>
) => {
  useEffect(() => {
    setProjectAuthSnapshot(null)
  }, [selectedProjectId, setProjectAuthSnapshot])
}

export const useProjectDetailsReset = (
  selectedProjectId: string | null,
  setSelectedProject: Setter<ProjectDetails | null>
) => {
  useEffect(() => {
    setSelectedProject(null)
  }, [selectedProjectId, setSelectedProject])
}

export const useActionPromptReset = (
  actionPrompt: ActionPromptState | null,
  currentMenu: BrowserMenuTag,
  setActionPrompt: Setter<ActionPromptState | null>
) => {
  useEffect(() => {
    if (
      actionPrompt !== null &&
      (
        (actionPrompt.kind === "Auth" && currentMenu !== "Auth") ||
        (actionPrompt.kind === "ProjectAuth" && currentMenu !== "ProjectAuth")
      )
    ) {
      setActionPrompt(null)
    }
  }, [actionPrompt, currentMenu, setActionPrompt])
}

export const useProjectNavigationReset = (
  currentMenu: BrowserMenuTag,
  setProjectNavigationArmed: Setter<boolean>
) => {
  useEffect(() => {
    setProjectNavigationArmed(false)
  }, [currentMenu, setProjectNavigationArmed])
}

export const usePanelAutoload = ({
  authSnapshot,
  context,
  currentMenu,
  dashboardRefreshTick,
  project,
  projectAuthSnapshot,
  projectNavigationArmed,
  selectedProjectId
}: PanelAutoloadArgs) => {
  const loadCurrentPanel = useEffectEvent(() => {
    if (shouldRefreshAuthPanel(currentMenu, authSnapshot)) {
      refreshAuthPanel(context)
    }
    if (shouldRefreshProjectAuthPanel(currentMenu, projectAuthSnapshot)) {
      refreshProjectAuthPanel(context)
    }
    if (shouldRefreshProjectDetails(currentMenu, projectNavigationArmed, selectedProjectId)) {
      loadSelectedProjectInfo(context, { silent: project !== null && project.id === selectedProjectId })
    }
  })

  useEffect(() => {
    loadCurrentPanel()
  }, [
    authSnapshot,
    currentMenu,
    dashboardRefreshTick,
    project?.id,
    projectAuthSnapshot,
    projectNavigationArmed,
    selectedProjectId,
    loadCurrentPanel
  ])
}

export const useBrowserShortcuts = ({
  ...args
}: BrowserShortcutArgs) => {
  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    dispatchBrowserShortcut(event, args)
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      onKeyDown(event)
    }
    globalThis.addEventListener("keydown", handleKeyDown)
    return () => {
      globalThis.removeEventListener("keydown", handleKeyDown)
    }
  }, [onKeyDown])
}

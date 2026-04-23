import { type Dispatch, type SetStateAction, useEffect, useEffectEvent, useState } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import {
  type BrowserActionContext,
  loadSelectedProjectInfo,
  refreshAuthPanel,
  refreshProjectAuthPanel
} from "./actions.js"
import type {
  AuthSnapshot,
  ContainerTaskSnapshot,
  DashboardData,
  GithubAuthStatus,
  ProjectAuthSnapshot,
  ProjectBrowserSession,
  ProjectDatabaseForward,
  ProjectDatabaseProfile,
  ProjectDatabaseSession,
  ProjectDetails,
  ProjectPortForward
} from "./api.js"
import { maybeLoadProjectBrowser } from "./app-ready-browser-hook.js"
import { resetCreateView } from "./app-ready-create.js"
import { maybeLoadProjectDatabases, useDatabaseState } from "./app-ready-databases-hook.js"
import { maybeLoadProjectPortForwards, usePortForwardState } from "./app-ready-port-forwards-hook.js"
import {
  normalizeSelectedProjectId,
  shouldRefreshAuthPanel,
  shouldRefreshProjectAuthPanel,
  shouldRefreshProjectDetails
} from "./app-ready-shortcuts.js"
import { maybeLoadProjectTasks, useProjectTasksState } from "./app-ready-tasks-hook.js"
import { type TerminalWorkspaceReadyState, useTerminalWorkspaceState } from "./app-ready-terminal-state-hook.js"
import type { BrowserMenuTag } from "./menu.js"
import { type BrowserScreen, menuScreen } from "./screen.js"

type Setter<A> = Dispatch<SetStateAction<A>>

type SelectionSyncArgs = {
  readonly dashboard: DashboardData
  readonly selectedProjectId: string | null
  readonly setProjectAuthSnapshot: Setter<ProjectAuthSnapshot | null>
  readonly setSelectedProject: Setter<ProjectDetails | null>
  readonly setSelectedProjectId: Setter<string | null>
}

type PanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly authSnapshot: AuthSnapshot | null
  readonly busyLabel: string | null
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly dashboardRefreshTick: number
  readonly githubStatus: GithubAuthStatus | null
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly selectedProjectId: string | null
}

type ReadyStateSetters = Pick<
  BrowserActionContext,
  | "setAuthSnapshot"
  | "setBusyLabel"
  | "setDatabaseConnectionInput"
  | "setDatabaseForwards"
  | "setDatabaseLabelInput"
  | "setDatabaseProfiles"
  | "setDatabaseSession"
  | "setGithubStatus"
  | "setMessage"
  | "setOutput"
  | "setPortForwardInput"
  | "setPortForwards"
  | "setProjectAuthSnapshot"
  | "setProjectBrowser"
  | "setProjectTaskLogs"
  | "setProjectTasks"
  | "setSelectedMenuIndex"
  | "setSelectedProject"
  | "setSelectedProjectId"
>

export type ReadyState = ReadyStateSetters & TerminalWorkspaceReadyState & {
  readonly actionPrompt: ActionPromptState | null
  readonly activeScreen: BrowserScreen
  readonly authSnapshot: AuthSnapshot | null
  readonly busyLabel: string | null
  readonly createView: CreateFlowView
  readonly databaseConnectionInput: string
  readonly databaseForwards: ReadonlyArray<ProjectDatabaseForward>
  readonly databaseLabelInput: string
  readonly databaseProfiles: ReadonlyArray<ProjectDatabaseProfile>
  readonly databaseSession: ProjectDatabaseSession | null
  readonly githubStatus: GithubAuthStatus | null
  readonly message: string | null
  readonly output: string
  readonly portForwardInput: string
  readonly portForwards: ReadonlyArray<ProjectPortForward>
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly projectBrowser: ProjectBrowserSession | null
  readonly projectTaskLogs: string
  readonly projectTasks: ContainerTaskSnapshot | null
  readonly setActionPrompt: Setter<ActionPromptState | null>
  readonly setActiveScreen: Setter<BrowserScreen>
  readonly setCreateView: Setter<CreateFlowView>
  readonly setProjectNavigationArmed: Setter<boolean>
  readonly setProjectSearchQuery: Setter<string>
  readonly selectedMenuIndex: number
  readonly selectedProjectId: string | null
  readonly projectSearchQuery: string
}

const useReadyNavigationState = () => {
  const [selectedMenuIndex, setSelectedMenuIndex] = useState(0)
  const [activeScreen, setActiveScreen] = useState<BrowserScreen>(menuScreen)
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)

  return {
    activeScreen,
    selectedMenuIndex,
    selectedProjectId,
    setActiveScreen,
    setSelectedMenuIndex,
    setSelectedProjectId
  }
}

const useReadyPanelState = () => {
  const [actionPrompt, setActionPrompt] = useState<ActionPromptState | null>(null)
  const [output, setOutput] = useState("")
  const [message, setMessage] = useState<string | null>(null)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)
  const [authSnapshot, setAuthSnapshot] = useState<AuthSnapshot | null>(null)
  const [githubStatus, setGithubStatus] = useState<GithubAuthStatus | null>(null)
  const [createView, setCreateView] = useState<CreateFlowView>(resetCreateView())
  const terminalWorkspaceState = useTerminalWorkspaceState()

  return {
    actionPrompt,
    authSnapshot,
    busyLabel,
    createView,
    githubStatus,
    message,
    output,
    setActionPrompt,
    setAuthSnapshot,
    setBusyLabel,
    setCreateView,
    setGithubStatus,
    setMessage,
    setOutput,
    ...terminalWorkspaceState
  }
}

const useReadyProjectState = () => {
  const [project, setSelectedProject] = useState<ProjectDetails | null>(null)
  const [projectNavigationArmed, setProjectNavigationArmed] = useState(false)
  const [projectSearchQuery, setProjectSearchQuery] = useState("")
  const [projectAuthSnapshot, setProjectAuthSnapshot] = useState<ProjectAuthSnapshot | null>(null)
  const [projectBrowser, setProjectBrowser] = useState<ProjectBrowserSession | null>(null)

  return {
    project,
    projectNavigationArmed,
    projectSearchQuery,
    projectAuthSnapshot,
    projectBrowser,
    setProjectNavigationArmed,
    setProjectSearchQuery,
    setProjectAuthSnapshot,
    setProjectBrowser,
    setSelectedProject
  }
}

export const useReadyState = (): ReadyState => {
  const navigationState = useReadyNavigationState()
  const panelState = useReadyPanelState()
  const databaseState = useDatabaseState()
  const portForwardState = usePortForwardState()
  const projectTasksState = useProjectTasksState()
  const projectState = useReadyProjectState()

  return {
    ...navigationState,
    ...panelState,
    ...databaseState,
    ...portForwardState,
    ...projectTasksState,
    ...projectState
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

const maybeRefreshGithubStatus = ({ context, githubStatus }: PanelAutoloadArgs): boolean => {
  if (githubStatus !== null) {
    return false
  }
  refreshAuthPanel(context)
  return true
}

const maybeRefreshAuthScreen = ({ activeScreen, authSnapshot, context, currentMenu }: PanelAutoloadArgs): void => {
  if (activeScreen.tag === "Auth" && shouldRefreshAuthPanel(currentMenu, authSnapshot)) {
    refreshAuthPanel(context)
  }
}

const maybeRefreshProjectAuthScreen = (
  { activeScreen, context, currentMenu, projectAuthSnapshot }: PanelAutoloadArgs
): void => {
  if (activeScreen.tag === "ProjectAuth" && shouldRefreshProjectAuthPanel(currentMenu, projectAuthSnapshot)) {
    refreshProjectAuthPanel(context)
  }
}

const maybeLoadProjectPickerInfo = (
  { activeScreen, context, currentMenu, project, projectNavigationArmed, selectedProjectId }: PanelAutoloadArgs
): void => {
  if (
    activeScreen.tag === "ProjectPicker" &&
    shouldRefreshProjectDetails(currentMenu, projectNavigationArmed, selectedProjectId, project)
  ) {
    loadSelectedProjectInfo(context)
  }
}

const loadReadyPanel = (args: PanelAutoloadArgs): void => {
  if (maybeRefreshGithubStatus(args)) {
    return
  }
  maybeRefreshAuthScreen(args)
  maybeRefreshProjectAuthScreen(args)
  maybeLoadProjectPickerInfo(args)
  maybeLoadProjectPortForwards(args)
  maybeLoadProjectDatabases(args)
  maybeLoadProjectBrowser(args)
  maybeLoadProjectTasks(args)
}

export const usePanelAutoload = (args: PanelAutoloadArgs) => {
  const loadCurrentPanel = useEffectEvent(() => {
    if (args.busyLabel !== null) {
      return
    }
    loadReadyPanel(args)
  })

  useEffect(() => {
    loadCurrentPanel()
  }, [
    args.authSnapshot,
    args.activeScreen,
    args.busyLabel,
    args.currentMenu,
    args.dashboardRefreshTick,
    args.githubStatus,
    args.project?.id,
    args.projectAuthSnapshot,
    args.projectNavigationArmed,
    args.selectedProjectId,
    loadCurrentPanel
  ])
}

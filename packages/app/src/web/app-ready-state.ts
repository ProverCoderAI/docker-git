import { type Dispatch, type SetStateAction, useState } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { BrowserActionContext } from "./actions.js"
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
import { resetCreateView } from "./app-ready-create.js"
import { useDatabaseState } from "./app-ready-databases-hook.js"
import { usePortForwardState } from "./app-ready-port-forwards-hook.js"
import { useProjectTasksState } from "./app-ready-tasks-hook.js"
import { type TerminalWorkspaceReadyState, useTerminalWorkspaceState } from "./app-ready-terminal-state-hook.js"
import { type BrowserScreen, menuScreen } from "./screen.js"

type Setter<A> = Dispatch<SetStateAction<A>>

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
  | "setProjectTasksIncludeDefault"
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
  readonly projectTasksIncludeDefault: boolean
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

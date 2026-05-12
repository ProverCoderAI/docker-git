import { type Dispatch, type SetStateAction, useEffect, useEffectEvent } from "react"

import type { ActionPromptState } from "./action-prompt.js"
import {
  type BrowserActionContext,
  loadSelectedProjectInfo,
  refreshAuthPanel,
  refreshProjectAuthPanel
} from "./actions.js"
import type { AuthSnapshot, DashboardData, GithubAuthStatus, ProjectAuthSnapshot, ProjectDetails } from "./api.js"
import { maybeLoadProjectBrowser } from "./app-ready-browser-hook.js"
import { maybeLoadProjectDatabases } from "./app-ready-databases-hook.js"
import { maybeLoadProjectPortForwards } from "./app-ready-port-forwards-hook.js"
import { maybeLoadProjectPrompts } from "./app-ready-prompts-hook.js"
import {
  normalizeSelectedProjectId,
  shouldRefreshAuthPanel,
  shouldRefreshProjectAuthPanel,
  shouldRefreshProjectDetails
} from "./app-ready-shortcuts.js"
import { maybeLoadProjectSkills } from "./app-ready-skills-hook.js"
import { maybeLoadProjectTasks } from "./app-ready-tasks-hook.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

export { type ReadyState, useReadyState } from "./app-ready-state.js"

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
  maybeLoadProjectPrompts(args)
  maybeLoadProjectSkills(args)
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

import { updateActionPromptValue } from "./action-prompt.js"
import {
  cancelBrowserActionPrompt,
  closeSelectedProjectPort,
  loadSelectedProjectBrowser,
  loadSelectedProjectPorts,
  openProjectBrowserById,
  openSelectedProjectBrowser,
  openSelectedProjectPort,
  submitBrowserActionPrompt
} from "./actions.js"
import type { DashboardData } from "./api.js"
import {
  createActionContext,
  resolveCurrentMenu,
  runAuthActionByIndex,
  runProjectAuthActionByIndex
} from "./app-ready-actions.js"
import { useProjectBrowserReset, useTerminalBrowserAutoload } from "./app-ready-browser-hook.js"
import { useBrowserShortcuts } from "./app-ready-browser-shortcuts-hook.js"
import { cancelCreate, setCreateBuffer, submitCreateView, useCreateMenuReset } from "./app-ready-create.js"
import { useGithubAuthGate } from "./app-ready-github-auth-gate-hook.js"
import {
  useActionPromptReset,
  usePanelAutoload,
  useProjectAuthReset,
  useProjectDetailsReset,
  useProjectNavigationReset,
  useProjectSelectionSync,
  useReadyState
} from "./app-ready-hooks.js"
import { useProjectPortForwardsReset } from "./app-ready-port-forwards-hook.js"
import { bindScreenActions } from "./app-ready-screen-actions.js"
import { useSshLink } from "./app-ready-ssh-link-hook.js"
import { useReadyUrlSync } from "./app-ready-url.js"

type ReadyControllerArgs = {
  readonly dashboard: DashboardData
  readonly dashboardRefreshTick: number
  readonly refreshDashboard: () => void
}

type ReadySideEffectsArgs = {
  readonly actionContext: ReturnType<typeof createActionContext>
  readonly currentMenu: ReturnType<typeof resolveCurrentMenu>
  readonly dashboard: DashboardData
  readonly dashboardRefreshTick: number
  readonly state: ReturnType<typeof useReadyState>
}

const useProjectSyncEffects = (args: ReadySideEffectsArgs) => {
  useProjectSelectionSync({
    dashboard: args.dashboard,
    selectedProjectId: args.state.selectedProjectId,
    setProjectAuthSnapshot: args.state.setProjectAuthSnapshot,
    setSelectedProject: args.state.setSelectedProject,
    setSelectedProjectId: args.state.setSelectedProjectId
  })
}

const useReadyResetEffects = (args: ReadySideEffectsArgs) => {
  useCreateMenuReset(args.currentMenu, args.state.setCreateView)
  useActionPromptReset(args.state.actionPrompt, args.currentMenu, args.state.setActionPrompt)
  useGithubAuthGate({
    actionPrompt: args.state.actionPrompt,
    busyLabel: args.state.busyLabel,
    githubStatus: args.state.githubStatus,
    selectedMenuIndex: args.state.selectedMenuIndex,
    setActionPrompt: args.state.setActionPrompt,
    setActiveScreen: args.state.setActiveScreen,
    setMessage: args.state.setMessage,
    setSelectedMenuIndex: args.state.setSelectedMenuIndex
  })
  useProjectNavigationReset(args.currentMenu, args.state.setProjectNavigationArmed)
  useProjectAuthReset(args.state.selectedProjectId, args.state.setProjectAuthSnapshot)
  useProjectBrowserReset(args.state.selectedProjectId, args.state.setProjectBrowser)
  useProjectDetailsReset(args.state.selectedProjectId, args.state.setSelectedProject)
  useProjectPortForwardsReset(
    args.state.selectedProjectId,
    args.state.setPortForwardInput,
    args.state.setPortForwards
  )
}

const useReadyAutoloadEffects = (args: ReadySideEffectsArgs) => {
  useTerminalBrowserAutoload({
    context: args.actionContext,
    dashboardRefreshTick: args.dashboardRefreshTick,
    terminalSession: args.state.terminalSession
  })
  usePanelAutoload({
    activeScreen: args.state.activeScreen,
    authSnapshot: args.state.authSnapshot,
    busyLabel: args.state.busyLabel,
    context: args.actionContext,
    currentMenu: args.currentMenu,
    dashboardRefreshTick: args.dashboardRefreshTick,
    githubStatus: args.state.githubStatus,
    project: args.state.project,
    projectNavigationArmed: args.state.projectNavigationArmed,
    selectedProjectId: args.state.selectedProjectId,
    projectAuthSnapshot: args.state.projectAuthSnapshot
  })
}

const useReadyShortcutEffects = (args: ReadySideEffectsArgs) => {
  useBrowserShortcuts({
    activeScreen: args.state.activeScreen,
    actionPrompt: args.state.actionPrompt,
    context: args.actionContext,
    controllerCwd: args.dashboard.health.cwd,
    projectsRoot: args.dashboard.health.projectsRoot,
    createView: args.state.createView,
    currentMenu: args.currentMenu,
    dashboard: args.dashboard,
    projectBrowser: args.state.projectBrowser,
    selectedProjectId: args.state.selectedProjectId,
    setCreateView: args.state.setCreateView,
    setActiveScreen: args.state.setActiveScreen,
    setProjectNavigationArmed: args.state.setProjectNavigationArmed,
    setSelectedMenuIndex: args.state.setSelectedMenuIndex,
    setSelectedProjectId: args.state.setSelectedProjectId,
    terminalSession: args.state.terminalSession
  })
}

const useReadySideEffects = (args: ReadySideEffectsArgs) => {
  useReadyUrlSync({
    currentMenu: args.currentMenu,
    dashboard: args.dashboard,
    state: args.state
  })
  useProjectSyncEffects(args)
  useReadyResetEffects(args)
  useSshLink({
    actionContext: args.actionContext,
    busyLabel: args.state.busyLabel,
    dashboard: args.dashboard
  })
  useReadyAutoloadEffects(args)
  useReadyShortcutEffects(args)
}

const bindMenuActions = (actionContext: ReturnType<typeof createActionContext>) => ({
  onRunAuthAction: (index: number) => {
    runAuthActionByIndex(index, actionContext)
  },
  onRunProjectAuthAction: (index: number) => {
    runProjectAuthActionByIndex(index, actionContext)
  }
})

const bindCreateActions = (
  actionContext: ReturnType<typeof createActionContext>,
  dashboard: DashboardData,
  state: ReturnType<typeof useReadyState>
) => ({
  onCreateBufferChange: (buffer: string) => {
    setCreateBuffer(state.createView, state.setCreateView, buffer)
  },
  onCreateCancel: () => {
    cancelCreate(actionContext, state.setCreateView)
  },
  onCreateSubmit: (forceWizard = false) => {
    submitCreateView({
      context: actionContext,
      controllerCwd: dashboard.health.cwd,
      projectsRoot: dashboard.health.projectsRoot,
      createView: state.createView,
      forceWizard,
      setCreateView: state.setCreateView
    })
  }
})

const bindActionPromptActions = (
  actionContext: ReturnType<typeof createActionContext>,
  state: ReturnType<typeof useReadyState>
) => ({
  onActionPromptCancel: () => {
    if (state.actionPrompt !== null) {
      cancelBrowserActionPrompt(state.actionPrompt, actionContext)
    }
  },
  onActionPromptChange: (key: string, value: string) => {
    state.setActionPrompt((prompt) => prompt === null ? null : updateActionPromptValue(prompt, key, value))
  },
  onActionPromptSubmit: () => {
    if (state.actionPrompt !== null) {
      submitBrowserActionPrompt(state.actionPrompt, actionContext)
    }
  }
})

const bindPortForwardActions = (
  actionContext: ReturnType<typeof createActionContext>,
  state: ReturnType<typeof useReadyState>
) => ({
  onCloseProjectPortForward: (targetPort: number) => {
    closeSelectedProjectPort(actionContext, targetPort)
  },
  onOpenProjectPortForward: () => {
    openSelectedProjectPort(actionContext)
  },
  onPortForwardInputChange: (value: string) => {
    state.setPortForwardInput(value)
  },
  onRefreshProjectPortForwards: () => {
    loadSelectedProjectPorts(actionContext)
  }
})

const bindBrowserActions = (
  actionContext: ReturnType<typeof createActionContext>
) => ({
  onOpenProjectBrowserById: (projectId: string) => {
    openProjectBrowserById(projectId, actionContext)
  },
  onOpenProjectBrowser: () => {
    openSelectedProjectBrowser(actionContext)
  },
  onRefreshProjectBrowser: () => {
    loadSelectedProjectBrowser(actionContext)
  }
})

export const useReadyController = ({ dashboard, dashboardRefreshTick, refreshDashboard }: ReadyControllerArgs) => {
  const state = useReadyState()
  const currentMenu = resolveCurrentMenu(state.selectedMenuIndex)
  const selectedProjectSummary = dashboard.projects.find((project) => project.id === state.selectedProjectId)
  const actionContext = createActionContext({
    githubStatus: state.githubStatus,
    portForwardInput: state.portForwardInput,
    refreshDashboard,
    selectedProjectId: state.selectedProjectId,
    selectedProjectName: selectedProjectSummary?.displayName ?? null,
    setActionPrompt: state.setActionPrompt,
    setActiveScreen: state.setActiveScreen,
    setAuthSnapshot: state.setAuthSnapshot,
    setBusyLabel: state.setBusyLabel,
    setGithubStatus: state.setGithubStatus,
    setMessage: state.setMessage,
    setOutput: state.setOutput,
    setPortForwardInput: state.setPortForwardInput,
    setPortForwards: state.setPortForwards,
    setProjectAuthSnapshot: state.setProjectAuthSnapshot,
    setProjectBrowser: state.setProjectBrowser,
    setSelectedMenuIndex: state.setSelectedMenuIndex,
    setSelectedProject: state.setSelectedProject,
    setSelectedProjectId: state.setSelectedProjectId,
    setTerminalSession: state.setTerminalSession
  })

  useReadySideEffects({ actionContext, currentMenu, dashboard, dashboardRefreshTick, state })
  return {
    ...bindMenuActions(actionContext),
    ...bindCreateActions(actionContext, dashboard, state),
    ...bindActionPromptActions(actionContext, state),
    ...bindPortForwardActions(actionContext, state),
    ...bindBrowserActions(actionContext),
    ...bindScreenActions(actionContext, dashboard, state),
    currentMenu,
    selectedProjectSummary,
    state
  }
}

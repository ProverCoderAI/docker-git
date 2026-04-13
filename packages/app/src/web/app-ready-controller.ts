import { updateActionPromptValue } from "./action-prompt.js"
import { cancelBrowserActionPrompt, submitBrowserActionPrompt } from "./actions.js"
import type { DashboardData } from "./api.js"
import {
  createActionContext,
  resolveCurrentMenu,
  runAuthActionByIndex,
  runProjectAuthActionByIndex
} from "./app-ready-actions.js"
import { cancelCreate, setCreateBuffer, submitCreateView, useCreateMenuReset } from "./app-ready-create.js"
import {
  useActionPromptReset,
  useBrowserShortcuts,
  usePanelAutoload,
  useProjectAuthReset,
  useProjectDetailsReset,
  useProjectNavigationReset,
  useProjectSelectionSync,
  useReadyState
} from "./app-ready-hooks.js"

type ReadyControllerArgs = {
  readonly dashboard: DashboardData
  readonly dashboardRefreshTick: number
  readonly refreshDashboard: () => void
}

const useReadySideEffects = (
  args: {
    readonly actionContext: ReturnType<typeof createActionContext>
    readonly currentMenu: ReturnType<typeof resolveCurrentMenu>
    readonly dashboard: DashboardData
    readonly dashboardRefreshTick: number
    readonly state: ReturnType<typeof useReadyState>
  }
) => {
  useProjectSelectionSync({
    dashboard: args.dashboard,
    selectedProjectId: args.state.selectedProjectId,
    setProjectAuthSnapshot: args.state.setProjectAuthSnapshot,
    setSelectedProject: args.state.setSelectedProject,
    setSelectedProjectId: args.state.setSelectedProjectId
  })
  useCreateMenuReset(args.currentMenu, args.state.setCreateView)
  useActionPromptReset(args.state.actionPrompt, args.currentMenu, args.state.setActionPrompt)
  useProjectNavigationReset(args.currentMenu, args.state.setProjectNavigationArmed)
  useProjectAuthReset(args.state.selectedProjectId, args.state.setProjectAuthSnapshot)
  useProjectDetailsReset(args.state.selectedProjectId, args.state.setSelectedProject)
  usePanelAutoload({
    authSnapshot: args.state.authSnapshot,
    busyLabel: args.state.busyLabel,
    context: args.actionContext,
    currentMenu: args.currentMenu,
    dashboardRefreshTick: args.dashboardRefreshTick,
    project: args.state.project,
    projectNavigationArmed: args.state.projectNavigationArmed,
    selectedProjectId: args.state.selectedProjectId,
    projectAuthSnapshot: args.state.projectAuthSnapshot
  })
  useBrowserShortcuts({
    actionPrompt: args.state.actionPrompt,
    context: args.actionContext,
    controllerCwd: args.dashboard.health.cwd,
    projectsRoot: args.dashboard.health.projectsRoot,
    createView: args.state.createView,
    currentMenu: args.currentMenu,
    dashboard: args.dashboard,
    projectNavigationArmed: args.state.projectNavigationArmed,
    selectedProjectId: args.state.selectedProjectId,
    setCreateView: args.state.setCreateView,
    setProjectNavigationArmed: args.state.setProjectNavigationArmed,
    setSelectedMenuIndex: args.state.setSelectedMenuIndex,
    setSelectedProjectId: args.state.setSelectedProjectId,
    terminalSession: args.state.terminalSession
  })
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

export const useReadyController = ({ dashboard, dashboardRefreshTick, refreshDashboard }: ReadyControllerArgs) => {
  const state = useReadyState()
  const currentMenu = resolveCurrentMenu(state.selectedMenuIndex)
  const selectedProjectSummary = dashboard.projects.find((project) => project.id === state.selectedProjectId)
  const actionContext = createActionContext({
    refreshDashboard,
    selectedProjectId: state.selectedProjectId,
    selectedProjectName: selectedProjectSummary?.displayName ?? null,
    setActionPrompt: state.setActionPrompt,
    setAuthSnapshot: state.setAuthSnapshot,
    setBusyLabel: state.setBusyLabel,
    setGithubStatus: state.setGithubStatus,
    setMessage: state.setMessage,
    setOutput: state.setOutput,
    setProjectAuthSnapshot: state.setProjectAuthSnapshot,
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
    currentMenu,
    selectedProjectSummary,
    state
  }
}

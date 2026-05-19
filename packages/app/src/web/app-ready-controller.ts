import { updateActionPromptValue } from "./action-prompt.js"
import {
  cancelBrowserActionPrompt,
  closeSelectedProjectPort,
  copyPanelShareTunnelUrl,
  loadSelectedProjectBrowser,
  loadSelectedProjectPorts,
  openProjectBrowserById,
  openSelectedProjectBrowser,
  openSelectedProjectPort,
  refreshPanelCloudflareTunnel,
  startPanelShareTunnel,
  stopPanelShareTunnel,
  submitBrowserActionPrompt
} from "./actions.js"
import type { DashboardData } from "./api.js"
import type { createActionContext } from "./app-ready-actions.js"
import { resolveCurrentMenu, runAuthActionByIndex, runProjectAuthActionByIndex } from "./app-ready-actions.js"
import { useProjectBrowserReset, useTerminalBrowserAutoload } from "./app-ready-browser-hook.js"
import { useBrowserShortcuts } from "./app-ready-browser-shortcuts-hook.js"
import { createReadyActionContext } from "./app-ready-controller-context.js"
import {
  cancelCreate,
  type CreateSubmitMode,
  setCreateBuffer,
  submitCreateView,
  useCreateMenuReset
} from "./app-ready-create.js"
import { bindDatabaseActions } from "./app-ready-database-actions.js"
import { useProjectDatabasesReset } from "./app-ready-databases-hook.js"
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
import { bindProjectSearchActions } from "./app-ready-project-search-actions.js"
import { bindPromptActions } from "./app-ready-prompt-actions.js"
import { useProjectPromptsReset } from "./app-ready-prompts-hook.js"
import { bindScreenActions } from "./app-ready-screen-actions.js"
import { bindSkillActions } from "./app-ready-skill-actions.js"
import { bindSkillerActions } from "./app-ready-skiller-actions.js"
import { useProjectSkillsReset } from "./app-ready-skills-hook.js"
import { useSshLink } from "./app-ready-ssh-link-hook.js"
import { bindTaskActions } from "./app-ready-task-actions.js"
import { useProjectTasksReset } from "./app-ready-tasks-hook.js"
import { bindTerminalActions } from "./app-ready-terminal-actions.js"
import { useReadyUrlSync } from "./app-ready-url.js"
import { filterDashboardProjectsByQuery } from "./project-search.js"

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
  readonly navigationDashboard: DashboardData
  readonly state: ReturnType<typeof useReadyState>
}

const useProjectSyncEffects = (args: ReadySideEffectsArgs) => {
  useProjectSelectionSync({
    dashboard: args.navigationDashboard,
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
  useProjectDatabasesReset({
    selectedProjectId: args.state.selectedProjectId,
    setDatabaseConnectionInput: args.state.setDatabaseConnectionInput,
    setDatabaseForwards: args.state.setDatabaseForwards,
    setDatabaseLabelInput: args.state.setDatabaseLabelInput,
    setDatabaseProfiles: args.state.setDatabaseProfiles,
    setDatabaseSession: args.state.setDatabaseSession
  })
  useProjectDetailsReset(args.state.selectedProjectId, args.state.setSelectedProject)
  useProjectPortForwardsReset(
    args.state.selectedProjectId,
    args.state.setPortForwardInput,
    args.state.setPortForwards
  )
  useProjectPromptsReset(args.state.selectedProjectId, args.state.setProjectPrompts)
  useProjectSkillsReset(args.state.selectedProjectId, args.state.setProjectSkills)
  useProjectTasksReset(
    args.state.selectedProjectId,
    args.state.setProjectTaskLogs,
    args.state.setProjectTasks,
    args.state.setProjectTasksIncludeDefault
  )
}

const useReadyAutoloadEffects = (args: ReadySideEffectsArgs) => {
  useTerminalBrowserAutoload({
    activeTerminalSession: args.state.activeTerminalSession,
    context: args.actionContext,
    dashboardRefreshTick: args.dashboardRefreshTick
  })
  usePanelAutoload({
    activeScreen: args.state.activeScreen,
    authSnapshot: args.state.authSnapshot,
    busyLabel: args.state.busyLabel,
    context: args.actionContext,
    currentMenu: args.currentMenu,
    dashboardRefreshTick: args.dashboardRefreshTick,
    githubStatus: args.state.githubStatus,
    panelCloudflareTunnel: args.state.panelCloudflareTunnel,
    project: args.state.project,
    projectNavigationArmed: args.state.projectNavigationArmed,
    selectedProjectId: args.state.selectedProjectId,
    projectAuthSnapshot: args.state.projectAuthSnapshot
  })
}

const useReadyShortcutEffects = (args: ReadySideEffectsArgs) => {
  useBrowserShortcuts({
    activeScreen: args.state.activeScreen,
    activeTerminalSessionId: args.state.activeTerminalSessionId,
    actionPrompt: args.state.actionPrompt,
    context: args.actionContext,
    controllerCwd: args.dashboard.health.cwd,
    projectsRoot: args.dashboard.health.projectsRoot,
    createView: args.state.createView,
    currentMenu: args.currentMenu,
    dashboard: args.navigationDashboard,
    projectBrowser: args.state.projectBrowser,
    selectedProjectId: args.state.selectedProjectId,
    setCreateView: args.state.setCreateView,
    setActiveScreen: args.state.setActiveScreen,
    setProjectNavigationArmed: args.state.setProjectNavigationArmed,
    setSelectedMenuIndex: args.state.setSelectedMenuIndex,
    setSelectedProjectId: args.state.setSelectedProjectId,
    terminalSessions: args.state.terminalSessions
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
    activeTerminalSessionId: args.state.activeTerminalSessionId,
    addTerminalSession: args.state.addTerminalSession,
    busyLabel: args.state.busyLabel,
    dashboard: args.dashboard,
    deactivateTerminalWorkspace: args.state.deactivateTerminalWorkspace,
    selectTerminalSession: args.state.selectTerminalSession,
    terminalSessions: args.state.terminalSessions
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
  onCreateSubmit: (mode: CreateSubmitMode) => {
    submitCreateView({
      context: actionContext,
      controllerCwd: dashboard.health.cwd,
      projectsRoot: dashboard.health.projectsRoot,
      createView: state.createView,
      mode,
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

const bindShareActions = (
  actionContext: ReturnType<typeof createActionContext>
) => ({
  onRefreshPanelShareTunnel: () => {
    refreshPanelCloudflareTunnel(actionContext)
  },
  onCopyPanelShareTunnelUrl: (publicUrl: string) => {
    copyPanelShareTunnelUrl(actionContext, publicUrl)
  },
  onStartPanelShareTunnel: () => {
    startPanelShareTunnel(actionContext)
  },
  onStopPanelShareTunnel: () => {
    stopPanelShareTunnel(actionContext)
  }
})

export const useReadyController = ({ dashboard, dashboardRefreshTick, refreshDashboard }: ReadyControllerArgs) => {
  const state = useReadyState()
  const currentMenu = resolveCurrentMenu(state.selectedMenuIndex)
  const navigationDashboard = filterDashboardProjectsByQuery(dashboard, state.projectSearchQuery)
  const selectedProjectSummary = dashboard.projects.find((project) => project.id === state.selectedProjectId)
  const actionContext = createReadyActionContext({ refreshDashboard, selectedProjectSummary, state })

  useReadySideEffects({ actionContext, currentMenu, dashboard, dashboardRefreshTick, navigationDashboard, state })
  return {
    ...bindMenuActions(actionContext),
    ...bindCreateActions(actionContext, dashboard, state),
    ...bindActionPromptActions(actionContext, state),
    ...bindPortForwardActions(actionContext, state),
    ...bindPromptActions(actionContext),
    ...bindSkillActions(actionContext),
    ...bindBrowserActions(actionContext),
    ...bindShareActions(actionContext),
    ...bindTerminalActions(actionContext, state),
    ...bindSkillerActions(actionContext),
    ...bindTaskActions(actionContext),
    ...bindProjectSearchActions(dashboard, state),
    ...bindDatabaseActions(actionContext, state),
    ...bindScreenActions(actionContext, dashboard, state),
    currentMenu,
    selectedProjectSummary,
    state
  }
}

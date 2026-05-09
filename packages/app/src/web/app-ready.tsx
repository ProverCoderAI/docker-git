import { type JSX } from "react"

import type { DashboardData } from "./api.js"
import { useReadyController } from "./app-ready-controller.js"
import { ReadyLayout } from "./app-ready-layout.js"
import type { ViewportLayout } from "./viewport-layout.js"

type AppReadyProps = {
  readonly dashboard: DashboardData
  readonly dashboardRefreshTick: number
  readonly refreshDashboard: () => void
  readonly viewportLayout: ViewportLayout
}

type ReadyLayoutRenderArgs = {
  readonly actions: {
    readonly onActionPromptCancel: () => void
    readonly onActionPromptChange: (key: string, value: string) => void
    readonly onActionPromptSubmit: () => void
    readonly onApplyAllProjects: () => void
    readonly onApplyProjectById: (projectId: string) => void
    readonly onApplySelectedProject: () => void
    readonly onAttachProjectTerminalSession: (
      projectId: string,
      projectKey: string,
      projectDisplayName: string,
      sessionId: string
    ) => void
    readonly onBackScreen: () => void
    readonly onCreateBufferChange: (buffer: string) => void
    readonly onCreateCancel: () => void
    readonly onCreateSubmit: (quickCreate?: boolean) => void
    readonly onDatabaseConnectionInputChange: (value: string) => void
    readonly onDatabaseLabelInputChange: (value: string) => void
    readonly onCloseDatabaseForward: ReturnType<typeof useReadyController>["onCloseDatabaseForward"]
    readonly onDeleteDatabaseProfile: ReturnType<typeof useReadyController>["onDeleteDatabaseProfile"]
    readonly onDeleteProjectPrompt: ReturnType<typeof useReadyController>["onDeleteProjectPrompt"]
    readonly onDeleteProjectSkill: ReturnType<typeof useReadyController>["onDeleteProjectSkill"]
    readonly onExposeDatabaseProfile: ReturnType<typeof useReadyController>["onExposeDatabaseProfile"]
    readonly onOpenMenuScreen: (index: number) => void
    readonly onOpenProjectBrowserById: (projectId: string) => void
    readonly onOpenProjectBrowser: () => void
    readonly onOpenProjectDatabaseEditor: () => void
    readonly onOpenProjectTaskManagerById: (projectId: string) => void
    readonly onCloseProjectPortForward: (targetPort: number) => void
    readonly onKillProjectTerminalSession: (projectId: string, projectKey: string, sessionId: string) => void
    readonly onOpenProjectPortForward: () => void
    readonly onOpenProjectTerminalById: (projectId: string, projectKey?: string) => void
    readonly onPortForwardInputChange: (value: string) => void
    readonly onProjectSearchQueryChange: (value: string) => void
    readonly onRefreshProjectPortForwards: () => void
    readonly onRefreshProjectBrowser: () => void
    readonly onRefreshProjectDatabases: () => void
    readonly onRefreshProjectPrompts: () => void
    readonly onRefreshProjectSkills: () => void
    readonly onRefreshProjectTasks: () => void
    readonly onProjectTasksIncludeDefaultChange: (includeDefault: boolean) => void
    readonly onRestartProjectDatabaseEditor: () => void
    readonly onRunAuthAction: (index: number) => void
    readonly onRunCurrentMenuAction: () => void
    readonly onRunProjectAuthAction: (index: number) => void
    readonly onSaveDatabaseProfile: () => void
    readonly onSaveProjectPrompt: ReturnType<typeof useReadyController>["onSaveProjectPrompt"]
    readonly onSaveProjectSkill: ReturnType<typeof useReadyController>["onSaveProjectSkill"]
    readonly onLoadProjectTaskLogs: (pid: number) => void
    readonly onStopProjectTask: (pid: number) => void
  }
  readonly currentMenu: ReturnType<typeof useReadyController>["currentMenu"]
  readonly dashboard: DashboardData
  readonly dashboardRefreshTick: number
  readonly selectedProjectSummary: ReturnType<typeof useReadyController>["selectedProjectSummary"]
  readonly state: ReturnType<typeof useReadyController>["state"]
  readonly viewportLayout: ViewportLayout
}

const readyActionProps = (actions: ReadyLayoutRenderArgs["actions"]) => ({
  onActionPromptCancel: actions.onActionPromptCancel,
  onActionPromptChange: actions.onActionPromptChange,
  onActionPromptSubmit: actions.onActionPromptSubmit,
  onApplyAllProjects: actions.onApplyAllProjects,
  onApplyProjectById: actions.onApplyProjectById,
  onApplySelectedProject: actions.onApplySelectedProject,
  onAttachProjectTerminalSession: actions.onAttachProjectTerminalSession,
  onBackScreen: actions.onBackScreen,
  onCloseProjectPortForward: actions.onCloseProjectPortForward,
  onCreateBufferChange: actions.onCreateBufferChange,
  onCreateCancel: actions.onCreateCancel,
  onCreateSubmit: actions.onCreateSubmit,
  onCloseDatabaseForward: actions.onCloseDatabaseForward,
  onDatabaseConnectionInputChange: actions.onDatabaseConnectionInputChange,
  onDatabaseLabelInputChange: actions.onDatabaseLabelInputChange,
  onDeleteDatabaseProfile: actions.onDeleteDatabaseProfile,
  onDeleteProjectPrompt: actions.onDeleteProjectPrompt,
  onDeleteProjectSkill: actions.onDeleteProjectSkill,
  onExposeDatabaseProfile: actions.onExposeDatabaseProfile,
  onOpenMenuScreen: actions.onOpenMenuScreen,
  onOpenProjectBrowserById: actions.onOpenProjectBrowserById,
  onOpenProjectBrowser: actions.onOpenProjectBrowser,
  onOpenProjectDatabaseEditor: actions.onOpenProjectDatabaseEditor,
  onOpenProjectTaskManagerById: actions.onOpenProjectTaskManagerById,
  onKillProjectTerminalSession: actions.onKillProjectTerminalSession,
  onOpenProjectPortForward: actions.onOpenProjectPortForward,
  onOpenProjectTerminalById: actions.onOpenProjectTerminalById,
  onPortForwardInputChange: actions.onPortForwardInputChange,
  onProjectSearchQueryChange: actions.onProjectSearchQueryChange,
  onRefreshProjectPortForwards: actions.onRefreshProjectPortForwards,
  onRefreshProjectBrowser: actions.onRefreshProjectBrowser,
  onRefreshProjectDatabases: actions.onRefreshProjectDatabases,
  onRefreshProjectPrompts: actions.onRefreshProjectPrompts,
  onRefreshProjectSkills: actions.onRefreshProjectSkills,
  onRefreshProjectTasks: actions.onRefreshProjectTasks,
  onProjectTasksIncludeDefaultChange: actions.onProjectTasksIncludeDefaultChange,
  onRestartProjectDatabaseEditor: actions.onRestartProjectDatabaseEditor,
  onRunAuthAction: actions.onRunAuthAction,
  onRunCurrentMenuAction: actions.onRunCurrentMenuAction,
  onRunProjectAuthAction: actions.onRunProjectAuthAction,
  onSaveDatabaseProfile: actions.onSaveDatabaseProfile,
  onSaveProjectPrompt: actions.onSaveProjectPrompt,
  onSaveProjectSkill: actions.onSaveProjectSkill,
  onLoadProjectTaskLogs: actions.onLoadProjectTaskLogs,
  onStopProjectTask: actions.onStopProjectTask
})

const readyStateProps = (state: ReadyLayoutRenderArgs["state"]) => ({
  actionPrompt: state.actionPrompt,
  activeScreen: state.activeScreen,
  activeTerminalSession: state.activeTerminalSession,
  activeTerminalSessionId: state.activeTerminalSessionId,
  authSnapshot: state.authSnapshot,
  busyLabel: state.busyLabel,
  createView: state.createView,
  databaseConnectionInput: state.databaseConnectionInput,
  databaseForwards: state.databaseForwards,
  databaseLabelInput: state.databaseLabelInput,
  databaseProfiles: state.databaseProfiles,
  databaseSession: state.databaseSession,
  githubStatus: state.githubStatus,
  message: state.message,
  onSelectTerminal: state.selectTerminalSession,
  onSelectMenu: state.setSelectedMenuIndex,
  onSelectProject: state.setSelectedProjectId,
  onSetActiveScreen: state.setActiveScreen,
  onTerminalClose: state.closeTerminalSession,
  onTerminalMessage: state.setMessage,
  output: state.output,
  portForwardInput: state.portForwardInput,
  portForwards: state.portForwards,
  project: state.project,
  projectAuthSnapshot: state.projectAuthSnapshot,
  projectBrowser: state.projectBrowser,
  projectPrompts: state.projectPrompts,
  projectSkills: state.projectSkills,
  projectTaskLogs: state.projectTaskLogs,
  projectTasks: state.projectTasks,
  projectTasksIncludeDefault: state.projectTasksIncludeDefault,
  projectNavigationArmed: state.projectNavigationArmed,
  projectSearchQuery: state.projectSearchQuery,
  selectedMenuIndex: state.selectedMenuIndex,
  selectedProjectId: state.selectedProjectId,
  terminalSessions: state.terminalSessions
})

const renderReadyLayout = ({
  actions,
  currentMenu,
  dashboard,
  dashboardRefreshTick,
  selectedProjectSummary,
  state,
  viewportLayout
}: ReadyLayoutRenderArgs): JSX.Element => (
  <ReadyLayout
    controllerCwd={dashboard.health.cwd}
    currentMenu={currentMenu}
    dashboard={dashboard}
    dashboardRefreshTick={dashboardRefreshTick}
    projectsRoot={dashboard.health.projectsRoot}
    selectedProjectSummary={selectedProjectSummary}
    viewportLayout={viewportLayout}
    {...readyActionProps(actions)}
    {...readyStateProps(state)}
  />
)

export const AppReady = ({
  dashboard,
  dashboardRefreshTick,
  refreshDashboard,
  viewportLayout
}: AppReadyProps): JSX.Element => {
  const controller = useReadyController({ dashboard, dashboardRefreshTick, refreshDashboard })

  return renderReadyLayout({
    actions: controller,
    currentMenu: controller.currentMenu,
    dashboard,
    dashboardRefreshTick,
    selectedProjectSummary: controller.selectedProjectSummary,
    state: controller.state,
    viewportLayout
  })
}

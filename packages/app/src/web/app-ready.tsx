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
    readonly onBackScreen: () => void
    readonly onCreateBufferChange: (buffer: string) => void
    readonly onCreateCancel: () => void
    readonly onCreateSubmit: (forceWizard?: boolean) => void
    readonly onDatabaseConnectionInputChange: (value: string) => void
    readonly onDatabaseLabelInputChange: (value: string) => void
    readonly onCloseDatabaseForward: ReturnType<typeof useReadyController>["onCloseDatabaseForward"]
    readonly onDeleteDatabaseProfile: ReturnType<typeof useReadyController>["onDeleteDatabaseProfile"]
    readonly onExposeDatabaseProfile: ReturnType<typeof useReadyController>["onExposeDatabaseProfile"]
    readonly onOpenMenuScreen: (index: number) => void
    readonly onOpenProjectBrowserById: (projectId: string) => void
    readonly onOpenProjectBrowser: () => void
    readonly onOpenProjectDatabaseEditor: () => void
    readonly onCloseProjectPortForward: (targetPort: number) => void
    readonly onOpenProjectPortForward: () => void
    readonly onPortForwardInputChange: (value: string) => void
    readonly onRefreshProjectPortForwards: () => void
    readonly onRefreshProjectBrowser: () => void
    readonly onRefreshProjectDatabases: () => void
    readonly onRestartProjectDatabaseEditor: () => void
    readonly onRunAuthAction: (index: number) => void
    readonly onRunCurrentMenuAction: () => void
    readonly onRunProjectAuthAction: (index: number) => void
    readonly onSaveDatabaseProfile: () => void
  }
  readonly currentMenu: ReturnType<typeof useReadyController>["currentMenu"]
  readonly dashboard: DashboardData
  readonly selectedProjectSummary: ReturnType<typeof useReadyController>["selectedProjectSummary"]
  readonly state: ReturnType<typeof useReadyController>["state"]
  readonly viewportLayout: ViewportLayout
}

const readyActionProps = (actions: ReadyLayoutRenderArgs["actions"]) => ({
  onActionPromptCancel: actions.onActionPromptCancel,
  onActionPromptChange: actions.onActionPromptChange,
  onActionPromptSubmit: actions.onActionPromptSubmit,
  onBackScreen: actions.onBackScreen,
  onCloseProjectPortForward: actions.onCloseProjectPortForward,
  onCreateBufferChange: actions.onCreateBufferChange,
  onCreateCancel: actions.onCreateCancel,
  onCreateSubmit: actions.onCreateSubmit,
  onCloseDatabaseForward: actions.onCloseDatabaseForward,
  onDatabaseConnectionInputChange: actions.onDatabaseConnectionInputChange,
  onDatabaseLabelInputChange: actions.onDatabaseLabelInputChange,
  onDeleteDatabaseProfile: actions.onDeleteDatabaseProfile,
  onExposeDatabaseProfile: actions.onExposeDatabaseProfile,
  onOpenMenuScreen: actions.onOpenMenuScreen,
  onOpenProjectBrowserById: actions.onOpenProjectBrowserById,
  onOpenProjectBrowser: actions.onOpenProjectBrowser,
  onOpenProjectDatabaseEditor: actions.onOpenProjectDatabaseEditor,
  onOpenProjectPortForward: actions.onOpenProjectPortForward,
  onPortForwardInputChange: actions.onPortForwardInputChange,
  onRefreshProjectPortForwards: actions.onRefreshProjectPortForwards,
  onRefreshProjectBrowser: actions.onRefreshProjectBrowser,
  onRefreshProjectDatabases: actions.onRefreshProjectDatabases,
  onRestartProjectDatabaseEditor: actions.onRestartProjectDatabaseEditor,
  onRunAuthAction: actions.onRunAuthAction,
  onRunCurrentMenuAction: actions.onRunCurrentMenuAction,
  onRunProjectAuthAction: actions.onRunProjectAuthAction,
  onSaveDatabaseProfile: actions.onSaveDatabaseProfile
})

const readyStateProps = (state: ReadyLayoutRenderArgs["state"]) => ({
  actionPrompt: state.actionPrompt,
  activeScreen: state.activeScreen,
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
  onSelectMenu: state.setSelectedMenuIndex,
  onSelectProject: state.setSelectedProjectId,
  onSetActiveScreen: state.setActiveScreen,
  onTerminalClose: () => {
    state.setTerminalSession(null)
  },
  onTerminalMessage: state.setMessage,
  output: state.output,
  portForwardInput: state.portForwardInput,
  portForwards: state.portForwards,
  project: state.project,
  projectAuthSnapshot: state.projectAuthSnapshot,
  projectBrowser: state.projectBrowser,
  projectNavigationArmed: state.projectNavigationArmed,
  selectedMenuIndex: state.selectedMenuIndex,
  selectedProjectId: state.selectedProjectId,
  terminalSession: state.terminalSession
})

const renderReadyLayout = ({
  actions,
  currentMenu,
  dashboard,
  selectedProjectSummary,
  state,
  viewportLayout
}: ReadyLayoutRenderArgs): JSX.Element => (
  <ReadyLayout
    controllerCwd={dashboard.health.cwd}
    currentMenu={currentMenu}
    dashboard={dashboard}
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
    selectedProjectSummary: controller.selectedProjectSummary,
    state: controller.state,
    viewportLayout
  })
}

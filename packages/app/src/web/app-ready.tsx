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
    readonly onCreateBufferChange: (buffer: string) => void
    readonly onCreateCancel: () => void
    readonly onCreateSubmit: (forceWizard?: boolean) => void
    readonly onRunAuthAction: (index: number) => void
    readonly onRunProjectAuthAction: (index: number) => void
  }
  readonly currentMenu: ReturnType<typeof useReadyController>["currentMenu"]
  readonly dashboard: DashboardData
  readonly selectedProjectSummary: ReturnType<typeof useReadyController>["selectedProjectSummary"]
  readonly state: ReturnType<typeof useReadyController>["state"]
  readonly viewportLayout: ViewportLayout
}

const renderReadyLayout = ({
  actions,
  currentMenu,
  dashboard,
  selectedProjectSummary,
  state,
  viewportLayout
}: ReadyLayoutRenderArgs): JSX.Element => (
  <ReadyLayout
    actionPrompt={state.actionPrompt}
    authSnapshot={state.authSnapshot}
    busyLabel={state.busyLabel}
    controllerCwd={dashboard.health.cwd}
    projectsRoot={dashboard.health.projectsRoot}
    createView={state.createView}
    currentMenu={currentMenu}
    dashboard={dashboard}
    githubStatus={state.githubStatus}
    message={state.message}
    onActionPromptCancel={actions.onActionPromptCancel}
    onActionPromptChange={actions.onActionPromptChange}
    onActionPromptSubmit={actions.onActionPromptSubmit}
    onCreateBufferChange={actions.onCreateBufferChange}
    onCreateCancel={actions.onCreateCancel}
    onCreateSubmit={actions.onCreateSubmit}
    onRunAuthAction={actions.onRunAuthAction}
    onRunProjectAuthAction={actions.onRunProjectAuthAction}
    onSelectMenu={state.setSelectedMenuIndex}
    onSelectProject={state.setSelectedProjectId}
    output={state.output}
    project={state.project}
    projectNavigationArmed={state.projectNavigationArmed}
    projectAuthSnapshot={state.projectAuthSnapshot}
    onTerminalClose={() => {
      state.setTerminalSession(null)
    }}
    onTerminalMessage={state.setMessage}
    selectedMenuIndex={state.selectedMenuIndex}
    selectedProjectId={state.selectedProjectId}
    selectedProjectSummary={selectedProjectSummary}
    terminalSession={state.terminalSession}
    viewportLayout={viewportLayout}
  />
)

export const AppReady = ({
  dashboard,
  dashboardRefreshTick,
  refreshDashboard,
  viewportLayout
}: AppReadyProps): JSX.Element => {
  const {
    currentMenu,
    onActionPromptCancel,
    onActionPromptChange,
    onActionPromptSubmit,
    onCreateBufferChange,
    onCreateCancel,
    onCreateSubmit,
    onRunAuthAction,
    onRunProjectAuthAction,
    selectedProjectSummary,
    state
  } = useReadyController({ dashboard, dashboardRefreshTick, refreshDashboard })

  return renderReadyLayout({
    actions: {
      onActionPromptCancel,
      onActionPromptChange,
      onActionPromptSubmit,
      onCreateBufferChange,
      onCreateCancel,
      onCreateSubmit,
      onRunAuthAction,
      onRunProjectAuthAction
    },
    currentMenu,
    dashboard,
    selectedProjectSummary,
    state,
    viewportLayout
  })
}

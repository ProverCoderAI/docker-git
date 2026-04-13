import type { JSX } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { AuthSnapshot, DashboardData, GithubAuthStatus, ProjectAuthSnapshot, ProjectDetails } from "./api.js"
import { MainPanels } from "./app-ready-main-panels.js"
import { Box, Text } from "./elements.js"
import type { BrowserMenuTag } from "./menu.js"
import type { ActiveTerminalSession } from "./terminal.js"
import type { ViewportLayout } from "./viewport-layout.js"

export type ReadyLayoutProps = {
  readonly actionPrompt: ActionPromptState | null
  readonly authSnapshot: AuthSnapshot | null
  readonly busyLabel: string | null
  readonly controllerCwd: string
  readonly projectsRoot: string
  readonly createView: CreateFlowView
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly githubStatus: GithubAuthStatus | null
  readonly message: string | null
  readonly onActionPromptCancel: () => void
  readonly onActionPromptChange: (key: string, value: string) => void
  readonly onActionPromptSubmit: () => void
  readonly onCreateBufferChange: (buffer: string) => void
  readonly onCreateCancel: () => void
  readonly onCreateSubmit: (forceWizard?: boolean) => void
  readonly onRunAuthAction: (index: number) => void
  readonly onRunProjectAuthAction: (index: number) => void
  readonly onSelectMenu: (index: number) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onTerminalClose: () => void
  readonly onTerminalMessage: (message: string | null) => void
  readonly output: string
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly selectedMenuIndex: number
  readonly selectedProjectId: string | null
  readonly selectedProjectSummary: DashboardData["projects"][number] | undefined
  readonly terminalSession: ActiveTerminalSession | null
  readonly viewportLayout: ViewportLayout
}

const headerPadding = (viewportLayout: ViewportLayout): number | string =>
  viewportLayout.compact || viewportLayout.dense ? "6px" : 1

const headerGap = (viewportLayout: ViewportLayout): number => viewportLayout.compact ? 1 : 2

const headerMetricsTopMargin = (viewportLayout: ViewportLayout): number | string => viewportLayout.compact ? "4px" : 1

const HeaderTitle = ({ compact }: Pick<ViewportLayout, "compact">): JSX.Element => (
  <Box flexWrap="wrap" gap={1} justifyContent="space-between">
    <Text bold={true} fg="#f6fbff">docker-git browser</Text>
    {compact ? null : <Text fg="#7fdfff">Gridland menu shell</Text>}
  </Box>
)

const StatusText = ({ busyLabel }: Pick<ReadyLayoutProps, "busyLabel">): JSX.Element => (
  <Text fg={busyLabel === null ? "#8fa6c4" : "#ffd166"}>{busyLabel ?? "idle"}</Text>
)

const HeaderMetrics = (
  { busyLabel, dashboard, viewportLayout }: Pick<ReadyLayoutProps, "busyLabel" | "dashboard" | "viewportLayout">
): JSX.Element => (
  <Box flexWrap="wrap" gap={headerGap(viewportLayout)} marginTop={headerMetricsTopMargin(viewportLayout)}>
    <Text fg="#9fd7ff" wrap="truncate">API: {dashboard.apiBaseUrl}</Text>
    <Text fg="#56f39a">health: ok</Text>
    <Text fg="#ffd166" wrap="truncate">revision: {dashboard.health.revision ?? "none"}</Text>
    <Text fg="#d4e3f4">projects: {dashboard.projects.length}</Text>
    {viewportLayout.compact ? null : <Text fg="#7fa8cf">refresh: 15s</Text>}
    <StatusText busyLabel={busyLabel} />
  </Box>
)

const HeaderMessage = ({ message }: Pick<ReadyLayoutProps, "message">): JSX.Element | null =>
  message === null
    ? null
    : <Text fg="#f6d27b" marginTop="4px" wrap="truncate">message: {message}</Text>

const StatusHeader = (
  { busyLabel, dashboard, message, viewportLayout }: Pick<
    ReadyLayoutProps,
    "busyLabel" | "dashboard" | "message" | "viewportLayout"
  >
): JSX.Element => (
  <Box
    backgroundColor="#0a1730"
    border={true}
    borderColor="#39d0ff"
    borderStyle="rounded"
    flexDirection="column"
    flexShrink={0}
    marginBottom={1}
    padding={headerPadding(viewportLayout)}
  >
    <HeaderTitle compact={viewportLayout.compact} />
    <HeaderMetrics busyLabel={busyLabel} dashboard={dashboard} viewportLayout={viewportLayout} />
    <HeaderMessage message={message} />
  </Box>
)

export const ReadyLayout = ({ busyLabel, message, ...props }: ReadyLayoutProps): JSX.Element => (
  <Box flexDirection="column" height="100%" minHeight={0} overflow="hidden" padding={1} width="100%">
    <StatusHeader
      busyLabel={busyLabel}
      dashboard={props.dashboard}
      message={message}
      viewportLayout={props.viewportLayout}
    />
    <MainPanels {...props} />
  </Box>
)

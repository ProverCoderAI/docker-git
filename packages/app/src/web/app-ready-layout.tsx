import type { JSX } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type {
  AuthSnapshot,
  ContainerTaskSnapshot,
  DashboardData,
  GithubAuthStatus,
  PanelCloudflareTunnelSession,
  ProjectAuthSnapshot,
  ProjectBrowserSession,
  ProjectDatabaseForward,
  ProjectDatabaseProfile,
  ProjectDatabaseSession,
  ProjectDetails,
  ProjectPortForward,
  ProjectPromptKind,
  ProjectPromptsSnapshot,
  ProjectSkillScope,
  ProjectSkillsSnapshot
} from "./api.js"
import type { CreateSubmitMode } from "./app-ready-create.js"
import { MainPanels } from "./app-ready-main-panels.js"
import { Box, Text } from "./elements.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"
import { visibleTerminalWorkspaceState } from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"
import type { ViewportLayout } from "./viewport-layout.js"

export type ReadyLayoutProps = {
  readonly actionPrompt: ActionPromptState | null
  readonly activeScreen: BrowserScreen
  readonly activeTerminalSession: ActiveTerminalSession | null
  readonly activeTerminalSessionId: string | null
  readonly authSnapshot: AuthSnapshot | null
  readonly busyLabel: string | null
  readonly controllerCwd: string
  readonly dashboardRefreshTick: number
  readonly projectsRoot: string
  readonly createView: CreateFlowView
  readonly currentMenu: BrowserMenuTag
  readonly dashboard: DashboardData
  readonly databaseConnectionInput: string
  readonly databaseForwards: ReadonlyArray<ProjectDatabaseForward>
  readonly databaseLabelInput: string
  readonly databaseProfiles: ReadonlyArray<ProjectDatabaseProfile>
  readonly databaseSession: ProjectDatabaseSession | null
  readonly githubStatus: GithubAuthStatus | null
  readonly message: string | null
  readonly onActionPromptCancel: () => void
  readonly onActionPromptChange: (key: string, value: string) => void
  readonly onActionPromptSubmit: () => void
  readonly onApplyAllProjects: () => void
  readonly onApplyProjectById: (projectId: string, gpu?: "none" | "all") => void
  readonly onApplySelectedProject: (gpu?: "none" | "all") => void
  readonly onAttachProjectTerminalSession: (
    projectId: string,
    projectKey: string,
    projectDisplayName: string,
    sessionId: string
  ) => void
  readonly onBackScreen: () => void
  readonly onCreateBufferChange: (buffer: string) => void
  readonly onCreateCancel: () => void
  readonly onCreateSubmit: (mode: CreateSubmitMode) => void
  readonly onCloseProjectPortForward: (targetPort: number) => void
  readonly onDatabaseConnectionInputChange: (value: string) => void
  readonly onDatabaseLabelInputChange: (value: string) => void
  readonly onDeleteDatabaseProfile: (profile: ProjectDatabaseProfile) => void
  readonly onDeleteProjectPrompt: (kind: ProjectPromptKind) => void
  readonly onDeleteProjectSkill: (scope: ProjectSkillScope, name: string) => void
  readonly onCloseDatabaseForward: (profile: ProjectDatabaseProfile) => void
  readonly onExposeDatabaseProfile: (profile: ProjectDatabaseProfile) => void
  readonly onCopyPanelShareTunnelUrl: (publicUrl: string) => void
  readonly onRunAuthAction: (index: number) => void
  readonly onRunProjectAuthAction: (index: number) => void
  readonly onOpenMenuScreen: (index: number) => void
  readonly onOpenProjectBrowserById: (projectId: string) => void
  readonly onOpenProjectBrowser: () => void
  readonly onOpenProjectDatabaseEditor: () => void
  readonly onOpenProjectTaskManagerById: (projectId: string) => void
  readonly onOpenSkiller: (projectKey?: string, sessionId?: string) => void
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
  readonly onRefreshPanelShareTunnel: () => void
  readonly onProjectTasksIncludeDefaultChange: (includeDefault: boolean) => void
  readonly onRestartProjectDatabaseEditor: () => void
  readonly onSaveDatabaseProfile: () => void
  readonly onSaveProjectPrompt: (kind: ProjectPromptKind, content: string) => void
  readonly onSaveProjectSkill: (scope: ProjectSkillScope, name: string, content: string) => void
  readonly onSetActiveScreen: (screen: BrowserScreen) => void
  readonly onSelectMenu: (index: number) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onRunCurrentMenuAction: () => void
  readonly onAuthTerminalExitSuccess: () => void
  readonly onSelectTerminal: (sessionId: string) => void
  readonly onTerminalClose: (sessionId: string) => void
  readonly onTerminalMessage: (message: string | null) => void
  readonly onLoadProjectTaskLogs: (pid: number) => void
  readonly onStopProjectTask: (pid: number) => void
  readonly onStartPanelShareTunnel: () => void
  readonly onStopPanelShareTunnel: () => void
  readonly output: string
  readonly panelCloudflareTunnel: PanelCloudflareTunnelSession | null
  readonly portForwardInput: string
  readonly portForwards: ReadonlyArray<ProjectPortForward>
  readonly project: ProjectDetails | null
  readonly projectNavigationArmed: boolean
  readonly projectAuthSnapshot: ProjectAuthSnapshot | null
  readonly projectBrowser: ProjectBrowserSession | null
  readonly projectPrompts: ProjectPromptsSnapshot | null
  readonly projectSkills: ProjectSkillsSnapshot | null
  readonly projectTaskLogs: string
  readonly projectTasks: ContainerTaskSnapshot | null
  readonly projectTasksIncludeDefault: boolean
  readonly selectedMenuIndex: number
  readonly selectedProjectId: string | null
  readonly selectedProjectSummary: DashboardData["projects"][number] | undefined
  readonly projectSearchQuery: string
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
  readonly viewportLayout: ViewportLayout
}

const headerPadding = (viewportLayout: ViewportLayout): number | string =>
  viewportLayout.compact || viewportLayout.dense ? "6px" : 1

const headerGap = (viewportLayout: ViewportLayout): number => viewportLayout.compact ? 1 : 2

const headerMetricsTopMargin = (viewportLayout: ViewportLayout): number | string => viewportLayout.compact ? "4px" : 1
const terminalWorkspacePadding = (viewportLayout: ViewportLayout): string => {
  if (viewportLayout.mode === "mobile") {
    return "0px"
  }
  return viewportLayout.keyboardOpen ? "4px" : "8px"
}

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

const hasVisibleTerminalWorkspace = (
  { activeTerminalSessionId, terminalSessions }: Pick<
    ReadyLayoutProps,
    "activeTerminalSessionId" | "terminalSessions"
  >
): boolean => visibleTerminalWorkspaceState({ activeTerminalSessionId, terminalSessions }).terminalSessions.length > 0

const StatusHeader = (
  { busyLabel, dashboard, message, viewportLayout }: Pick<
    ReadyLayoutProps,
    "busyLabel" | "dashboard" | "message" | "viewportLayout"
  >
): JSX.Element => (
  <Box
    backgroundColor="#101317"
    border={true}
    borderColor="#3a4652"
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

const TerminalWorkspaceStatus = (
  { busyLabel, message }: Pick<ReadyLayoutProps, "busyLabel" | "message">
): JSX.Element | null =>
  busyLabel === null && message === null
    ? null
    : (
      <Box
        backgroundColor="#101317"
        border={true}
        borderColor="#3a4652"
        borderStyle="rounded"
        flexShrink={0}
        gap="8px"
        marginBottom="6px"
        padding="6px"
      >
        <StatusText busyLabel={busyLabel} />
        {message === null ? null : <Text fg="#f6d27b" wrap="truncate">message: {message}</Text>}
      </Box>
    )

export const ReadyLayout = ({ busyLabel, message, ...props }: ReadyLayoutProps): JSX.Element => (
  hasVisibleTerminalWorkspace(props)
    ? (
      <Box
        flexDirection="column"
        height="100%"
        minHeight={0}
        overflow="hidden"
        padding={terminalWorkspacePadding(props.viewportLayout)}
        width="100%"
      >
        <TerminalWorkspaceStatus busyLabel={busyLabel} message={message} />
        <MainPanels {...props} />
      </Box>
    )
    : (
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
)

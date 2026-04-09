import type { JSX } from "react"

import type { CreateFlowView } from "../docker-git/menu-create-shared.js"
import type { ActionPromptState } from "./action-prompt.js"
import type { AuthSnapshot, DashboardData, GithubAuthStatus, ProjectAuthSnapshot, ProjectDetails } from "./api.js"
import { MainPanels } from "./app-ready-main-panels.js"
import { Box, Text } from "./elements.js"
import type { BrowserMenuTag } from "./menu.js"
import type { ActiveTerminalSession } from "./terminal.js"

export type ReadyLayoutProps = {
  readonly actionPrompt: ActionPromptState | null
  readonly authSnapshot: AuthSnapshot | null
  readonly busyLabel: string | null
  readonly compact: boolean
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
}

const StatusHeader = (
  { busyLabel, dashboard, message }: Pick<ReadyLayoutProps, "busyLabel" | "dashboard" | "message">
): JSX.Element => (
  <Box
    backgroundColor="#0a1730"
    border={true}
    borderColor="#39d0ff"
    borderStyle="rounded"
    flexDirection="column"
    marginBottom={1}
    padding={1}
  >
    <Box justifyContent="space-between">
      <Text bold={true} fg="#f6fbff">docker-git browser</Text>
      <Text fg="#7fdfff">Gridland menu shell</Text>
    </Box>
    <Text fg="#9fd7ff">API: {dashboard.apiBaseUrl}</Text>
    <Box gap={2} marginTop={1}>
      <Text fg="#56f39a">health: ok</Text>
      <Text fg="#ffd166">revision: {dashboard.health.revision ?? "none"}</Text>
      <Text fg="#d4e3f4">projects: {dashboard.projects.length}</Text>
      <Text fg="#7fa8cf">refresh: 15s</Text>
      <Text fg={busyLabel === null ? "#8fa6c4" : "#ffd166"}>{busyLabel ?? "idle"}</Text>
    </Box>
    {message === null ? null : <Text fg="#f6d27b">message: {message}</Text>}
  </Box>
)

export const ReadyLayout = ({ busyLabel, message, ...props }: ReadyLayoutProps): JSX.Element => (
  <Box flexDirection="column" height="100%" padding={1} width="100%">
    <StatusHeader busyLabel={busyLabel} dashboard={props.dashboard} message={message} />
    <MainPanels {...props} />
  </Box>
)

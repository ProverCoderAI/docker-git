import type { CSSProperties, JSX } from "react"

import type { ProjectDetails } from "./api.js"
import type { ProjectHandlers, TaskHandlers } from "./app-terminal-session-handlers.js"
import { Box, Text } from "./elements.js"
import { TaskPanel } from "./panel-tasks.js"
import { TerminalPanel } from "./panel-terminal.js"
import type { ActiveTerminalSession } from "./terminal.js"
import type { ViewportLayout } from "./viewport-layout.js"

export const terminalOnlyContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minHeight: 0,
  overflow: "hidden",
  padding: "8px",
  width: "100%"
}

const terminalOnlyMessageStyle: CSSProperties = {
  background: "#101419",
  border: "1px solid #3a4652",
  borderRadius: "8px",
  color: "#f6d27b",
  flexShrink: 0,
  marginBottom: "8px",
  overflow: "hidden",
  padding: "8px",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap"
}

const taskManagerBodyStyle: CSSProperties = {
  background: "#080a0d",
  boxSizing: "border-box",
  color: "#d6e5f7",
  height: "100%",
  overflow: "auto",
  padding: "10px"
}

const taskManagerToolbarStyle: CSSProperties = {
  alignItems: "center",
  display: "flex",
  justifyContent: "flex-end",
  marginBottom: "10px"
}

const taskManagerReturnButtonStyle: CSSProperties = {
  background: "#171d24",
  border: "1px solid #3a4652",
  borderRadius: "8px",
  color: "#d6e5f7",
  cursor: "pointer",
  font: "inherit",
  padding: "6px 10px"
}

export const TerminalOnlyMessage = (
  { message }: { readonly message: string | null }
): JSX.Element | null => message === null ? null : <div style={terminalOnlyMessageStyle}>{message}</div>

type TaskManagerBodyProps = {
  readonly onClose: () => void
  readonly project: ProjectDetails | null
  readonly tasks: TaskHandlers
}

const TerminalTaskManagerBody = (
  { onClose, project, tasks }: TaskManagerBodyProps
): JSX.Element => (
  <div style={taskManagerBodyStyle}>
    <div style={taskManagerToolbarStyle}>
      <button onClick={onClose} style={taskManagerReturnButtonStyle} type="button">
        Terminal
      </button>
    </div>
    <TaskPanel
      includeDefault={tasks.taskIncludeDefault}
      logs={tasks.logs}
      onIncludeDefaultChange={tasks.onIncludeDefaultChange}
      onLoadLogs={tasks.onLoadLogs}
      onRefreshTasks={tasks.onRefresh}
      onStopTask={tasks.onStopTask}
      project={project}
      selectedProjectSummary={undefined}
      snapshot={tasks.snapshot}
    />
  </div>
)

export type RenderTaskManagerBodyArgs = {
  readonly onCloseTaskManager: () => void
  readonly project: ProjectDetails | null
  readonly projectId: string | undefined
  readonly taskManagerOpen: boolean
  readonly tasks: TaskHandlers
}

export const renderTaskManagerBody = (
  { onCloseTaskManager, project, projectId, taskManagerOpen, tasks }: RenderTaskManagerBodyArgs
): JSX.Element | undefined =>
  taskManagerOpen && projectId !== undefined
    ? <TerminalTaskManagerBody onClose={onCloseTaskManager} project={project} tasks={tasks} />
    : undefined

export type TerminalOnlyCallbacks = {
  readonly onAttachFailure: () => void
  readonly onDetach: () => void
  readonly onKill: () => void
  readonly onMessage: (message: string) => void
}

export type TerminalOnlyTerminalPanelArgs = {
  readonly bodyContent: JSX.Element | undefined
  readonly callbacks: TerminalOnlyCallbacks
  readonly handlers: ProjectHandlers
  readonly session: ActiveTerminalSession
  readonly viewportLayout: ViewportLayout
}

export const TerminalOnlyTerminalPanel = (
  { bodyContent, callbacks, handlers, session, viewportLayout }: TerminalOnlyTerminalPanelArgs
): JSX.Element => (
  <TerminalPanel
    bodyContent={bodyContent}
    keyboardOpen={viewportLayout.keyboardOpen}
    mobileMode={viewportLayout.mode === "mobile"}
    onApplyProject={handlers.onApplyProject}
    onAttachFailure={callbacks.onAttachFailure}
    onDetach={callbacks.onDetach}
    onKill={callbacks.onKill}
    onMessage={callbacks.onMessage}
    onOpenBrowser={handlers.onOpenBrowser}
    onOpenSkiller={handlers.onOpenSkiller}
    onOpenTaskManager={handlers.onOpenTaskManager}
    onOpenTerminal={handlers.onOpenTerminal}
    session={session}
  />
)

export const TerminalOnlyClosed = ({ message }: { readonly message: string }): JSX.Element => (
  <Box alignItems="center" height="100%" justifyContent="center" padding={2} width="100%">
    <Box border={true} borderColor="#3a4652" borderStyle="rounded" flexDirection="column" padding={2}>
      <Text bold={true} fg="#f5fbff">SSH terminal</Text>
      <Text fg="#f6d27b">{message}</Text>
    </Box>
  </Box>
)

export const TerminalOnlyLoading = ({ sessionId }: { readonly sessionId: string }): JSX.Element => (
  <Box alignItems="center" height="100%" justifyContent="center" padding={2} width="100%">
    <Box border={true} borderColor="#3a4652" borderStyle="rounded" flexDirection="column" padding={2}>
      <Text bold={true} fg="#f5fbff">SSH terminal</Text>
      <Text fg="#7fdfff">session: {sessionId}</Text>
      <Text fg="#a8c0dc">Attaching terminal...</Text>
    </Box>
  </Box>
)

export const TerminalOnlyError = (
  { apiBaseUrl, message }: { readonly apiBaseUrl: string; readonly message: string }
): JSX.Element => (
  <Box height="100%" justifyContent="center" padding={2} width="100%">
    <Box border={true} borderColor="#ff6b7d" borderStyle="rounded" flexDirection="column" padding={2}>
      <Text bold={true} fg="#ffd8de">SSH terminal unavailable</Text>
      <Text fg="#ffd166">target: {apiBaseUrl}</Text>
      <Text fg="#f2b7bf">{message}</Text>
    </Box>
  </Box>
)

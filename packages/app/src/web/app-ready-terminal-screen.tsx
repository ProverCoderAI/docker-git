import type { JSX } from "react"
import { useEffect, useState } from "react"

import { TerminalPane } from "./app-ready-terminal-pane.js"
import { TerminalTabs } from "./app-ready-terminal-tabs.js"
import type { TerminalScreenProps, TerminalWorkspaceView } from "./app-ready-terminal-types.js"
import { Box } from "./elements.js"
import { shouldShowTerminalTabs } from "./terminal-mobile-layout.js"
import { terminalSessionId } from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"

const resolveActiveTerminalSessionId = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  activeTerminalSessionId: string | null
): string | null => {
  if (
    activeTerminalSessionId !== null &&
    sessions.some((session) => terminalSessionId(session) === activeTerminalSessionId)
  ) {
    return activeTerminalSessionId
  }
  const fallback = sessions[0]
  return fallback === undefined ? null : terminalSessionId(fallback)
}

const TerminalScreenTabs = (
  props: TerminalScreenProps & {
    readonly activeSessionId: string | null
    readonly mobileMode: boolean
  }
): JSX.Element | null =>
  shouldShowTerminalTabs(props.mobileMode, props.terminalSessions.length)
    ? (
      <TerminalTabs
        activeSessionId={props.activeSessionId}
        compactMobile={props.mobileMode}
        onOpenProjectTerminalById={props.onOpenProjectTerminalById}
        onSelectTerminal={props.onSelectTerminal}
        terminalSessions={props.terminalSessions}
      />
    )
    : null

const ActiveTerminalPane = (
  props: TerminalScreenProps & {
    readonly activeSession: ActiveTerminalSession | undefined
    readonly setTerminalView: (view: TerminalWorkspaceView) => void
    readonly terminalView: TerminalWorkspaceView
  }
): JSX.Element | null =>
  props.activeSession === undefined
    ? null
    : (
      <TerminalPane
        key={terminalSessionId(props.activeSession)}
        onApplyProjectById={props.onApplyProjectById}
        onAuthTerminalExitSuccess={props.onAuthTerminalExitSuccess}
        onCloseTaskManager={() => {
          props.setTerminalView("terminal")
        }}
        onLoadProjectTaskLogs={props.onLoadProjectTaskLogs}
        onOpenProjectBrowserById={props.onOpenProjectBrowserById}
        onOpenProjectTaskManagerById={(projectId) => {
          props.setTerminalView("tasks")
          props.onOpenProjectTaskManagerById(projectId)
        }}
        onOpenProjectTerminalById={props.onOpenProjectTerminalById}
        onOpenSkiller={props.onOpenSkiller}
        onProjectTasksIncludeDefaultChange={props.onProjectTasksIncludeDefaultChange}
        onRefreshProjectTasks={props.onRefreshProjectTasks}
        onSetActiveScreen={props.onSetActiveScreen}
        onStopProjectTask={props.onStopProjectTask}
        onTerminalClose={props.onTerminalClose}
        onTerminalMessage={props.onTerminalMessage}
        project={props.project}
        projectBrowser={props.projectBrowser}
        projectTaskLogs={props.projectTaskLogs}
        projectTasks={props.projectTasks}
        projectTasksIncludeDefault={props.projectTasksIncludeDefault}
        selectedProjectSummary={props.selectedProjectSummary}
        singleSession={props.terminalSessions.length === 1}
        taskManagerOpen={props.terminalView === "tasks"}
        terminalSession={props.activeSession}
        viewportLayout={props.viewportLayout}
      />
    )

const TerminalScreenLayout = (
  props: TerminalScreenProps & {
    readonly activeSession: ActiveTerminalSession | undefined
    readonly activeSessionId: string | null
    readonly mobileMode: boolean
    readonly setTerminalView: (view: TerminalWorkspaceView) => void
    readonly terminalView: TerminalWorkspaceView
  }
): JSX.Element => (
  <Box flexDirection="column" flexGrow={1} gap={props.mobileMode ? "4px" : 1} minHeight={0} overflow="hidden">
    <TerminalScreenTabs
      {...props}
      activeSessionId={props.activeSessionId}
      mobileMode={props.mobileMode}
    />
    <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
      <ActiveTerminalPane
        {...props}
        activeSession={props.activeSession}
        setTerminalView={props.setTerminalView}
        terminalView={props.terminalView}
      />
    </Box>
  </Box>
)

export const TerminalScreen = (props: TerminalScreenProps): JSX.Element | null => {
  const [terminalView, setTerminalView] = useState<TerminalWorkspaceView>("terminal")
  const mobileMode = props.viewportLayout.mode === "mobile"
  const activeSessionId = resolveActiveTerminalSessionId(props.terminalSessions, props.activeTerminalSessionId)
  const activeSession = props.terminalSessions.find((session) => terminalSessionId(session) === activeSessionId)
  useEffect(() => {
    setTerminalView("terminal")
  }, [activeSession?.browserProjectId, activeSessionId])
  return props.terminalSessions.length === 0
    ? null
    : (
      <TerminalScreenLayout
        {...props}
        activeSession={activeSession}
        activeSessionId={activeSessionId}
        mobileMode={mobileMode}
        setTerminalView={setTerminalView}
        terminalView={terminalView}
      />
    )
}

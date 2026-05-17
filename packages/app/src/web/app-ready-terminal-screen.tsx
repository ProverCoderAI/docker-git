import { Effect } from "effect"
import { type CSSProperties, type JSX, useEffect, useState } from "react"

import { deleteTerminalSessionByPath } from "./api.js"
import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import type { ReadyLayoutProps } from "./app-ready-layout.js"
import { Box, Text } from "./elements.js"
import { TaskPanel } from "./panel-tasks.js"
import { TerminalPanel } from "./panel-terminal.js"
import { type BrowserScreen, projectPickerScreen } from "./screen.js"
import { shouldShowTerminalTabs } from "./terminal-mobile-layout.js"
import { terminalSessionId } from "./terminal-state.js"
import { type ActiveTerminalSession, isPendingActiveTerminalSession, terminalTitleById } from "./terminal.js"

type TerminalWorkspaceView = "terminal" | "tasks"

type TerminalScreenProps = Pick<
  ReadyLayoutProps,
  | "activeTerminalSessionId"
  | "onApplyProjectById"
  | "onOpenProjectBrowserById"
  | "onOpenProjectTaskManagerById"
  | "onOpenProjectTerminalById"
  | "onOpenSkiller"
  | "onLoadProjectTaskLogs"
  | "onProjectTasksIncludeDefaultChange"
  | "onRefreshProjectTasks"
  | "onSelectTerminal"
  | "onSetActiveScreen"
  | "onStopProjectTask"
  | "onTerminalClose"
  | "onTerminalMessage"
  | "project"
  | "projectBrowser"
  | "projectTaskLogs"
  | "projectTasks"
  | "projectTasksIncludeDefault"
  | "selectedProjectSummary"
  | "terminalSessions"
  | "viewportLayout"
>

type TerminalPaneProps =
  & Pick<
    TerminalScreenProps,
    | "onApplyProjectById"
    | "onOpenProjectBrowserById"
    | "onOpenProjectTaskManagerById"
    | "onOpenProjectTerminalById"
    | "onOpenSkiller"
    | "onLoadProjectTaskLogs"
    | "onProjectTasksIncludeDefaultChange"
    | "onRefreshProjectTasks"
    | "onSetActiveScreen"
    | "onStopProjectTask"
    | "onTerminalClose"
    | "onTerminalMessage"
    | "project"
    | "projectBrowser"
    | "projectTaskLogs"
    | "projectTasks"
    | "projectTasksIncludeDefault"
    | "selectedProjectSummary"
    | "viewportLayout"
  >
  & {
    readonly taskManagerOpen: boolean
    readonly onCloseTaskManager: () => void
    readonly singleSession: boolean
    readonly terminalSession: ActiveTerminalSession
  }

const requestTerminalSessionClose = (closePath: string): void => {
  void Effect.runPromise(deleteTerminalSessionByPath(closePath).pipe(Effect.either, Effect.asVoid))
}

const terminalReturnScreen = (session: ActiveTerminalSession): BrowserScreen =>
  session.closePath.startsWith("/auth/") ? { tag: "Auth" } : projectPickerScreen()

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
  return null
}

const activeTerminalPaneStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  overflow: "hidden"
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

const pendingTerminalBodyStyle: CSSProperties = {
  alignItems: "center",
  background: "rgba(8, 10, 13, 0.92)",
  boxSizing: "border-box",
  color: "#d6e5f7",
  display: "flex",
  height: "100%",
  justifyContent: "center",
  padding: "20px",
  textAlign: "center",
  whiteSpace: "pre-wrap"
}

const fallbackTerminalTabLabel = (session: ActiveTerminalSession): string => session.browserProjectName ?? session.header

const terminalTabLabel = (
  session: ActiveTerminalSession,
  labels: ReadonlyMap<string, string>
): string =>
  session.browserProjectId === undefined
    ? fallbackTerminalTabLabel(session)
    : labels.get(terminalSessionId(session)) ?? fallbackTerminalTabLabel(session)

const projectSkillerAction = (
  projectKey: string | undefined,
  sessionId: string,
  onOpenSkiller: (projectKey?: string, sessionId?: string) => void
): (() => void) | undefined =>
  projectKey === undefined
    ? undefined
    : () => {
      onOpenSkiller(projectKey, sessionId)
    }

const PendingTerminalBody = ({ session }: { readonly session: ActiveTerminalSession }): JSX.Element | null => {
  if (!isPendingActiveTerminalSession(session)) {
    return null
  }

  const { pendingConnection } = session
  const hint = pendingConnection.phase === "error"
    ? "Close this tab or open a new terminal to retry."
    : "The terminal workspace is open. SSH will attach as soon as the project is ready."
  return (
    <div style={pendingTerminalBodyStyle}>
      <div>
        <div>{pendingConnection.message}</div>
        <div style={{ color: "#8fa6c4", fontSize: "12px", marginTop: "10px" }}>{hint}</div>
      </div>
    </div>
  )
}

const TerminalTaskManagerBody = (
  {
    onClose,
    onLoadProjectTaskLogs,
    onProjectTasksIncludeDefaultChange,
    onRefreshProjectTasks,
    onStopProjectTask,
    project,
    projectTaskLogs,
    projectTasks,
    projectTasksIncludeDefault,
    selectedProjectSummary
  }:
    & Pick<
      TerminalScreenProps,
      | "onLoadProjectTaskLogs"
      | "onProjectTasksIncludeDefaultChange"
      | "onRefreshProjectTasks"
      | "onStopProjectTask"
      | "project"
      | "projectTaskLogs"
      | "projectTasks"
      | "projectTasksIncludeDefault"
      | "selectedProjectSummary"
    >
    & {
      readonly onClose: () => void
    }
): JSX.Element => (
  <div style={taskManagerBodyStyle}>
    <div style={taskManagerToolbarStyle}>
      <button onClick={onClose} style={taskManagerReturnButtonStyle} type="button">
        Terminal
      </button>
    </div>
    <TaskPanel
      includeDefault={projectTasksIncludeDefault}
      logs={projectTaskLogs}
      onIncludeDefaultChange={onProjectTasksIncludeDefaultChange}
      onLoadLogs={onLoadProjectTaskLogs}
      onRefreshTasks={onRefreshProjectTasks}
      onStopTask={onStopProjectTask}
      project={project}
      selectedProjectSummary={selectedProjectSummary}
      snapshot={projectTasks}
    />
  </div>
)

const TerminalTab = (
  {
    active,
    compactMobile,
    onSelect,
    session,
    terminalLabels
  }: {
    readonly active: boolean
    readonly compactMobile: boolean
    readonly onSelect: () => void
    readonly session: ActiveTerminalSession
    readonly terminalLabels: ReadonlyMap<string, string>
  }
): JSX.Element => (
  <Box
    backgroundColor={active ? "#17212b" : "#0f141a"}
    border={true}
    borderColor={active ? "#78f0a3" : "#3a4652"}
    maxWidth={compactMobile ? "44vw" : "none"}
    minWidth={0}
    onClick={onSelect}
    padding="6px"
    width="auto"
  >
    <Text bold={active} fg={active ? "#e8fff0" : "#9fb2c7"} wrap="truncate">
      {terminalTabLabel(session, terminalLabels)}
    </Text>
  </Box>
)

const TerminalTabs = (
  {
    activeSessionId,
    compactMobile,
    onOpenProjectTerminalById,
    onSelectTerminal,
    terminalSessions
  }: Pick<TerminalScreenProps, "onOpenProjectTerminalById" | "onSelectTerminal" | "terminalSessions"> & {
    readonly activeSessionId: string | null
    readonly compactMobile: boolean
  }
): JSX.Element => {
  const terminalLabels = terminalTitleById(terminalSessions.map((session) => session.session))
  if (compactMobile) {
    return (
      <div
        style={{
          display: "flex",
          flexShrink: 0,
          gap: "6px",
          minWidth: 0,
          overflowX: "auto",
          overflowY: "hidden",
          paddingBottom: "4px"
        }}
      >
        {terminalSessions.map((session) => {
          const sessionId = terminalSessionId(session)
          return (
            <TerminalTab
              active={sessionId === activeSessionId}
              compactMobile={true}
              key={sessionId}
              onSelect={() => {
                onSelectTerminal(sessionId)
              }}
              session={session}
              terminalLabels={terminalLabels}
            />
          )
        })}
        {terminalSessions.length === 0
          ? null
          : (
            <Box
              border={true}
              borderColor="#3a4652"
              onClick={() => {
                const active = terminalSessions.find((session) => terminalSessionId(session) === activeSessionId) ??
                  terminalSessions.at(-1)
                const projectId = active?.browserProjectId
                const projectKey = active?.browserProjectKey
                if (projectId !== undefined) {
                  onOpenProjectTerminalById(projectId, projectKey)
                }
              }}
              padding="6px"
              width="auto"
            >
              <Text bold={true} fg="#78f0a3">+ New</Text>
            </Box>
          )}
      </div>
    )
  }

  return (
    <Box flexShrink={0} flexWrap="wrap" gap={1}>
      {terminalSessions.map((session) => {
        const sessionId = terminalSessionId(session)
        return (
          <TerminalTab
            active={sessionId === activeSessionId}
            compactMobile={false}
            key={sessionId}
            onSelect={() => {
              onSelectTerminal(sessionId)
            }}
            session={session}
            terminalLabels={terminalLabels}
          />
        )
      })}
      {terminalSessions.length === 0
        ? null
        : (
          <Box
            border={true}
            borderColor="#3a4652"
            onClick={() => {
              const active = terminalSessions.find((session) => terminalSessionId(session) === activeSessionId) ??
                terminalSessions.at(-1)
              const projectId = active?.browserProjectId
              const projectKey = active?.browserProjectKey
              if (projectId !== undefined) {
                onOpenProjectTerminalById(projectId, projectKey)
              }
            }}
            padding="6px"
            width="auto"
          >
            <Text bold={true} fg="#78f0a3">+ New terminal</Text>
          </Box>
        )}
    </Box>
  )
}

const TerminalPane = (
  {
    onApplyProjectById,
    onCloseTaskManager,
    onLoadProjectTaskLogs,
    onOpenProjectBrowserById,
    onOpenProjectTaskManagerById,
    onOpenProjectTerminalById,
    onOpenSkiller,
    onProjectTasksIncludeDefaultChange,
    onRefreshProjectTasks,
    onSetActiveScreen,
    onStopProjectTask,
    onTerminalClose,
    onTerminalMessage,
    project,
    projectBrowser,
    projectTaskLogs,
    projectTasks,
    projectTasksIncludeDefault,
    selectedProjectSummary,
    singleSession,
    taskManagerOpen,
    terminalSession,
    viewportLayout
  }: TerminalPaneProps
): JSX.Element => {
  const sessionId = terminalSessionId(terminalSession)
  const browserProjectId = terminalSession.browserProjectId
  const browserProjectKey = terminalSession.browserProjectKey
  const canOpenBrowser = canOpenProjectBrowser(projectBrowser, browserProjectId)
  const pendingSession = isPendingActiveTerminalSession(terminalSession)
  let bodyContent: JSX.Element | undefined
  if (taskManagerOpen && browserProjectId !== undefined) {
    bodyContent = (
      <TerminalTaskManagerBody
        onClose={onCloseTaskManager}
        onLoadProjectTaskLogs={onLoadProjectTaskLogs}
        onProjectTasksIncludeDefaultChange={onProjectTasksIncludeDefaultChange}
        onRefreshProjectTasks={onRefreshProjectTasks}
        onStopProjectTask={onStopProjectTask}
        project={project}
        projectTaskLogs={projectTaskLogs}
        projectTasks={projectTasks}
        projectTasksIncludeDefault={projectTasksIncludeDefault}
        selectedProjectSummary={selectedProjectSummary}
      />
    )
  } else if (pendingSession) {
    bodyContent = <PendingTerminalBody session={terminalSession} />
  }
  const detachTerminalSession = (): void => {
    onTerminalClose(sessionId)
    if (singleSession) {
      onSetActiveScreen(terminalReturnScreen(terminalSession))
    }
  }
  return (
    <div style={activeTerminalPaneStyle}>
      <TerminalPanel
        bodyContent={bodyContent}
        keyboardOpen={viewportLayout.keyboardOpen}
        mobileMode={viewportLayout.mode === "mobile"}
        onAttachFailure={() => {
          detachTerminalSession()
        }}
        onDetach={() => {
          detachTerminalSession()
          onTerminalMessage(
            `${pendingSession ? "Closed pending" : "Detached"} SSH terminal: ${terminalSession.session.id}.`
          )
        }}
        onKill={() => {
          if (!pendingSession) {
            requestTerminalSessionClose(terminalSession.closePath)
            terminalSession.onExit?.()
          }
          detachTerminalSession()
          onTerminalMessage(
            `${pendingSession ? "Closed pending" : "Killed"} SSH terminal: ${terminalSession.session.id}.`
          )
        }}
        onOpenBrowser={browserProjectId === undefined || !canOpenBrowser
          ? undefined
          : () => {
            onOpenProjectBrowserById(browserProjectId)
          }}
        onOpenSkiller={projectSkillerAction(browserProjectKey, terminalSession.session.id, onOpenSkiller)}
        onApplyProject={browserProjectId === undefined
          ? undefined
          : () => {
            onApplyProjectById(browserProjectId)
          }}
        onOpenTaskManager={browserProjectId === undefined
          ? undefined
          : () => {
            onOpenProjectTaskManagerById(browserProjectId)
          }}
        onOpenTerminal={browserProjectId === undefined
          ? undefined
          : () => {
            onOpenProjectTerminalById(browserProjectId, browserProjectKey)
          }}
        onMessage={onTerminalMessage}
        session={terminalSession}
      />
    </div>
  )
}

export const TerminalScreen = (props: TerminalScreenProps): JSX.Element | null => {
  const [terminalView, setTerminalView] = useState<TerminalWorkspaceView>("terminal")
  const mobileMode = props.viewportLayout.mode === "mobile"
  const activeSessionId = resolveActiveTerminalSessionId(props.terminalSessions, props.activeTerminalSessionId)
  const activeSession = props.terminalSessions.find((session) => terminalSessionId(session) === activeSessionId)
  useEffect(() => {
    setTerminalView("terminal")
  }, [activeSession?.browserProjectId, activeSessionId])
  if (props.terminalSessions.length === 0) {
    return null
  }
  return (
    <Box flexDirection="column" flexGrow={1} gap={mobileMode ? "4px" : 1} minHeight={0} overflow="hidden">
      {shouldShowTerminalTabs(mobileMode, props.terminalSessions.length)
        ? (
          <TerminalTabs
            activeSessionId={activeSessionId}
            compactMobile={mobileMode}
            onOpenProjectTerminalById={props.onOpenProjectTerminalById}
            onSelectTerminal={props.onSelectTerminal}
            terminalSessions={props.terminalSessions}
          />
        )
        : null}
      <Box flexDirection="column" flexGrow={1} minHeight={0} overflow="hidden">
        {activeSession === undefined
          ? null
          : (
            <TerminalPane
              key={terminalSessionId(activeSession)}
              onApplyProjectById={props.onApplyProjectById}
              onCloseTaskManager={() => {
                setTerminalView("terminal")
              }}
              onLoadProjectTaskLogs={props.onLoadProjectTaskLogs}
              onOpenProjectBrowserById={props.onOpenProjectBrowserById}
              onOpenProjectTaskManagerById={(projectId) => {
                setTerminalView("tasks")
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
              taskManagerOpen={terminalView === "tasks"}
              terminalSession={activeSession}
              viewportLayout={props.viewportLayout}
            />
          )}
      </Box>
    </Box>
  )
}

import { Effect } from "effect"
import type { CSSProperties, JSX } from "react"

import { deleteTerminalSessionByPath } from "./api.js"
import { canOpenProjectBrowser } from "./app-ready-browser-openable.js"
import { TerminalTaskManagerBody } from "./app-ready-terminal-task-manager.js"
import type { TerminalPaneProps } from "./app-ready-terminal-types.js"
import { TerminalPanel } from "./panel-terminal.js"
import { type BrowserScreen, projectPickerScreen } from "./screen.js"
import type { TerminalExitInfo } from "./terminal-panel-runtime-types.js"
import { terminalSessionId } from "./terminal-state.js"
import { type ActiveTerminalSession, isPendingActiveTerminalSession } from "./terminal.js"

type TerminalPaneRuntime = {
  readonly browserProjectId: string | undefined
  readonly browserProjectKey: string | undefined
  readonly canOpenBrowser: boolean
  readonly pendingSession: boolean
  readonly sessionId: string
}

const activeTerminalPaneStyle: CSSProperties = {
  display: "flex",
  flex: 1,
  minHeight: 0,
  overflow: "hidden"
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

const requestTerminalSessionClose = (
  closePath: string,
  onFailure: (error: string) => void,
  onSuccess: () => void
): void => {
  void Effect.runPromise(
    deleteTerminalSessionByPath(closePath).pipe(
      Effect.match({ onFailure, onSuccess })
    )
  )
}

const terminalReturnScreen = (session: ActiveTerminalSession): BrowserScreen =>
  session.closePath.startsWith("/auth/") ? { tag: "Auth" } : projectPickerScreen()

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

const resolveTerminalPaneRuntime = (props: TerminalPaneProps): TerminalPaneRuntime => {
  const browserProjectId = props.terminalSession.browserProjectId
  return {
    browserProjectId,
    browserProjectKey: props.terminalSession.browserProjectKey,
    canOpenBrowser: canOpenProjectBrowser(props.projectBrowser, browserProjectId),
    pendingSession: isPendingActiveTerminalSession(props.terminalSession),
    sessionId: terminalSessionId(props.terminalSession)
  }
}

const terminalBodyContent = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): JSX.Element | undefined => {
  if (props.taskManagerOpen && runtime.browserProjectId !== undefined) {
    return (
      <TerminalTaskManagerBody
        onClose={props.onCloseTaskManager}
        onLoadProjectTaskLogs={props.onLoadProjectTaskLogs}
        onProjectTasksIncludeDefaultChange={props.onProjectTasksIncludeDefaultChange}
        onRefreshProjectTasks={props.onRefreshProjectTasks}
        onStopProjectTask={props.onStopProjectTask}
        project={props.project}
        projectTaskLogs={props.projectTaskLogs}
        projectTasks={props.projectTasks}
        projectTasksIncludeDefault={props.projectTasksIncludeDefault}
        selectedProjectSummary={props.selectedProjectSummary}
      />
    )
  }
  return runtime.pendingSession ? <PendingTerminalBody session={props.terminalSession} /> : undefined
}

const detachTerminalSession = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): void => {
  props.onTerminalClose(runtime.sessionId)
  if (props.singleSession) {
    props.onSetActiveScreen(terminalReturnScreen(props.terminalSession))
  }
}

const handleTerminalExit = (
  props: TerminalPaneProps,
  runtime: TerminalPaneRuntime,
  exitInfo: TerminalExitInfo
): void => {
  if (!props.terminalSession.closePath.startsWith("/auth/") || exitInfo.exitCode !== 0) {
    return
  }
  props.onAuthTerminalExitSuccess()
  detachTerminalSession(props, runtime)
}

const handleTerminalKill = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): void => {
  requestTerminalSessionClose(
    props.terminalSession.closePath,
    (error) => {
      props.onTerminalMessage(`Could not close SSH terminal ${props.terminalSession.session.id}: ${error}`)
    },
    () => {
      props.terminalSession.onExit?.()
      detachTerminalSession(props, runtime)
      props.onTerminalMessage(
        `${runtime.pendingSession ? "Closed pending" : "Killed"} SSH terminal: ${props.terminalSession.session.id}.`
      )
    }
  )
}

const openBrowserAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined || !runtime.canOpenBrowser
    ? undefined
    : () => {
      props.onOpenProjectBrowserById(projectId)
    }
}

const applyProjectAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined
    ? undefined
    : () => {
      props.onApplyProjectById(projectId)
    }
}

const openTaskManagerAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined
    ? undefined
    : () => {
      props.onOpenProjectTaskManagerById(projectId)
    }
}

const openTerminalAction = (props: TerminalPaneProps, runtime: TerminalPaneRuntime): (() => void) | undefined => {
  const projectId = runtime.browserProjectId
  return projectId === undefined
    ? undefined
    : () => {
      props.onOpenProjectTerminalById(projectId, runtime.browserProjectKey)
    }
}

const TerminalPanelForPane = (
  { bodyContent, props, runtime }: {
    readonly bodyContent: JSX.Element | undefined
    readonly props: TerminalPaneProps
    readonly runtime: TerminalPaneRuntime
  }
): JSX.Element => (
  <TerminalPanel
    bodyContent={bodyContent}
    keyboardOpen={props.viewportLayout.keyboardOpen}
    mobileMode={props.viewportLayout.mode === "mobile"}
    onAttachFailure={() => {
      detachTerminalSession(props, runtime)
    }}
    onDetach={() => {
      detachTerminalSession(props, runtime)
      props.onTerminalMessage(
        `${runtime.pendingSession ? "Closed pending" : "Detached"} SSH terminal: ${props.terminalSession.session.id}.`
      )
    }}
    onExit={(exitInfo) => {
      handleTerminalExit(props, runtime, exitInfo)
    }}
    onKill={() => {
      handleTerminalKill(props, runtime)
    }}
    onOpenBrowser={openBrowserAction(props, runtime)}
    onOpenSkiller={projectSkillerAction(
      runtime.browserProjectKey,
      props.terminalSession.session.id,
      props.onOpenSkiller
    )}
    onApplyProject={applyProjectAction(props, runtime)}
    onOpenTaskManager={openTaskManagerAction(props, runtime)}
    onOpenTerminal={openTerminalAction(props, runtime)}
    onMessage={props.onTerminalMessage}
    session={props.terminalSession}
  />
)

export const TerminalPane = (props: TerminalPaneProps): JSX.Element => {
  const runtime = resolveTerminalPaneRuntime(props)
  const bodyContent = terminalBodyContent(props, runtime)
  return (
    <div style={activeTerminalPaneStyle}>
      <TerminalPanelForPane bodyContent={bodyContent} props={props} runtime={runtime} />
    </div>
  )
}

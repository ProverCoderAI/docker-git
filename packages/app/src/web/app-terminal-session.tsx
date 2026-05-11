import { Effect, Match } from "effect"
import { type Dispatch, type JSX, type SetStateAction, useCallback, useEffect, useState } from "react"

import {
  deleteTerminalSessionByPath,
  loadProjectDetails,
  loadTerminalSessionById,
  type ProjectDetails,
  resolveApiBaseUrl
} from "./api.js"
import { buildTerminalOnlyActiveSession } from "./app-terminal-session-core.js"
import {
  type ProjectHandlers,
  type TaskHandlers,
  useProjectActionHandlers,
  useTaskManagerHandlers
} from "./app-terminal-session-handlers.js"
import {
  renderTaskManagerBody,
  TerminalOnlyClosed,
  terminalOnlyContainerStyle,
  TerminalOnlyError,
  TerminalOnlyLoading,
  TerminalOnlyMessage,
  TerminalOnlyTerminalPanel
} from "./app-terminal-session-ui.js"
import type { ActiveTerminalSession } from "./terminal.js"
import type { ViewportLayout } from "./viewport-layout.js"

type AppTerminalSessionProps = {
  readonly sessionId: string
  readonly viewportLayout: ViewportLayout
}

type TerminalOnlyState =
  | { readonly _tag: "Loading"; readonly sessionId: string }
  | { readonly _tag: "Ready"; readonly message: string | null; readonly session: ActiveTerminalSession }
  | { readonly _tag: "Closed"; readonly message: string }
  | { readonly _tag: "Error"; readonly apiBaseUrl: string; readonly message: string }

type TerminalOnlyStateSetter = Dispatch<SetStateAction<TerminalOnlyState>>

const terminalOnlyLoadingState = (sessionId: string): TerminalOnlyState => ({
  _tag: "Loading",
  sessionId
})

const terminalOnlyErrorState = (message: string): TerminalOnlyState => ({
  _tag: "Error",
  apiBaseUrl: resolveApiBaseUrl(),
  message
})

const terminalOnlyClosedState = (message: string): TerminalOnlyState => ({
  _tag: "Closed",
  message
})

const loadTerminalOnlyState = (sessionId: string): Effect.Effect<TerminalOnlyState> =>
  loadTerminalSessionById(sessionId).pipe(
    Effect.match({
      onFailure: (message) => terminalOnlyErrorState(message),
      onSuccess: (lookup) => ({
        _tag: "Ready",
        message: null,
        session: buildTerminalOnlyActiveSession(lookup)
      })
    })
  )

const closeTerminalSession = (session: ActiveTerminalSession): void => {
  void Effect.runPromise(deleteTerminalSessionByPath(session.closePath).pipe(Effect.either, Effect.asVoid))
}

const updateReadyMessage = (setState: TerminalOnlyStateSetter, message: string | null): void => {
  setState((current) => current._tag === "Ready" ? { ...current, message } : current)
}

const useLoadedProjectDetails = (projectId: string | undefined): ProjectDetails | null => {
  const [project, setProject] = useState<ProjectDetails | null>(null)
  useEffect(() => {
    if (projectId === undefined) {
      return
    }
    let cancelled = false
    void Effect.runPromise(
      loadProjectDetails(projectId).pipe(
        Effect.tap((details) =>
          Effect.sync(() => {
            if (!cancelled) {
              setProject(details)
            }
          })
        ),
        Effect.catchAll(() => Effect.sync(() => {})),
        Effect.asVoid
      )
    )
    return () => {
      cancelled = true
    }
  }, [projectId])
  return project
}

type TerminalOnlyReadyArgs = {
  readonly session: ActiveTerminalSession
  readonly setState: TerminalOnlyStateSetter
  readonly state: Extract<TerminalOnlyState, { readonly _tag: "Ready" }>
  readonly viewportLayout: ViewportLayout
}

const useTerminalOnlyReadyState = (
  session: ActiveTerminalSession,
  setState: TerminalOnlyStateSetter
): {
  readonly handlers: ProjectHandlers
  readonly project: ProjectDetails | null
  readonly setMessage: (message: string | null) => void
  readonly tasks: TaskHandlers
  readonly taskManagerOpen: boolean
  readonly setTaskManagerOpen: Dispatch<SetStateAction<boolean>>
} => {
  const projectId = session.browserProjectId
  const projectKey = session.browserProjectKey
  const projectLabel = session.browserProjectName ?? projectId ?? "this project"
  const project = useLoadedProjectDetails(projectId)
  const [taskManagerOpen, setTaskManagerOpen] = useState(false)
  const setMessage = useCallback(
    (message: string | null) => {
      updateReadyMessage(setState, message)
    },
    [setState]
  )
  const tasks = useTaskManagerHandlers({ projectId, setMessage })
  const handlers = useProjectActionHandlers({
    onOpenTaskManagerRequest: () => {
      setTaskManagerOpen(true)
      tasks.refreshTasks(tasks.taskIncludeDefault)
    },
    projectId,
    projectKey,
    projectLabel,
    setMessage
  })
  return { handlers, project, setMessage, setTaskManagerOpen, taskManagerOpen, tasks }
}

const TerminalOnlyReady = (
  { session, setState, state, viewportLayout }: TerminalOnlyReadyArgs
): JSX.Element => {
  const { handlers, project, setMessage, setTaskManagerOpen, taskManagerOpen, tasks } = useTerminalOnlyReadyState(
    session,
    setState
  )
  const bodyContent = renderTaskManagerBody({
    onCloseTaskManager: () => {
      setTaskManagerOpen(false)
    },
    project,
    projectId: session.browserProjectId,
    taskManagerOpen,
    tasks
  })
  return (
    <div style={terminalOnlyContainerStyle}>
      <TerminalOnlyMessage message={state.message} />
      <TerminalOnlyTerminalPanel
        bodyContent={bodyContent}
        callbacks={{
          onAttachFailure: () => {
            setState(terminalOnlyErrorState(`Terminal websocket closed before attach: ${session.session.id}.`))
          },
          onDetach: () => {
            setState(terminalOnlyClosedState(`Detached SSH terminal: ${session.session.id}.`))
          },
          onKill: () => {
            closeTerminalSession(session)
            setState(terminalOnlyClosedState(`Killed SSH terminal: ${session.session.id}.`))
          },
          onMessage: setMessage
        }}
        handlers={handlers}
        session={session}
        viewportLayout={viewportLayout}
      />
    </div>
  )
}

const renderTerminalOnlyState = (
  state: TerminalOnlyState,
  setState: TerminalOnlyStateSetter,
  viewportLayout: ViewportLayout
): JSX.Element =>
  Match.value(state).pipe(
    Match.when({ _tag: "Loading" }, ({ sessionId }) => <TerminalOnlyLoading sessionId={sessionId} />),
    Match.when(
      { _tag: "Error" },
      ({ apiBaseUrl, message }) => <TerminalOnlyError apiBaseUrl={apiBaseUrl} message={message} />
    ),
    Match.when({ _tag: "Closed" }, ({ message }) => <TerminalOnlyClosed message={message} />),
    Match.when({ _tag: "Ready" }, (readyState) => (
      <TerminalOnlyReady
        session={readyState.session}
        setState={setState}
        state={readyState}
        viewportLayout={viewportLayout}
      />
    )),
    Match.exhaustive
  )

export const AppTerminalSession = ({ sessionId, viewportLayout }: AppTerminalSessionProps): JSX.Element => {
  const [state, setState] = useState<TerminalOnlyState>(() => terminalOnlyLoadingState(sessionId))

  useEffect(() => {
    let cancelled = false
    setState(terminalOnlyLoadingState(sessionId))
    void Effect.runPromise(
      loadTerminalOnlyState(sessionId).pipe(
        Effect.tap((nextState) =>
          Effect.sync(() => {
            if (!cancelled) {
              setState(nextState)
            }
          })
        ),
        Effect.asVoid
      )
    )
    return () => {
      cancelled = true
    }
  }, [sessionId])

  return renderTerminalOnlyState(state, setState, viewportLayout)
}

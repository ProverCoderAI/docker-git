import { Effect, Match } from "effect"
import { type CSSProperties, type Dispatch, type JSX, type SetStateAction, useEffect, useState } from "react"

import { deleteTerminalSessionByPath, loadTerminalSessionById, resolveApiBaseUrl } from "./api.js"
import { buildTerminalOnlyActiveSession } from "./app-terminal-session-core.js"
import { Box, Text } from "./elements.js"
import { TerminalPanel } from "./panel-terminal.js"
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

const terminalOnlyContainerStyle: CSSProperties = {
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

const loadTerminalOnlyState = (
  sessionId: string
): Effect.Effect<TerminalOnlyState> =>
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

const updateReadyMessage = (
  setState: TerminalOnlyStateSetter,
  message: string | null
): void => {
  setState((current) =>
    current._tag === "Ready"
      ? {
        ...current,
        message
      }
      : current
  )
}

const TerminalOnlyMessage = ({ message }: { readonly message: string | null }): JSX.Element | null =>
  message === null ? null : <div style={terminalOnlyMessageStyle}>{message}</div>

const TerminalOnlyReady = (
  {
    session,
    setState,
    state,
    viewportLayout
  }: {
    readonly session: ActiveTerminalSession
    readonly setState: TerminalOnlyStateSetter
    readonly state: Extract<TerminalOnlyState, { readonly _tag: "Ready" }>
    readonly viewportLayout: ViewportLayout
  }
): JSX.Element => (
  <div style={terminalOnlyContainerStyle}>
    <TerminalOnlyMessage message={state.message} />
    <TerminalPanel
      keyboardOpen={viewportLayout.keyboardOpen}
      mobileMode={viewportLayout.mode === "mobile"}
      onAttachFailure={() => {
        setState(terminalOnlyErrorState(`Terminal websocket closed before attach: ${session.session.id}.`))
      }}
      onDetach={() => {
        setState(terminalOnlyClosedState(`Detached SSH terminal: ${session.session.id}.`))
      }}
      onKill={() => {
        closeTerminalSession(session)
        setState(terminalOnlyClosedState(`Killed SSH terminal: ${session.session.id}.`))
      }}
      onMessage={(message) => {
        updateReadyMessage(setState, message)
      }}
      session={session}
    />
  </div>
)

const TerminalOnlyClosed = ({ message }: { readonly message: string }): JSX.Element => (
  <Box alignItems="center" height="100%" justifyContent="center" padding={2} width="100%">
    <Box border={true} borderColor="#3a4652" borderStyle="rounded" flexDirection="column" padding={2}>
      <Text bold={true} fg="#f5fbff">SSH terminal</Text>
      <Text fg="#f6d27b">{message}</Text>
    </Box>
  </Box>
)

const TerminalOnlyLoading = ({ sessionId }: { readonly sessionId: string }): JSX.Element => (
  <Box alignItems="center" height="100%" justifyContent="center" padding={2} width="100%">
    <Box border={true} borderColor="#3a4652" borderStyle="rounded" flexDirection="column" padding={2}>
      <Text bold={true} fg="#f5fbff">SSH terminal</Text>
      <Text fg="#7fdfff">session: {sessionId}</Text>
      <Text fg="#a8c0dc">Attaching terminal...</Text>
    </Box>
  </Box>
)

const TerminalOnlyError = (
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

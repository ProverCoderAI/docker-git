import { Effect, Either } from "effect"
import { useCallback, useEffect, useRef, useState } from "react"

import { setProjectActiveTerminalSession } from "./api.js"
import { readStoredTerminalWorkspace, writeStoredTerminalWorkspace } from "./app-ready-terminal-storage.js"
import {
  activeTerminalSession,
  addTerminalSessionState,
  deactivateTerminalWorkspaceState,
  removeTerminalSessionState,
  selectTerminalSessionState,
  type TerminalWorkspaceState
} from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"

export type TerminalWorkspaceReadyState = {
  readonly activeTerminalSession: ActiveTerminalSession | null
  readonly activeTerminalSessionId: string | null
  readonly addTerminalSession: (session: ActiveTerminalSession) => void
  readonly closeTerminalSession: (sessionId: string) => void
  readonly deactivateTerminalWorkspace: () => void
  readonly selectTerminalSession: (sessionId: string) => void
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

type PersistedSelectionRef = {
  current: string | null
}

export const projectActiveTerminalSelection = (
  active: ActiveTerminalSession | null
): { readonly projectKey: string; readonly sessionId: string } | null =>
  active?.browserProjectKey === undefined || active.pendingConnection !== undefined
    ? null
    : { projectKey: active.browserProjectKey, sessionId: active.session.id }

const projectActiveTerminalSelectionKey = (
  selection: { readonly projectKey: string; readonly sessionId: string }
): string => `${selection.projectKey}\0${selection.sessionId}`

const clearFailedPersistedSelection = (
  persistedSelectionRef: PersistedSelectionRef,
  selectionKey: string
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (persistedSelectionRef.current === selectionKey) {
      persistedSelectionRef.current = null
    }
  })

const persistProjectActiveTerminalSelection = (
  state: TerminalWorkspaceState,
  persistedSelectionRef: PersistedSelectionRef
): void => {
  const active = projectActiveTerminalSelection(activeTerminalSession(state))
  if (active === null) {
    return
  }
  const selectionKey = projectActiveTerminalSelectionKey(active)
  if (persistedSelectionRef.current === selectionKey) {
    return
  }
  persistedSelectionRef.current = selectionKey
  void Effect.runPromise(
    setProjectActiveTerminalSession(active.projectKey, active.sessionId).pipe(
      Effect.either,
      Effect.flatMap((result) =>
        Either.match(result, {
          onLeft: () => clearFailedPersistedSelection(persistedSelectionRef, selectionKey),
          onRight: () => Effect.void
        })
      )
    )
  )
}

export const useTerminalWorkspaceState = (): TerminalWorkspaceReadyState => {
  const [terminalWorkspace, setTerminalWorkspace] = useState<TerminalWorkspaceState>(readStoredTerminalWorkspace)
  const persistedSelectionRef = useRef<string | null>(null)
  const addTerminalSession = useCallback((session: ActiveTerminalSession) => {
    setTerminalWorkspace((state) => addTerminalSessionState(state, session))
  }, [])
  const closeTerminalSession = useCallback((sessionId: string) => {
    setTerminalWorkspace((state) => removeTerminalSessionState(state, sessionId, { activateNeighbor: false }))
  }, [])
  const deactivateTerminalWorkspace = useCallback(() => {
    setTerminalWorkspace((state) => deactivateTerminalWorkspaceState(state))
  }, [])
  const selectTerminalSession = useCallback((sessionId: string) => {
    setTerminalWorkspace((state) => selectTerminalSessionState(state, sessionId))
  }, [])

  useEffect(() => {
    writeStoredTerminalWorkspace(terminalWorkspace)
  }, [terminalWorkspace])

  useEffect(() => {
    persistProjectActiveTerminalSelection(terminalWorkspace, persistedSelectionRef)
  }, [terminalWorkspace])

  return {
    activeTerminalSession: activeTerminalSession(terminalWorkspace),
    activeTerminalSessionId: terminalWorkspace.activeTerminalSessionId,
    addTerminalSession,
    closeTerminalSession,
    deactivateTerminalWorkspace,
    selectTerminalSession,
    terminalSessions: terminalWorkspace.terminalSessions
  }
}

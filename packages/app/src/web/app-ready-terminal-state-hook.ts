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

type ProjectActiveTerminalSelection = {
  readonly projectKey: string
  readonly sessionId: string
}

type ProjectActiveTerminalPersistenceRequest = ProjectActiveTerminalSelection & {
  readonly selectionKey: string
}

type ProjectActiveTerminalPersistenceState = {
  readonly inFlightRequest: ProjectActiveTerminalPersistenceRequest | null
  readonly latestRequest: ProjectActiveTerminalPersistenceRequest | null
  readonly persistedSelectionKey: string | null
}

type ProjectActiveTerminalPersistenceRef = {
  current: ProjectActiveTerminalPersistenceState
}

type SetProjectActiveTerminalSessionEffect = ReturnType<typeof setProjectActiveTerminalSession>
type ProjectActiveTerminalPersistResult = Either.Either<
  Effect.Effect.Success<SetProjectActiveTerminalSessionEffect>,
  Effect.Effect.Error<SetProjectActiveTerminalSessionEffect>
>

/**
 * Returns the project-bound active terminal selection when it is ready to persist.
 *
 * @pure true
 * @effect none; CORE selector reads immutable session state only.
 * @invariant pending or non-project sessions never produce a persistence request.
 * @precondition active is either null or an ActiveTerminalSession snapshot.
 * @postcondition result is null or contains the exact browserProjectKey and session.id from active.
 * @complexity O(1) time / O(1) space.
 */
export const projectActiveTerminalSelection = (
  active: ActiveTerminalSession | null
): ProjectActiveTerminalSelection | null =>
  active?.browserProjectKey === undefined || active.pendingConnection !== undefined
    ? null
    : { projectKey: active.browserProjectKey, sessionId: active.session.id }

const projectActiveTerminalSelectionKey = (
  selection: ProjectActiveTerminalSelection
): string => `${selection.projectKey}\0${selection.sessionId}`

const emptyProjectActiveTerminalPersistenceState = (): ProjectActiveTerminalPersistenceState => ({
  inFlightRequest: null,
  latestRequest: null,
  persistedSelectionKey: null
})

/**
 * Creates a mutable React-compatible ref for active terminal persistence state.
 *
 * @pure true
 * @effect none; factory allocates only local in-memory state.
 * @invariant new refs start with no in-flight, latest, or persisted selection.
 * @precondition no external state is required.
 * @postcondition returned ref.current equals the empty persistence state.
 * @complexity O(1) time / O(1) space.
 */
export const createProjectActiveTerminalPersistenceRef = (): ProjectActiveTerminalPersistenceRef => ({
  current: emptyProjectActiveTerminalPersistenceState()
})

const projectActiveTerminalPersistenceRequest = (
  selection: ProjectActiveTerminalSelection
): ProjectActiveTerminalPersistenceRequest => ({
  ...selection,
  selectionKey: projectActiveTerminalSelectionKey(selection)
})

const completeProjectActiveTerminalPersistRequest = (
  persistedSelectionRef: ProjectActiveTerminalPersistenceRef,
  request: ProjectActiveTerminalPersistenceRequest,
  result: ProjectActiveTerminalPersistResult
): Effect.Effect<void> =>
  Effect.sync(() => {
    if (persistedSelectionRef.current.inFlightRequest?.selectionKey !== request.selectionKey) {
      return
    }
    const persistedSelectionKey = Either.match(result, {
      onLeft: () => persistedSelectionRef.current.persistedSelectionKey,
      onRight: () => request.selectionKey
    })
    persistedSelectionRef.current = {
      ...persistedSelectionRef.current,
      inFlightRequest: null,
      persistedSelectionKey
    }
    const latestRequest = persistedSelectionRef.current.latestRequest
    if (latestRequest !== null && latestRequest.selectionKey !== request.selectionKey) {
      runProjectActiveTerminalPersistRequest(persistedSelectionRef)
    }
  })

const runProjectActiveTerminalPersistRequest = (
  persistedSelectionRef: ProjectActiveTerminalPersistenceRef
): void => {
  const { inFlightRequest, latestRequest, persistedSelectionKey } = persistedSelectionRef.current
  if (
    inFlightRequest !== null ||
    latestRequest === null ||
    latestRequest.selectionKey === persistedSelectionKey
  ) {
    return
  }
  persistedSelectionRef.current = {
    ...persistedSelectionRef.current,
    inFlightRequest: latestRequest
  }
  void Effect.runPromise(
    setProjectActiveTerminalSession(latestRequest.projectKey, latestRequest.sessionId).pipe(
      Effect.either,
      Effect.flatMap((result) =>
        completeProjectActiveTerminalPersistRequest(persistedSelectionRef, latestRequest, result)
      )
    )
  )
}

/**
 * Queues and runs latest-wins persistence for the active project terminal selection.
 *
 * @pure false
 * @effect setProjectActiveTerminalSession via Effect.runPromise.
 * @invariant at most one backend persistence request is in flight per ref.
 * @precondition persistedSelectionRef was created by createProjectActiveTerminalPersistenceRef.
 * @postcondition ready project selections become latestRequest and are persisted without older completions winning.
 * @complexity O(1) time / O(1) space per invocation.
 */
export const persistProjectActiveTerminalSelection = (
  state: TerminalWorkspaceState,
  persistedSelectionRef: ProjectActiveTerminalPersistenceRef
): void => {
  const active = projectActiveTerminalSelection(activeTerminalSession(state))
  if (active === null) {
    return
  }
  const latestRequest = projectActiveTerminalPersistenceRequest(active)
  persistedSelectionRef.current = {
    ...persistedSelectionRef.current,
    latestRequest
  }
  runProjectActiveTerminalPersistRequest(persistedSelectionRef)
}

export const useTerminalWorkspaceState = (): TerminalWorkspaceReadyState => {
  const [terminalWorkspace, setTerminalWorkspace] = useState<TerminalWorkspaceState>(readStoredTerminalWorkspace)
  const persistedSelectionRef = useRef(emptyProjectActiveTerminalPersistenceState())
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

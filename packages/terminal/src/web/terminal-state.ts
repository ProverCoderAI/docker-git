import type { ActiveTerminalSession } from "./terminal.js"

export type TerminalWorkspaceState = {
  readonly activeTerminalSessionId: string | null
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

type RemoveTerminalSessionOptions = {
  readonly activateNeighbor?: boolean
}

export const emptyTerminalWorkspaceState: TerminalWorkspaceState = {
  activeTerminalSessionId: null,
  terminalSessions: []
}

export const terminalSessionId = (session: ActiveTerminalSession): string => session.session.id

const isProjectTerminalSession = (session: ActiveTerminalSession, projectId: string): boolean =>
  session.browserProjectId === projectId

export const terminalSessionsForProject = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  projectId: string
): ReadonlyArray<ActiveTerminalSession> => sessions.filter((session) => isProjectTerminalSession(session, projectId))

const latestProjectTerminalSession = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  projectId: string
): ActiveTerminalSession | null => {
  let latest: ActiveTerminalSession | null = null
  for (const session of sessions) {
    if (isProjectTerminalSession(session, projectId)) {
      latest = session
    }
  }
  return latest
}

export const reusableProjectTerminalSessionId = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  activeTerminalSessionId: string | null,
  projectId: string
): string | null => {
  const active = sessions.find((session) =>
    terminalSessionId(session) === activeTerminalSessionId && isProjectTerminalSession(session, projectId)
  )
  const reusable = active ?? latestProjectTerminalSession(sessions, projectId)
  return reusable === null ? null : terminalSessionId(reusable)
}

const hasSessionId = (sessions: ReadonlyArray<ActiveTerminalSession>, sessionId: string | null): boolean =>
  sessionId !== null && sessions.some((session) => terminalSessionId(session) === sessionId)

const normalizeTerminalWorkspaceState = (state: TerminalWorkspaceState): TerminalWorkspaceState =>
  state.activeTerminalSessionId === null || hasSessionId(state.terminalSessions, state.activeTerminalSessionId)
    ? state
    : {
      ...state,
      activeTerminalSessionId: null
    }

export const activeTerminalSession = (state: TerminalWorkspaceState): ActiveTerminalSession | null => {
  const normalized = normalizeTerminalWorkspaceState(state)
  return normalized.terminalSessions.find((session) =>
    terminalSessionId(session) === normalized.activeTerminalSessionId
  ) ?? null
}

export const activeTerminalSessionForProject = (
  state: TerminalWorkspaceState,
  projectId: string
): ActiveTerminalSession | null => {
  const active = activeTerminalSession(state)
  return active !== null && isProjectTerminalSession(active, projectId) ? active : null
}

export const deactivateTerminalWorkspaceState = (state: TerminalWorkspaceState): TerminalWorkspaceState => ({
  activeTerminalSessionId: null,
  terminalSessions: state.terminalSessions
})

export const visibleTerminalWorkspaceState = (state: TerminalWorkspaceState): TerminalWorkspaceState => {
  const active = activeTerminalSession(state)
  if (active === null) {
    return emptyTerminalWorkspaceState
  }

  const activeSessionId = terminalSessionId(active)
  if (active.browserProjectId === undefined) {
    return {
      activeTerminalSessionId: activeSessionId,
      terminalSessions: [active]
    }
  }

  return {
    activeTerminalSessionId: activeSessionId,
    terminalSessions: terminalSessionsForProject(state.terminalSessions, active.browserProjectId)
  }
}

export const addTerminalSessionState = (
  state: TerminalWorkspaceState,
  session: ActiveTerminalSession
): TerminalWorkspaceState => {
  const sessionId = terminalSessionId(session)
  const existingIndex = state.terminalSessions.findIndex((candidate) => terminalSessionId(candidate) === sessionId)
  const terminalSessions = existingIndex === -1
    ? [...state.terminalSessions, session]
    : state.terminalSessions.map((candidate, index) => index === existingIndex ? session : candidate)
  return {
    activeTerminalSessionId: sessionId,
    terminalSessions
  }
}

export const selectTerminalSessionState = (
  state: TerminalWorkspaceState,
  sessionId: string
): TerminalWorkspaceState =>
  hasSessionId(state.terminalSessions, sessionId)
    ? { ...state, activeTerminalSessionId: sessionId }
    : normalizeTerminalWorkspaceState(state)

export const removeTerminalSessionState = (
  state: TerminalWorkspaceState,
  sessionId: string,
  options: RemoveTerminalSessionOptions = {}
): TerminalWorkspaceState => {
  const removedIndex = state.terminalSessions.findIndex((session) => terminalSessionId(session) === sessionId)
  if (removedIndex === -1) {
    return normalizeTerminalWorkspaceState(state)
  }

  const terminalSessions = state.terminalSessions.filter((session) => terminalSessionId(session) !== sessionId)
  if (state.activeTerminalSessionId !== sessionId) {
    return normalizeTerminalWorkspaceState({
      ...state,
      terminalSessions
    })
  }

  if (options.activateNeighbor === false) {
    return {
      activeTerminalSessionId: null,
      terminalSessions
    }
  }

  const nextActiveSession = terminalSessions[removedIndex] ?? terminalSessions[removedIndex - 1]
  return {
    activeTerminalSessionId: nextActiveSession === undefined ? null : terminalSessionId(nextActiveSession),
    terminalSessions
  }
}

export const hasTerminalSessions = (state: TerminalWorkspaceState): boolean => state.terminalSessions.length > 0

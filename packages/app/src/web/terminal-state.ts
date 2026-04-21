import type { ActiveTerminalSession } from "./terminal.js"

export type TerminalWorkspaceState = {
  readonly activeTerminalSessionId: string | null
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

export const emptyTerminalWorkspaceState: TerminalWorkspaceState = {
  activeTerminalSessionId: null,
  terminalSessions: []
}

export const terminalSessionId = (session: ActiveTerminalSession): string => session.session.id

const hasSessionId = (sessions: ReadonlyArray<ActiveTerminalSession>, sessionId: string | null): boolean =>
  sessionId !== null && sessions.some((session) => terminalSessionId(session) === sessionId)

const normalizeTerminalWorkspaceState = (state: TerminalWorkspaceState): TerminalWorkspaceState =>
  hasSessionId(state.terminalSessions, state.activeTerminalSessionId)
    ? state
    : {
      ...state,
      activeTerminalSessionId: state.terminalSessions[0] === undefined
        ? null
        : terminalSessionId(state.terminalSessions[0])
    }

export const activeTerminalSession = (state: TerminalWorkspaceState): ActiveTerminalSession | null => {
  const normalized = normalizeTerminalWorkspaceState(state)
  return normalized.terminalSessions.find((session) =>
    terminalSessionId(session) === normalized.activeTerminalSessionId
  ) ?? null
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
  sessionId: string
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

  const nextActiveSession = terminalSessions[removedIndex] ?? terminalSessions[removedIndex - 1]
  return {
    activeTerminalSessionId: nextActiveSession === undefined ? null : terminalSessionId(nextActiveSession),
    terminalSessions
  }
}

export const hasTerminalSessions = (state: TerminalWorkspaceState): boolean => state.terminalSessions.length > 0

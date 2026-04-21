import { useCallback, useState } from "react"

import {
  activeTerminalSession,
  addTerminalSessionState,
  emptyTerminalWorkspaceState,
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
  readonly selectTerminalSession: (sessionId: string) => void
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

export const useTerminalWorkspaceState = (): TerminalWorkspaceReadyState => {
  const [terminalWorkspace, setTerminalWorkspace] = useState<TerminalWorkspaceState>(emptyTerminalWorkspaceState)
  const addTerminalSession = useCallback((session: ActiveTerminalSession) => {
    setTerminalWorkspace((state) => addTerminalSessionState(state, session))
  }, [])
  const closeTerminalSession = useCallback((sessionId: string) => {
    setTerminalWorkspace((state) => removeTerminalSessionState(state, sessionId))
  }, [])
  const selectTerminalSession = useCallback((sessionId: string) => {
    setTerminalWorkspace((state) => selectTerminalSessionState(state, sessionId))
  }, [])

  return {
    activeTerminalSession: activeTerminalSession(terminalWorkspace),
    activeTerminalSessionId: terminalWorkspace.activeTerminalSessionId,
    addTerminalSession,
    closeTerminalSession,
    selectTerminalSession,
    terminalSessions: terminalWorkspace.terminalSessions
  }
}

import { describe, expect, it } from "vitest"

import {
  activeTerminalSession,
  addTerminalSessionState,
  emptyTerminalWorkspaceState,
  hasTerminalSessions,
  removeTerminalSessionState,
  selectTerminalSessionState
} from "../../src/web/terminal-state.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"

const makeSession = (id: string, name = id): ActiveTerminalSession => ({
  browserProjectId: `project-${id}`,
  browserProjectName: name,
  closePath: `/projects/project-${id}/terminal-sessions/${id}`,
  exitMessage: "ended",
  header: `SSH terminal: ${name}`,
  pendingDeleteMessage: "closed",
  readyMessage: "ready",
  session: {
    createdAt: "2026-04-21T00:00:00.000Z",
    id,
    projectId: `project-${id}`,
    sshCommand: `ssh dev@${id}`,
    status: "ready"
  },
  subtitle: `ssh dev@${id}`,
  websocketPath: `/projects/project-${id}/terminal-sessions/${id}/ws`
})

describe("terminal workspace state", () => {
  it("adds the first session as active", () => {
    const state = addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a"))

    expect(hasTerminalSessions(state)).toBe(true)
    expect(state.activeTerminalSessionId).toBe("a")
    expect(activeTerminalSession(state)?.session.id).toBe("a")
  })

  it("adds another session without removing the existing one", () => {
    const first = addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a"))
    const second = addTerminalSessionState(first, makeSession("b"))

    expect(second.terminalSessions.map((session) => session.session.id)).toEqual(["a", "b"])
    expect(second.activeTerminalSessionId).toBe("b")
  })

  it("selects an existing session only", () => {
    const state = addTerminalSessionState(
      addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a")),
      makeSession("b")
    )

    expect(selectTerminalSessionState(state, "a").activeTerminalSessionId).toBe("a")
    expect(selectTerminalSessionState(state, "missing").activeTerminalSessionId).toBe("b")
  })

  it("removes the active session and selects the right neighbor first", () => {
    const state = addTerminalSessionState(
      addTerminalSessionState(
        addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a")),
        makeSession("b")
      ),
      makeSession("c")
    )
    const activeMiddle = selectTerminalSessionState(state, "b")

    const next = removeTerminalSessionState(activeMiddle, "b")

    expect(next.terminalSessions.map((session) => session.session.id)).toEqual(["a", "c"])
    expect(next.activeTerminalSessionId).toBe("c")
  })

  it("keeps the active session when an inactive session is closed", () => {
    const state = addTerminalSessionState(
      addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a")),
      makeSession("b")
    )

    const next = removeTerminalSessionState(state, "a")

    expect(next.terminalSessions.map((session) => session.session.id)).toEqual(["b"])
    expect(next.activeTerminalSessionId).toBe("b")
  })
})

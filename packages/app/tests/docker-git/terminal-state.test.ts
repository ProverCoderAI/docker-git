import { describe, expect, it } from "vitest"

import {
  activeTerminalSession,
  activeTerminalSessionForProject,
  addTerminalSessionState,
  deactivateTerminalWorkspaceState,
  emptyTerminalWorkspaceState,
  hasTerminalSessions,
  removeTerminalSessionState,
  reusableProjectTerminalSessionId,
  selectTerminalSessionState,
  terminalSessionsForProject,
  visibleTerminalWorkspaceState
} from "../../src/web/terminal-state.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"

const makeSession = (id: string, name = id, projectId = `project-${id}`): ActiveTerminalSession => ({
  browserProjectId: projectId,
  browserProjectName: name,
  closePath: `/projects/${projectId}/terminal-sessions/${id}`,
  exitMessage: "ended",
  header: `SSH terminal: ${name}`,
  pendingDeleteMessage: "closed",
  readyMessage: "ready",
  session: {
    createdAt: "2026-04-21T00:00:00.000Z",
    id,
    projectId,
    sshCommand: `ssh dev@${id}`,
    status: "ready"
  },
  subtitle: `ssh dev@${id}`,
  websocketPath: `/projects/${projectId}/terminal-sessions/${id}/ws`
})

const makeAuthSession = (id: string): ActiveTerminalSession => ({
  closePath: `/auth/terminal-sessions/${id}`,
  exitMessage: "done",
  header: `auth ${id}`,
  pendingDeleteMessage: "closed",
  readyMessage: "ready",
  session: {
    createdAt: "2026-04-21T00:00:00.000Z",
    id,
    projectId: `auth-${id}`,
    sshCommand: `ssh auth@${id}`,
    status: "ready"
  },
  subtitle: `ssh auth@${id}`,
  websocketPath: `/auth/terminal-sessions/${id}/ws`
})

const makeSharedProjectState = (activeTerminalSessionId: string) => {
  const projectId = "project-shared"
  return {
    projectId,
    state: {
      activeTerminalSessionId,
      terminalSessions: [
        makeSession("a", "shared-a", projectId),
        makeSession("b", "other"),
        makeSession("c", "shared-c", projectId)
      ]
    }
  }
}

const makeTwoSessionState = () =>
  addTerminalSessionState(
    addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a")),
    makeSession("b")
  )

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

  it("removes the active session without activating a neighbor when requested", () => {
    const state = makeTwoSessionState()

    const next = removeTerminalSessionState(state, "b", { activateNeighbor: false })

    expect(next.terminalSessions.map((session) => session.session.id)).toEqual(["a"])
    expect(next.activeTerminalSessionId).toBeNull()
    expect(activeTerminalSession(next)).toBeNull()
  })

  it("keeps the active session when an inactive session is closed", () => {
    const state = makeTwoSessionState()

    const next = removeTerminalSessionState(state, "a")

    expect(next.terminalSessions.map((session) => session.session.id)).toEqual(["b"])
    expect(next.activeTerminalSessionId).toBe("b")
  })

  it("reuses the active project terminal before any other matching session", () => {
    const { projectId, state } = makeSharedProjectState("a")

    expect(reusableProjectTerminalSessionId(state.terminalSessions, state.activeTerminalSessionId, projectId))
      .toBe("a")
  })

  it("reuses the latest project terminal when the active session belongs to another project", () => {
    const { projectId, state } = makeSharedProjectState("b")

    expect(reusableProjectTerminalSessionId(state.terminalSessions, state.activeTerminalSessionId, projectId))
      .toBe("c")
  })

  it("does not reuse a terminal from another project", () => {
    const state = addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a"))

    expect(reusableProjectTerminalSessionId(state.terminalSessions, state.activeTerminalSessionId, "missing"))
      .toBeNull()
  })

  it("filters visible terminal tabs to the active SSH project", () => {
    const { state } = makeSharedProjectState("a")
    const visible = visibleTerminalWorkspaceState(state)

    expect(visible.activeTerminalSessionId).toBe("a")
    expect(visible.terminalSessions.map((session) => session.session.id)).toEqual(["a", "c"])
  })

  it("does not expose another project's active terminal as a project terminal", () => {
    const { projectId, state } = makeSharedProjectState("b")

    expect(terminalSessionsForProject(state.terminalSessions, projectId).map((session) => session.session.id))
      .toEqual(["a", "c"])
    expect(activeTerminalSessionForProject(state, projectId)).toBeNull()
  })

  it("shows only the active non-project terminal for non-SSH sessions", () => {
    const state = addTerminalSessionState(
      addTerminalSessionState(emptyTerminalWorkspaceState, makeSession("a")),
      makeAuthSession("auth")
    )
    const visible = visibleTerminalWorkspaceState(state)

    expect(visible.activeTerminalSessionId).toBe("auth")
    expect(visible.terminalSessions.map((session) => session.session.id)).toEqual(["auth"])
  })

  it("keeps stored sessions but disables restored active terminal focus", () => {
    const state = makeTwoSessionState()
    const next = deactivateTerminalWorkspaceState(state)

    expect(next.activeTerminalSessionId).toBeNull()
    expect(next.terminalSessions.map((session) => session.session.id)).toEqual(["a", "b"])
  })
})

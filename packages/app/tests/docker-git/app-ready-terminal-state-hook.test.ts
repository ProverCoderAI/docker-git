import { describe, expect, it } from "vitest"

import { projectActiveTerminalSelection } from "../../src/web/app-ready-terminal-state-hook.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"

const makeSession = (
  overrides: Partial<ActiveTerminalSession> = {}
): ActiveTerminalSession => ({
  browserProjectId: "project-1",
  browserProjectKey: "octocat/hello-world",
  browserProjectName: "octocat/hello-world",
  closePath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1",
  exitMessage: "done",
  header: "SSH terminal: octocat/hello-world",
  pendingDeleteMessage: "closed",
  readyMessage: "ready",
  session: {
    createdAt: "2026-04-15T00:00:00.000Z",
    id: "session-1",
    projectId: "project-1",
    sshCommand: "ssh dev@127.0.0.1",
    status: "ready"
  },
  subtitle: "ssh dev@127.0.0.1",
  websocketPath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1/ws",
  ...overrides
})

describe("app-ready terminal state hook", () => {
  it("persists active project terminal selection by project key and session id", () => {
    expect(projectActiveTerminalSelection(makeSession())).toEqual({
      projectKey: "octocat/hello-world",
      sessionId: "session-1"
    })
  })

  it("does not persist pending terminal selection before the API session exists", () => {
    expect(
      projectActiveTerminalSelection(makeSession({
        pendingConnection: {
          message: "Connecting",
          phase: "connecting"
        }
      }))
    ).toBeNull()
  })

  it("does not persist non-project terminal selection", () => {
    expect(projectActiveTerminalSelection(makeSession({ browserProjectKey: undefined }))).toBeNull()
  })
})

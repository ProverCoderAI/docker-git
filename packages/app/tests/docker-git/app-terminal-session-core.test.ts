import { describe, expect, it } from "vitest"

import type { ProjectTerminalSessionLookup } from "../../src/web/api.js"
import {
  buildTerminalOnlyActiveSession,
  readTerminalSessionRoute,
  resolveWebAppRoute
} from "../../src/web/app-terminal-session-core.js"

const lookup: ProjectTerminalSessionLookup = {
  projectDisplayName: "octocat/hello-world",
  projectKey: "octocat/hello-world",
  session: {
    createdAt: "2026-04-21T10:00:00.000Z",
    id: "session-1",
    projectId: "project-1",
    sshCommand: "ssh -p 22 dev@172.18.0.7",
    status: "ready"
  }
}

describe("terminal-only SSH route core", () => {
  it("routes direct SSH session URLs outside the dashboard", () => {
    expect(resolveWebAppRoute("/ssh/session/session-1")).toEqual({
      tag: "TerminalSession",
      sessionId: "session-1"
    })
    expect(resolveWebAppRoute("/ssh/session/session%2Fencoded")).toEqual({
      tag: "TerminalSession",
      sessionId: "session/encoded"
    })
  })

  it("keeps dashboard and project SSH links on the dashboard route", () => {
    expect(resolveWebAppRoute("/")).toEqual({ tag: "Dashboard" })
    expect(resolveWebAppRoute("/menu/select")).toEqual({ tag: "Dashboard" })
    expect(resolveWebAppRoute("/ssh/octocat/hello-world")).toEqual({ tag: "Dashboard" })
  })

  it("ignores empty SSH session routes", () => {
    expect(readTerminalSessionRoute("/ssh/session/")).toBeNull()
  })

  it("builds terminal-only sessions without dashboard refresh callbacks", () => {
    const session = buildTerminalOnlyActiveSession(lookup)

    expect(session).toMatchObject({
      browserProjectId: "project-1",
      browserProjectKey: "octocat/hello-world",
      browserProjectName: "octocat/hello-world",
      closePath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1",
      sessionPath: "/ssh/session/session-1",
      websocketPath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1/ws"
    })
    expect("onReady" in session).toBe(false)
    expect("onExit" in session).toBe(false)
  })
})

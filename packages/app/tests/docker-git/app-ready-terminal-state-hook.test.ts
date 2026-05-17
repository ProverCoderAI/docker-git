import * as fc from "fast-check"
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

const idSegmentArbitrary = fc.integer({ max: 1_000_000, min: 1 }).map((value) => `id-${value}`)
const projectKeyArbitrary = fc.tuple(idSegmentArbitrary, idSegmentArbitrary).map(([owner, repo]) => `${owner}/${repo}`)
const sessionIdArbitrary = fc.integer({ max: 1_000_000, min: 1 }).map((value) => `session-${value}`)

const makeSessionWithId = (
  sessionId: string,
  overrides: Partial<ActiveTerminalSession> = {}
): ActiveTerminalSession => {
  const base = makeSession()
  return makeSession({
    ...overrides,
    session: {
      ...base.session,
      id: sessionId
    }
  })
}

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

  it("preserves active project terminal selection invariants", () => {
    fc.assert(
      fc.property(projectKeyArbitrary, sessionIdArbitrary, (projectKey, sessionId) => {
        expect(projectActiveTerminalSelection(makeSessionWithId(sessionId, { browserProjectKey: projectKey })))
          .toEqual({ projectKey, sessionId })
      }),
      { numRuns: 50 }
    )
  })

  it("preserves pending terminal non-persistence invariants", () => {
    fc.assert(
      fc.property(
        projectKeyArbitrary,
        sessionIdArbitrary,
        fc.constantFrom("connecting", "error"),
        idSegmentArbitrary,
        (projectKey, sessionId, phase, message) => {
          expect(projectActiveTerminalSelection(makeSessionWithId(sessionId, {
            browserProjectKey: projectKey,
            pendingConnection: { message, phase }
          }))).toBeNull()
        }
      ),
      { numRuns: 50 }
    )
  })

  it("preserves non-project terminal non-persistence invariants", () => {
    fc.assert(
      fc.property(sessionIdArbitrary, (sessionId) => {
        expect(projectActiveTerminalSelection(makeSessionWithId(sessionId, { browserProjectKey: undefined })))
          .toBeNull()
      }),
      { numRuns: 50 }
    )
  })
})

import { it as effectIt } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
import { beforeEach, describe, expect, it, vi } from "vitest"

import {
  createProjectActiveTerminalPersistenceRef,
  persistProjectActiveTerminalSelection,
  projectActiveTerminalSelection
} from "../../src/web/app-ready-terminal-state-hook.js"
import type { TerminalWorkspaceState } from "../../src/web/terminal-state.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"

const apiMock = vi.hoisted(() => ({
  setProjectActiveTerminalSession: vi.fn()
}))

vi.mock("../../src/web/api.js", () => ({
  setProjectActiveTerminalSession: apiMock.setProjectActiveTerminalSession
}))

type PendingPersistCall = {
  readonly complete: () => void
  readonly projectKey: string
  readonly sessionId: string
}

const pendingPersistCalls: Array<PendingPersistCall> = []

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

const makeWorkspace = (session: ActiveTerminalSession): TerminalWorkspaceState => ({
  activeTerminalSessionId: session.session.id,
  terminalSessions: [session]
})

type ProjectActiveTerminalPersistenceRef = ReturnType<typeof createProjectActiveTerminalPersistenceRef>

const persistSessionSelection = (
  persistenceRef: ProjectActiveTerminalPersistenceRef,
  sessionId: string
): void => {
  persistProjectActiveTerminalSelection(makeWorkspace(makeSessionWithId(sessionId)), persistenceRef)
}

describe("app-ready terminal state hook", () => {
  beforeEach(() => {
    pendingPersistCalls.length = 0
    apiMock.setProjectActiveTerminalSession.mockReset()
    apiMock.setProjectActiveTerminalSession.mockImplementation((projectKey: string, sessionId: string) =>
      Effect.async<boolean>((resume) => {
        pendingPersistCalls.push({
          complete: () => {
            resume(Effect.succeed(true))
          },
          projectKey,
          sessionId
        })
      })
    )
  })

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

  effectIt.effect(
    "serializes active session persistence so latest wins and superseded selections are skipped",
    () =>
      Effect.gen(function*(_) {
        const persistenceRef = createProjectActiveTerminalPersistenceRef()

        persistSessionSelection(persistenceRef, "session-1")
        expect(apiMock.setProjectActiveTerminalSession).toHaveBeenCalledTimes(1)
        expect(apiMock.setProjectActiveTerminalSession).toHaveBeenLastCalledWith("octocat/hello-world", "session-1")

        persistSessionSelection(persistenceRef, "session-2")
        expect(apiMock.setProjectActiveTerminalSession).toHaveBeenCalledTimes(1)

        pendingPersistCalls[0]?.complete()
        yield* _(Effect.yieldNow())

        expect(apiMock.setProjectActiveTerminalSession).toHaveBeenCalledTimes(2)
        expect(apiMock.setProjectActiveTerminalSession).toHaveBeenLastCalledWith("octocat/hello-world", "session-2")

        pendingPersistCalls.length = 0
        apiMock.setProjectActiveTerminalSession.mockClear()
        const switchedBackPersistenceRef = createProjectActiveTerminalPersistenceRef()
        persistSessionSelection(switchedBackPersistenceRef, "session-1")
        persistSessionSelection(switchedBackPersistenceRef, "session-2")
        persistSessionSelection(switchedBackPersistenceRef, "session-1")

        pendingPersistCalls[0]?.complete()
        yield* _(Effect.yieldNow())

        expect(apiMock.setProjectActiveTerminalSession).toHaveBeenCalledTimes(1)
        expect(apiMock.setProjectActiveTerminalSession).toHaveBeenLastCalledWith("octocat/hello-world", "session-1")
      })
  )
})

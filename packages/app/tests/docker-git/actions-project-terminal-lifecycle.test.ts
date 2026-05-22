import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import { connectProjectById } from "../../src/web/actions-projects.js"
import type { loadProjectTerminalSession, startProjectTerminalSession } from "../../src/web/api.js"
import type { openProjectEventStream } from "../../src/web/project-events.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"
import { makeSelectedProjectContext, session, startTerminalAccepted } from "./actions-project-terminal-test-fixtures.js"
import { waitForAssertion } from "./browser-action-context-fixture.js"

const eventStreamCloseMock = vi.hoisted(() => vi.fn<() => void>())
const loadProjectTerminalSessionMock = vi.hoisted(() => vi.fn<typeof loadProjectTerminalSession>())
const openProjectEventStreamMock = vi.hoisted(() => vi.fn<typeof openProjectEventStream>())
const startProjectTerminalSessionMock = vi.hoisted(() => vi.fn<typeof startProjectTerminalSession>())

vi.mock("../../src/web/api.js", () => ({
  loadProjectTerminalSession: loadProjectTerminalSessionMock,
  startProjectTerminalSession: startProjectTerminalSessionMock
}))

vi.mock("../../src/web/project-events.js", () => ({
  openProjectEventStream: openProjectEventStreamMock
}))

const readFirstProjectEventHandler = () => {
  const handlers = openProjectEventStreamMock.mock.calls[0]?.[1]
  if (handlers?.onEvent === undefined) {
    throw new Error("missing event handlers")
  }
  return handlers.onEvent
}

const emitCreatedSession = (requestId: string): void => {
  readFirstProjectEventHandler()({
    at: "2026-04-21T10:00:01.000Z",
    payload: {
      phase: "created",
      requestId,
      sessionId: requestId
    },
    projectId: "project-1",
    seq: 8,
    type: "project.ssh.session"
  })
}

const emitStartupFailure = (requestId: string, message: string): void => {
  readFirstProjectEventHandler()({
    at: "2026-04-21T10:00:01.000Z",
    payload: {
      message,
      phase: "ssh.failed",
      requestId
    },
    projectId: "project-1",
    seq: 8,
    type: "project.deployment.status"
  })
}

type ProjectConnectContext = Parameters<typeof connectProjectById>[1]
type ProjectConnectLifecycle = NonNullable<Parameters<typeof connectProjectById>[3]>

const mockProjectStream = (): void => {
  openProjectEventStreamMock.mockImplementation(() => ({ close: eventStreamCloseMock }))
}

const createLifecycleSpies = (): Required<ProjectConnectLifecycle> => ({
  onFailure: vi.fn<(error: string) => void>(),
  onSuccess: vi.fn<(sessionId: string) => void>()
})

const connectProjectAndWaitForStream = (
  context: ProjectConnectContext,
  lifecycle: ProjectConnectLifecycle = {}
) =>
  Effect.gen(function*(_) {
    connectProjectById("project-1", context, "octocat/hello-world", lifecycle)

    yield* _(waitForAssertion(() => {
      expect(openProjectEventStreamMock).toHaveBeenCalledTimes(1)
    }))
  })

const connectAndAttachSession = (
  context: ProjectConnectContext,
  lifecycle: Required<ProjectConnectLifecycle>,
  pendingSessionId: string
) =>
  Effect.gen(function*(_) {
    yield* _(connectProjectAndWaitForStream(context, lifecycle))
    expect(lifecycle.onFailure).not.toHaveBeenCalled()
    expect(lifecycle.onSuccess).not.toHaveBeenCalled()
    emitCreatedSession(pendingSessionId)
    yield* _(waitForAssertion(() => {
      expect(lifecycle.onSuccess).toHaveBeenCalledWith(pendingSessionId)
    }))
  })

const prepareAcceptedConnect = (
  pendingSessionId: string,
  overrides: Parameters<typeof makeSelectedProjectContext>[0] = {}
) => {
  vi.stubGlobal("crypto", { randomUUID: () => pendingSessionId })
  startProjectTerminalSessionMock.mockImplementation(() => Effect.succeed(startTerminalAccepted(pendingSessionId)))
  mockProjectStream()
  return {
    lifecycle: createLifecycleSpies(),
    ...makeSelectedProjectContext(overrides)
  }
}

describe("project terminal connect lifecycle", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    eventStreamCloseMock.mockReset()
    loadProjectTerminalSessionMock.mockReset()
    openProjectEventStreamMock.mockReset()
    startProjectTerminalSessionMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.effect("adds a new SSH terminal session instead of replacing terminal state", () =>
    Effect.gen(function*(_) {
      const pendingSessionId = "00000000-0000-4000-8000-000000000002"
      const acceptedSession = { ...session, id: pendingSessionId }
      vi.stubGlobal("crypto", { randomUUID: () => pendingSessionId })
      startProjectTerminalSessionMock.mockImplementation(() => Effect.succeed(startTerminalAccepted(pendingSessionId)))
      loadProjectTerminalSessionMock.mockImplementation(() => Effect.succeed(acceptedSession))
      mockProjectStream()
      const addTerminalSession = vi.fn<(session: ActiveTerminalSession) => void>()
      const closeTerminalSession = vi.fn<(sessionId: string) => void>()
      const { context, reloadDashboard, setMessage } = makeSelectedProjectContext({
        addTerminalSession,
        closeTerminalSession
      })

      yield* _(connectProjectAndWaitForStream(context))
      emitCreatedSession(pendingSessionId)

      yield* _(waitForAssertion(() => {
        expect(addTerminalSession).toHaveBeenCalledTimes(2)
      }))

      const pendingSession = addTerminalSession.mock.calls[0]?.[0]
      if (pendingSession === undefined) {
        throw new Error("missing pending terminal session")
      }
      expect(startProjectTerminalSessionMock).toHaveBeenCalledWith("octocat/hello-world", pendingSessionId)
      expect(loadProjectTerminalSessionMock).toHaveBeenCalledWith("octocat/hello-world", pendingSessionId)
      expect(context.setSelectedProjectId).toHaveBeenCalledWith("project-1")
      expect(pendingSession).toMatchObject({
        browserProjectId: "project-1",
        browserProjectKey: "octocat/hello-world",
        browserProjectName: "octocat/hello-world",
        header: "SSH terminal: octocat/hello-world",
        pendingConnection: {
          message: "Starting project and waiting for SSH...",
          phase: "connecting"
        }
      })
      expect(closeTerminalSession).toHaveBeenCalledWith(pendingSession.session.id)
      expect(addTerminalSession).toHaveBeenLastCalledWith({
        browserProjectId: "project-1",
        browserProjectKey: "octocat/hello-world",
        browserProjectName: "octocat/hello-world",
        closePath: `/projects/by-key/octocat%2Fhello-world/terminal-sessions/${pendingSessionId}`,
        exitMessage: "SSH session ended.",
        header: "SSH terminal: octocat/hello-world",
        onExit: reloadDashboard,
        onReady: reloadDashboard,
        pendingDeleteMessage: "Terminal session was closed before attach: octocat/hello-world.",
        readyMessage: "SSH connected: octocat/hello-world.",
        session: acceptedSession,
        sessionPath: `/ssh/octocat/hello-world?t=${pendingSessionId.slice(0, 8)}`,
        subtitle: "ssh -p 22 dev@172.18.0.7",
        websocketPath: `/projects/by-key/octocat%2Fhello-world/terminal-sessions/${pendingSessionId}/ws`
      })
      expect(eventStreamCloseMock).toHaveBeenCalledTimes(1)
      expect(setMessage).toHaveBeenLastCalledWith(
        "Project is ready. SSH terminal is connecting for octocat/hello-world."
      )
    }))

  it.effect("starts SSH terminal creation from getRandomValues when randomUUID is unavailable", () =>
    Effect.gen(function*(_) {
      vi.stubGlobal("crypto", {
        getRandomValues: (values: Uint8Array): Uint8Array => {
          values.set([0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE])
          return values
        }
      })
      startProjectTerminalSessionMock.mockImplementation((_projectKey, requestId: string) =>
        Effect.succeed(startTerminalAccepted(requestId))
      )
      mockProjectStream()
      const addTerminalSession = vi.fn<(session: ActiveTerminalSession) => void>()
      const { context } = makeSelectedProjectContext({
        addTerminalSession
      })

      yield* _(connectProjectAndWaitForStream(context))
      expect(startProjectTerminalSessionMock).toHaveBeenCalledTimes(1)
      const requestId = startProjectTerminalSessionMock.mock.calls[0]?.[1]
      expect(requestId).toBe("10325476-98ba-4cfe-8000-000000000000")
      expect(addTerminalSession).toHaveBeenCalledTimes(1)
      expect(openProjectEventStreamMock).toHaveBeenCalledTimes(1)
    }))

  it.effect("reports success only after the created session attaches", () =>
    Effect.gen(function*(_) {
      const pendingSessionId = "00000000-0000-4000-8000-000000000003"
      loadProjectTerminalSessionMock.mockImplementation(() => Effect.succeed({ ...session, id: pendingSessionId }))
      const { context, lifecycle } = prepareAcceptedConnect(pendingSessionId)

      yield* _(connectAndAttachSession(context, lifecycle, pendingSessionId))
      expect(lifecycle.onFailure).not.toHaveBeenCalled()
    }))

  it.effect("ignores late failure events after the session already attached", () =>
    Effect.gen(function*(_) {
      const pendingSessionId = "00000000-0000-4000-8000-000000000006"
      loadProjectTerminalSessionMock.mockImplementation(() => Effect.succeed({ ...session, id: pendingSessionId }))
      const addTerminalSession = vi.fn<(session: ActiveTerminalSession) => void>()
      const { context, lifecycle } = prepareAcceptedConnect(pendingSessionId, { addTerminalSession })

      yield* _(connectAndAttachSession(context, lifecycle, pendingSessionId))
      emitStartupFailure(pendingSessionId, "Late backend failure.")

      expect(lifecycle.onFailure).not.toHaveBeenCalled()
      expect(addTerminalSession).toHaveBeenCalledTimes(2)
    }))

  it.effect("reports failure when startup fails", () =>
    Effect.gen(function*(_) {
      startProjectTerminalSessionMock.mockImplementation(() => Effect.fail("SSH session startup failed."))
      const lifecycle = createLifecycleSpies()
      const { context } = makeSelectedProjectContext({})

      connectProjectById("project-1", context, "octocat/hello-world", lifecycle)

      yield* _(waitForAssertion(() => {
        expect(lifecycle.onFailure).toHaveBeenCalledWith("SSH session startup failed.")
      }))
      expect(lifecycle.onSuccess).not.toHaveBeenCalled()
    }))

  it.effect("reports failure when the created session cannot attach", () =>
    Effect.gen(function*(_) {
      const pendingSessionId = "00000000-0000-4000-8000-000000000004"
      loadProjectTerminalSessionMock.mockImplementation(() => Effect.fail("SSH session attach failed."))
      const { context, lifecycle } = prepareAcceptedConnect(pendingSessionId)

      yield* _(connectProjectAndWaitForStream(context, lifecycle))
      emitCreatedSession(pendingSessionId)

      yield* _(waitForAssertion(() => {
        expect(lifecycle.onFailure).toHaveBeenCalledWith("SSH session attach failed.")
      }))
      expect(lifecycle.onSuccess).not.toHaveBeenCalled()
      expect(eventStreamCloseMock).toHaveBeenCalled()
    }))

  it.effect("reports failure from backend startup events", () =>
    Effect.gen(function*(_) {
      const pendingSessionId = "00000000-0000-4000-8000-000000000005"
      const { context, lifecycle } = prepareAcceptedConnect(pendingSessionId)

      yield* _(connectProjectAndWaitForStream(context, lifecycle))
      emitStartupFailure(pendingSessionId, "Backend SSH startup failed.")

      expect(lifecycle.onFailure).toHaveBeenCalledWith("Backend SSH startup failed.")
      expect(lifecycle.onSuccess).not.toHaveBeenCalled()
      expect(loadProjectTerminalSessionMock).not.toHaveBeenCalled()
      expect(eventStreamCloseMock).toHaveBeenCalledTimes(1)
    }))
})

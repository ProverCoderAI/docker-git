import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import { applyProjectById, connectProjectById, runApplyAllProjects } from "../../src/web/actions-projects.js"
import type { BrowserActionContext } from "../../src/web/actions-shared.js"
import type {
  applyAllProjects,
  applyProject,
  loadProjectTerminalSession,
  ProjectDetails,
  startProjectTerminalSession,
  StartProjectTerminalSessionAccepted,
  TerminalSession
} from "../../src/web/api.js"
import type { openProjectEventStream } from "../../src/web/project-events.js"
import type { ActiveTerminalSession } from "../../src/web/terminal.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const applyAllProjectsMock = vi.hoisted(() => vi.fn<typeof applyAllProjects>())
const applyProjectMock = vi.hoisted(() => vi.fn<typeof applyProject>())
const eventStreamCloseMock = vi.hoisted(() => vi.fn<() => void>())
const loadProjectTerminalSessionMock = vi.hoisted(() => vi.fn<typeof loadProjectTerminalSession>())
const openProjectEventStreamMock = vi.hoisted(() => vi.fn<typeof openProjectEventStream>())
const startProjectTerminalSessionMock = vi.hoisted(() => vi.fn<typeof startProjectTerminalSession>())

vi.mock("../../src/web/api.js", () => ({
  applyAllProjects: applyAllProjectsMock,
  applyProject: applyProjectMock,
  deleteProject: vi.fn(),
  downAllProjects: vi.fn(),
  downProject: vi.fn(),
  loadProjectDetails: vi.fn(),
  loadProjectLogs: vi.fn(),
  loadProjectPs: vi.fn(),
  loadProjectTerminalSession: loadProjectTerminalSessionMock,
  startProjectTerminalSession: startProjectTerminalSessionMock
}))

vi.mock("../../src/web/actions-browser.js", () => ({
  openSelectedProjectBrowser: vi.fn()
}))

vi.mock("../../src/web/actions-databases.js", () => ({
  openSelectedProjectDatabaseEditor: vi.fn()
}))

vi.mock("../../src/web/actions-output.js", () => ({
  appendOutputLine: vi.fn(),
  appendOutputLineHandler: vi.fn(() => vi.fn()),
  notifyProjectEventRateLimit: vi.fn()
}))

vi.mock("../../src/web/actions-port-forwards.js", () => ({
  openSelectedProjectPort: vi.fn()
}))

vi.mock("../../src/web/project-events.js", () => ({
  openProjectEventStream: openProjectEventStreamMock
}))

const project: ProjectDetails = {
  authorizedKeysExists: true,
  authorizedKeysPath: "/home/dev/.docker-git/project/authorized_keys",
  clonedOnHostname: "host",
  codexAuthPath: "/home/dev/.docker-git/.orch/auth/codex",
  codexHome: "/home/dev/.docker-git/.orch/codex",
  containerName: "docker-git-project-1",
  displayName: "octocat/hello-world",
  envGlobalPath: "/home/dev/.docker-git/.orch/env/global.env",
  envProjectPath: "/home/dev/.docker-git/project/.orch/env/project.env",
  gpu: "none",
  id: "project-1",
  projectDir: "/home/dev/.docker-git/octocat/hello-world",
  projectKey: "octocat/hello-world",
  repoRef: "main",
  repoUrl: "https://github.com/octocat/Hello-World.git",
  serviceName: "app",
  sshCommand: "ssh -p 22 dev@172.18.0.7",
  sshPort: 22,
  sshSessions: 1,
  sshUser: "dev",
  startedAtEpochMs: 1_776_775_000_000,
  startedAtIso: "2026-04-21T10:00:00.000Z",
  status: "running",
  statusLabel: "Up",
  targetDir: "/home/dev/project"
}

const session: TerminalSession = {
  createdAt: "2026-04-21T10:00:00.000Z",
  id: "session-1",
  projectId: "project-1",
  sshCommand: "ssh -p 22 dev@172.18.0.7",
  status: "ready"
}

const startTerminalAccepted = (requestId: string): StartProjectTerminalSessionAccepted => ({
  accepted: true,
  cursor: 7,
  projectId: "project-1",
  requestId
})

const makeSelectedProjectContext = (overrides: Partial<BrowserActionContext>) =>
  makeBrowserActionContext({
    ...overrides,
    selectedProjectId: "project-1",
    selectedProjectKey: "octocat/hello-world"
  })

const connectProjectAndWaitForStream = (context: BrowserActionContext) =>
  Effect.gen(function*(_) {
    connectProjectById("project-1", context, "octocat/hello-world")

    yield* _(waitForAssertion(() => {
      expect(openProjectEventStreamMock).toHaveBeenCalledTimes(1)
    }))
  })

const readFirstProjectEventHandler = () => {
  const handlers = openProjectEventStreamMock.mock.calls[0]?.[1]
  if (handlers?.onEvent === undefined) {
    throw new Error("missing event handlers")
  }
  return handlers.onEvent
}

describe("web project actions", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    applyAllProjectsMock.mockReset()
    applyProjectMock.mockReset()
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
      vi.stubGlobal("crypto", { randomUUID: () => "pending-session-id" })
      startProjectTerminalSessionMock.mockImplementation(() =>
        Effect.succeed(startTerminalAccepted("pending-session-id"))
      )
      loadProjectTerminalSessionMock.mockImplementation(() => Effect.succeed(session))
      openProjectEventStreamMock.mockImplementation(() => ({ close: eventStreamCloseMock }))
      const addTerminalSession = vi.fn<(session: ActiveTerminalSession) => void>()
      const closeTerminalSession = vi.fn<(sessionId: string) => void>()
      const { context, reloadDashboard, setMessage } = makeSelectedProjectContext({
        addTerminalSession,
        closeTerminalSession
      })

      yield* _(connectProjectAndWaitForStream(context))
      readFirstProjectEventHandler()({
        at: "2026-04-21T10:00:01.000Z",
        payload: {
          phase: "created",
          requestId: "pending-session-id",
          sessionId: "session-1"
        },
        projectId: "project-1",
        seq: 8,
        type: "project.ssh.session"
      })

      yield* _(waitForAssertion(() => {
        expect(addTerminalSession).toHaveBeenCalledTimes(2)
      }))

      const pendingSession = addTerminalSession.mock.calls[0]?.[0]
      if (pendingSession === undefined) {
        throw new Error("missing pending terminal session")
      }
      expect(startProjectTerminalSessionMock).toHaveBeenCalledWith("octocat/hello-world", "pending-session-id")
      expect(loadProjectTerminalSessionMock).toHaveBeenCalledWith("octocat/hello-world", "session-1")
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
        closePath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1",
        exitMessage: "SSH session ended.",
        header: "SSH terminal: octocat/hello-world",
        onExit: reloadDashboard,
        onReady: reloadDashboard,
        pendingDeleteMessage: "Terminal session was closed before attach: octocat/hello-world.",
        readyMessage: "SSH connected: octocat/hello-world.",
        session,
        sessionPath: "/ssh/session/session-1",
        subtitle: "ssh -p 22 dev@172.18.0.7",
        websocketPath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1/ws"
      })
      expect(eventStreamCloseMock).toHaveBeenCalledTimes(1)
      expect(setMessage).toHaveBeenLastCalledWith(
        "Project is ready. SSH terminal is connecting for octocat/hello-world."
      )
    }))

  it.effect("starts SSH terminal creation from getRandomValues when randomUUID is unavailable", () =>
    Effect.gen(function*(_) {
      const dateNowMock = vi.spyOn(Date, "now").mockReturnValue(0x1_9A_11_7B_D6_1F)
      vi.stubGlobal("crypto", {
        getRandomValues: (values: Uint8Array): Uint8Array => {
          values.set([0x10, 0x32, 0x54, 0x76, 0x98, 0xBA, 0xDC, 0xFE])
          return values
        }
      })
      startProjectTerminalSessionMock.mockImplementation((_projectKey, requestId: string) =>
        Effect.succeed(startTerminalAccepted(requestId))
      )
      openProjectEventStreamMock.mockImplementation(() => ({ close: eventStreamCloseMock }))
      const addTerminalSession = vi.fn<(session: ActiveTerminalSession) => void>()
      const { context } = makeSelectedProjectContext({
        addTerminalSession
      })

      yield* _(connectProjectAndWaitForStream(context))
      expect(startProjectTerminalSessionMock).toHaveBeenCalledTimes(1)
      const requestId = startProjectTerminalSessionMock.mock.calls[0]?.[1]
      expect(requestId).toBe("pending-19a117bd61f-1032547698badcfe")
      expect(addTerminalSession).toHaveBeenCalledTimes(1)
      expect(openProjectEventStreamMock).toHaveBeenCalledTimes(1)
      dateNowMock.mockRestore()
    }))

  it.effect("applies a selected project through the project apply endpoint", () =>
    Effect.gen(function*(_) {
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal("confirm", confirmMock)
      applyProjectMock.mockImplementation(() => Effect.succeed(project))
      const { context, reloadDashboard, setMessage } = makeBrowserActionContext({
        selectedProjectId: "project-1",
        selectedProjectName: "octocat/hello-world"
      })

      applyProjectById("project-1", context)

      yield* _(waitForAssertion(() => {
        expect(applyProjectMock).toHaveBeenCalledWith("project-1")
      }))

      expect(confirmMock).toHaveBeenCalledWith(
        "Apply docker-git config to octocat/hello-world? "
          + "This restarts the container and ends active SSH sessions and in-container browsers."
      )
      expect(context.setSelectedProjectId).toHaveBeenCalledWith("project-1")
      expect(context.setSelectedProject).toHaveBeenCalledWith(project)
      expect(reloadDashboard).toHaveBeenCalledTimes(1)
      expect(setMessage).toHaveBeenLastCalledWith("Applied octocat/hello-world.")
    }))

  it("does not apply a project when the user declines confirmation", () => {
    const confirmMock = vi.fn(() => false)
    vi.stubGlobal("confirm", confirmMock)
    applyProjectMock.mockImplementation(() => Effect.succeed(project))
    const { context, reloadDashboard } = makeBrowserActionContext({
      selectedProjectId: "project-1",
      selectedProjectName: "octocat/hello-world"
    })

    applyProjectById("project-1", context)

    expect(confirmMock).toHaveBeenCalledWith(
      "Apply docker-git config to octocat/hello-world? "
        + "This restarts the container and ends active SSH sessions and in-container browsers."
    )
    expect(applyProjectMock).not.toHaveBeenCalled()
    expect(context.setSelectedProjectId).not.toHaveBeenCalled()
    expect(reloadDashboard).not.toHaveBeenCalled()
  })

  it.effect("confirms and applies all projects", () =>
    Effect.gen(function*(_) {
      const confirmMock = vi.fn(() => true)
      vi.stubGlobal("confirm", confirmMock)
      applyAllProjectsMock.mockImplementation(() => Effect.void)
      const { context, reloadDashboard, setMessage } = makeBrowserActionContext()

      runApplyAllProjects(context)

      yield* _(waitForAssertion(() => {
        expect(applyAllProjectsMock).toHaveBeenCalledWith(false)
      }))

      expect(reloadDashboard).toHaveBeenCalledTimes(1)
      expect(setMessage).toHaveBeenLastCalledWith("Applied docker-git config to all projects.")
    }))
})

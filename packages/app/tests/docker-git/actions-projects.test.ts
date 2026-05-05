import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import { applyProjectById, connectProjectById, runApplyAllProjects } from "../../src/web/actions-projects.js"
import type { ProjectDetails, TerminalSession } from "../../src/web/api.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"

const applyAllProjectsMock = vi.hoisted(() => vi.fn())
const applyProjectMock = vi.hoisted(() => vi.fn())
const createProjectTerminalSessionMock = vi.hoisted(() => vi.fn())
const eventStreamCloseMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  applyAllProjects: applyAllProjectsMock,
  applyProject: applyProjectMock,
  createProjectTerminalSession: createProjectTerminalSessionMock,
  deleteProject: vi.fn(),
  downAllProjects: vi.fn(),
  downProject: vi.fn(),
  loadProjectDetails: vi.fn(),
  loadProjectLogs: vi.fn(),
  loadProjectPs: vi.fn()
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
  openProjectEventStream: vi.fn(() => ({ close: eventStreamCloseMock }))
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

describe("web project actions", () => {
  beforeEach(() => {
    applyAllProjectsMock.mockReset()
    applyProjectMock.mockReset()
    createProjectTerminalSessionMock.mockReset()
    eventStreamCloseMock.mockReset()
    vi.unstubAllGlobals()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect("adds a new SSH terminal session instead of replacing terminal state", () =>
    Effect.gen(function*(_) {
      createProjectTerminalSessionMock.mockImplementation(() => Effect.succeed({ project, session }))
      const addTerminalSession = vi.fn()
      const { context, reloadDashboard, setMessage } = makeBrowserActionContext({
        addTerminalSession,
        selectedProjectId: "project-1",
        selectedProjectKey: "octocat/hello-world"
      })

      connectProjectById("project-1", context, "octocat/hello-world")

      yield* _(waitForAssertion(() => {
        expect(addTerminalSession).toHaveBeenCalledTimes(1)
      }))

      expect(context.setSelectedProjectId).toHaveBeenCalledWith("project-1")
      expect(context.setSelectedProject).toHaveBeenCalledWith(project)
      expect(addTerminalSession).toHaveBeenCalledWith({
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

  it.effect("applies a selected project through the project apply endpoint", () =>
    Effect.gen(function*(_) {
      applyProjectMock.mockImplementation(() => Effect.succeed(project))
      const { context, reloadDashboard, setMessage } = makeBrowserActionContext()

      applyProjectById("project-1", context)

      yield* _(waitForAssertion(() => {
        expect(applyProjectMock).toHaveBeenCalledWith("project-1")
      }))

      expect(context.setSelectedProjectId).toHaveBeenCalledWith("project-1")
      expect(context.setSelectedProject).toHaveBeenCalledWith(project)
      expect(reloadDashboard).toHaveBeenCalledTimes(1)
      expect(setMessage).toHaveBeenLastCalledWith("Applied octocat/hello-world.")
    }))

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

import { Effect } from "effect"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ProjectItem } from "@effect-template/lib"

import type { ProjectDetails } from "../src/api/contracts.js"
import { clearProjectEvents, listProjectEventsSince } from "../src/services/events.js"
import {
  createTerminalSession,
  deleteTerminalSession,
  listProjectTerminalSessions
} from "../src/services/terminal-sessions.js"

const prepareProjectSshMock = vi.hoisted(() => vi.fn())
const probeProjectSshReadyMock = vi.hoisted(() => vi.fn())
const runCommandCaptureMock = vi.hoisted(() => vi.fn())
const upProjectMock = vi.hoisted(() => vi.fn())
const getProjectMock = vi.hoisted(() => vi.fn())
const getProjectItemByIdMock = vi.hoisted(() => vi.fn())
const waitForProjectSshReadyMock = vi.hoisted(() => vi.fn())

vi.mock("@effect-template/lib", () => ({
  prepareProjectSsh: prepareProjectSshMock,
  probeProjectSshReady: probeProjectSshReadyMock,
  renderError: vi.fn((error: unknown) => String(error)),
  waitForProjectSshReady: waitForProjectSshReadyMock
}))

vi.mock("@effect-template/lib/shell/command-runner", () => ({
  runCommandCapture: runCommandCaptureMock
}))

vi.mock("../src/services/projects.js", () => ({
  getProject: getProjectMock,
  getProjectItemById: getProjectItemByIdMock,
  upProject: upProjectMock
}))

const projectId = "/controller/org/repo/issue-7"
const projectKey = "repo-issue-7"
const displayName = "org/repo"

const projectItem = {
  authorizedKeysExists: true,
  authorizedKeysPath: "/controller/org/repo/issue-7/authorized_keys",
  codexAuthPath: "/controller/org/repo/issue-7/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  containerName: "dg-repo-issue-7",
  displayName,
  envGlobalPath: "/controller/org/repo/issue-7/.orch/env/global.env",
  envProjectPath: "/controller/org/repo/issue-7/.orch/env/project.env",
  lastKnownStatus: "running",
  lastStartAction: "up",
  lastStartedAtEpochMs: 1_778_000_000_000,
  lastStartedAtIso: "2026-05-06T19:00:00.000Z",
  projectDir: projectId,
  repoRef: "issue-7",
  repoUrl: "https://github.com/org/repo.git",
  serviceName: "app",
  sshCommand: "ssh -p 2222 dev@localhost",
  sshKeyPath: null,
  sshPort: 2222,
  sshUser: "dev",
  targetDir: "/home/dev/app"
} satisfies ProjectItem

const projectDetails = {
  authorizedKeysExists: true,
  authorizedKeysPath: "/controller/org/repo/issue-7/authorized_keys",
  clonedOnHostname: "host",
  codexAuthPath: "/controller/org/repo/issue-7/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  containerName: "dg-repo-issue-7",
  displayName,
  envGlobalPath: "/controller/org/repo/issue-7/.orch/env/global.env",
  envProjectPath: "/controller/org/repo/issue-7/.orch/env/project.env",
  id: projectId,
  projectDir: projectId,
  projectKey,
  repoRef: "issue-7",
  repoUrl: "https://github.com/org/repo.git",
  serviceName: "app",
  sshCommand: "ssh -p 2222 dev@localhost",
  sshPort: 2222,
  sshSessions: 0,
  sshUser: "dev",
  startedAtEpochMs: 1_778_000_000_000,
  startedAtIso: "2026-05-06T19:00:00.000Z",
  status: "running",
  statusLabel: "Up",
  targetDir: "/home/dev/app"
} satisfies ProjectDetails

const cleanupSessions = (): Effect.Effect<void, never> =>
  Effect.forEach(
    listProjectTerminalSessions(projectId),
    (session) => deleteTerminalSession(projectId, session.id).pipe(Effect.catchAll(() => Effect.void)),
    { discard: true }
  )

const runTestEffect = <A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> =>
  Effect.runPromise(effect as Effect.Effect<A, unknown, never>)

const phaseFromEvent = (event: { readonly payload: unknown }): string | null => {
  if (typeof event.payload !== "object" || event.payload === null || !Object.hasOwn(event.payload, "phase")) {
    return null
  }
  return String(Reflect.get(event.payload, "phase"))
}

describe("terminal sessions service", () => {
  beforeEach(() => {
    clearProjectEvents(projectId)
    prepareProjectSshMock.mockReset()
    probeProjectSshReadyMock.mockReset()
    runCommandCaptureMock.mockReset()
    upProjectMock.mockReset()
    getProjectMock.mockReset()
    getProjectItemByIdMock.mockReset()
    waitForProjectSshReadyMock.mockReset()

    prepareProjectSshMock.mockReturnValue({
      args: ["-p", "2222", "dev@localhost"],
      command: "ssh",
      cwd: "/repo",
      item: projectItem
    })
    runCommandCaptureMock.mockImplementation(() => Effect.fail(new Error("docker inspect skipped in tests")))
    getProjectItemByIdMock.mockImplementation(() => Effect.succeed(projectItem))
  })

  afterEach(() => {
    Effect.runSync(cleanupSessions())
    clearProjectEvents(projectId)
  })

  it("creates a terminal session immediately when SSH is already ready", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))

    const result = await runTestEffect(createTerminalSession(projectId))
    const events = listProjectEventsSince(projectId, 0)
    const phases = events
      .filter((event) => event.type === "project.deployment.status")
      .map(phaseFromEvent)
      .filter((phase): phase is string => phase !== null)

    expect(upProjectMock).not.toHaveBeenCalled()
    expect(waitForProjectSshReadyMock).not.toHaveBeenCalled()
    expect(getProjectMock).toHaveBeenCalledWith(projectId)
    expect(result.project).toEqual(projectDetails)
    expect(result.session.projectId).toBe(projectId)
    expect(result.session.sshCommand).toBe("ssh -p 2222 dev@localhost")
    expect(phases).toEqual(["ssh.prepare", "ssh.fast-ready"])
  })

  it("falls back to project startup and SSH wait when SSH is not ready", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(false))
    upProjectMock.mockImplementation(() => Effect.succeed(projectDetails))
    waitForProjectSshReadyMock.mockImplementation(() => Effect.void)

    const result = await runTestEffect(createTerminalSession(projectId))
    const events = listProjectEventsSince(projectId, 0)
    const phases = events
      .filter((event) => event.type === "project.deployment.status")
      .map(phaseFromEvent)
      .filter((phase): phase is string => phase !== null)

    expect(upProjectMock).toHaveBeenCalledWith(projectId, undefined, true, { startupMode: "ssh-open" })
    expect(waitForProjectSshReadyMock).toHaveBeenCalledTimes(1)
    expect(getProjectMock).not.toHaveBeenCalled()
    expect(result.project).toEqual(projectDetails)
    expect(result.session.projectId).toBe(projectId)
    expect(phases).toEqual(["ssh.prepare", "ssh.wait", "ssh.ready", "ssh.post-start"])
  })
})

import { Effect } from "effect"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ProjectItem } from "@effect-template/lib"
import { NodeContext } from "@effect/platform-node"

import type { ProjectDetails } from "../src/api/contracts.js"
import { clearProjectEvents, listProjectEventsSince } from "../src/services/events.js"
import {
  clearTerminalSessionRuntimeForTest,
  createTerminalSession,
  deleteTerminalSession,
  getProjectTerminalSession,
  listProjectTerminalSessions,
  lookupTerminalSessionById,
  readProjectTerminalSessions,
  readProjectTerminalImage,
  renderTmuxAttachCommand,
  setProjectActiveTerminalSession,
  startTerminalSession
} from "../src/services/terminal-sessions.js"

const listProjectItemsMock = vi.hoisted(() => vi.fn())
const prepareProjectSshMock = vi.hoisted(() => vi.fn())
const probeProjectSshReadyMock = vi.hoisted(() => vi.fn())
const runCommandCaptureMock = vi.hoisted(() => vi.fn())
const upProjectMock = vi.hoisted(() => vi.fn())
const getProjectMock = vi.hoisted(() => vi.fn())
const getProjectItemByIdMock = vi.hoisted(() => vi.fn())
const getProjectItemByKeyMock = vi.hoisted(() => vi.fn())
const waitForProjectSshReadyMock = vi.hoisted(() => vi.fn())

vi.mock("@effect-template/lib", () => ({
  listProjectItems: Effect.sync(() => listProjectItemsMock()),
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
  getProjectItemByKey: getProjectItemByKeyMock,
  upProject: upProjectMock
}))

const projectKey = "repo-issue-7"
const displayName = "org/repo"

let projectId = ""
let projectItem: ProjectItem
let projectDetails: ProjectDetails

const makeProjectItem = (projectDir: string): ProjectItem => ({
  authorizedKeysExists: true,
  authorizedKeysPath: path.join(projectDir, "authorized_keys"),
  codexAuthPath: path.join(projectDir, ".orch", "auth", "codex"),
  codexHome: "/home/dev/.codex",
  containerName: "dg-repo-issue-7",
  displayName,
  envGlobalPath: path.join(projectDir, ".orch", "env", "global.env"),
  envProjectPath: path.join(projectDir, ".orch", "env", "project.env"),
  gpu: "none",
  lastKnownStatus: "running",
  lastStartAction: "up",
  lastStartedAtEpochMs: 1_778_000_000_000,
  lastStartedAtIso: "2026-05-06T19:00:00.000Z",
  projectDir,
  repoRef: "issue-7",
  repoUrl: "https://github.com/org/repo.git",
  serviceName: "app",
  sshCommand: "ssh -p 2222 dev@localhost",
  sshKeyPath: null,
  sshPort: 2222,
  sshUser: "dev",
  targetDir: "/home/dev/app"
})

const makeProjectDetails = (projectDir: string): ProjectDetails => ({
  authorizedKeysExists: true,
  authorizedKeysPath: path.join(projectDir, "authorized_keys"),
  clonedOnHostname: "host",
  codexAuthPath: path.join(projectDir, ".orch", "auth", "codex"),
  codexHome: "/home/dev/.codex",
  containerName: "dg-repo-issue-7",
  displayName,
  envGlobalPath: path.join(projectDir, ".orch", "env", "global.env"),
  envProjectPath: path.join(projectDir, ".orch", "env", "project.env"),
  gpu: "none",
  id: projectDir,
  projectDir,
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
})

const cleanupSessions = (): Effect.Effect<void, never, unknown> =>
  Effect.gen(function*(_) {
    const sessions = yield* _(listProjectTerminalSessions(projectId).pipe(Effect.catchAll(() => Effect.succeed([]))))
    yield* _(Effect.forEach(
      sessions,
      (session) => deleteTerminalSession(projectId, session.id).pipe(Effect.catchAll(() => Effect.void)),
      { discard: true }
    ))
  })

const runTestEffect = <A>(effect: Effect.Effect<A, unknown, unknown>): Promise<A> =>
  Effect.runPromise(effect.pipe(Effect.provide(NodeContext.layer)) as Effect.Effect<A, unknown, never>)

const phaseFromEvent = (event: { readonly payload: unknown }): string | null => {
  if (typeof event.payload !== "object" || event.payload === null || !Object.hasOwn(event.payload, "phase")) {
    return null
  }
  return String(Reflect.get(event.payload, "phase"))
}

const terminalSessionsStatePath = (): string =>
  path.join(projectId, ".orch", "state", "terminal-sessions.json")

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readPersistedSessionState = (): Record<string, unknown> | null => {
  if (!existsSync(terminalSessionsStatePath())) {
    return null
  }
  const raw: unknown = JSON.parse(readFileSync(terminalSessionsStatePath(), "utf8"))
  return isRecord(raw) ? raw : null
}

const readPersistedSessionIds = (): ReadonlyArray<string> => {
  const raw = readPersistedSessionState()
  if (raw === null) {
    return []
  }
  const sessions = Reflect.get(raw, "sessions")
  if (!Array.isArray(sessions)) {
    return []
  }
  return sessions
    .map((session) =>
      typeof session === "object" && session !== null ? Reflect.get(session, "id") : null
    )
    .filter((id): id is string => typeof id === "string")
}

const readPersistedActiveSessionId = (): string | null => {
  const raw = readPersistedSessionState()
  if (raw === null) {
    return null
  }
  const value = Reflect.get(raw, "lastActiveSessionId")
  return typeof value === "string" ? value : null
}

describe("terminal sessions service", () => {
  let projectRoot = ""

  beforeEach(() => {
    projectRoot = mkdtempSync(path.join(os.tmpdir(), "docker-git-terminal-sessions-"))
    projectId = projectRoot
    projectItem = makeProjectItem(projectId)
    projectDetails = makeProjectDetails(projectId)
    clearProjectEvents(projectId)
    clearTerminalSessionRuntimeForTest()
    listProjectItemsMock.mockReset()
    prepareProjectSshMock.mockReset()
    probeProjectSshReadyMock.mockReset()
    runCommandCaptureMock.mockReset()
    upProjectMock.mockReset()
    getProjectMock.mockReset()
    getProjectItemByIdMock.mockReset()
    getProjectItemByKeyMock.mockReset()
    waitForProjectSshReadyMock.mockReset()

    listProjectItemsMock.mockReturnValue([projectItem])
    prepareProjectSshMock.mockReturnValue({
      args: ["-p", "2222", "dev@localhost"],
      command: "ssh",
      cwd: "/repo",
      item: projectItem
    })
    runCommandCaptureMock.mockImplementation((command: { readonly command: string }) =>
      command.command === "ssh"
        ? Effect.succeed("/usr/bin/tmux\n")
        : Effect.fail(new Error("docker inspect skipped in tests"))
    )
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))
    getProjectItemByIdMock.mockImplementation(() => Effect.succeed(projectItem))
    getProjectItemByKeyMock.mockImplementation(() => Effect.succeed(projectItem))
  })

  afterEach(async () => {
    await runTestEffect(cleanupSessions())
    clearTerminalSessionRuntimeForTest()
    clearProjectEvents(projectId)
    rmSync(projectRoot, { force: true, recursive: true })
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
    expect(readPersistedSessionIds()).toEqual([result.session.id])
    expect(phases).toEqual(["ssh.prepare", "ssh.fast-ready"])
  })

  it("renders the remote tmux attach command with availability guard", () => {
    const command = renderTmuxAttachCommand({
      missingMessage: "tmux missing",
      targetDir: "/home/dev/project with spaces",
      tmuxName: "docker-git-session-1"
    })

    expect(command).toContain("command -v tmux")
    expect(command).toContain("bash --noprofile --norc -lc")
    expect(command).toContain("tmux missing")
    expect(command).toContain("tmux new-session -d -s")
    expect(command).toContain("tmux set-option")
    expect(command).toContain("status off")
    expect(command).toContain("tmux attach-session -t")
    expect(command).toContain("docker-git-session-1")
    expect(command).toContain("/home/dev/project with spaces")
  })

  it("fails before creating a durable session when tmux is unavailable", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))
    runCommandCaptureMock.mockImplementation((command: { readonly command: string }) =>
      command.command === "ssh"
        ? Effect.fail(new Error("tmux missing"))
        : Effect.fail(new Error("docker inspect skipped in tests"))
    )

    await expect(runTestEffect(createTerminalSession(projectId))).rejects.toThrow(
      "tmux is not available in this project container"
    )
    expect(readPersistedSessionIds()).toEqual([])
  })

  it("persists multiple sessions for one project with distinct stable IDs", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))

    const first = await runTestEffect(createTerminalSession(projectId))
    const second = await runTestEffect(createTerminalSession(projectId))
    const listed = await runTestEffect(listProjectTerminalSessions(projectId))

    expect(first.session.id).not.toBe(second.session.id)
    expect(listed.map((session) => session.id)).toEqual([first.session.id, second.session.id])
    expect(readPersistedSessionIds()).toEqual([first.session.id, second.session.id])
    expect(readPersistedActiveSessionId()).toBe(second.session.id)
  })

  it("persists and hydrates the active terminal session for a project", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))

    const first = await runTestEffect(createTerminalSession(projectId))
    const second = await runTestEffect(createTerminalSession(projectId))

    await expect(runTestEffect(setProjectActiveTerminalSession(projectId, first.session.id))).resolves.toMatchObject({
      id: first.session.id,
      projectId
    })
    expect(readPersistedActiveSessionId()).toBe(first.session.id)

    clearTerminalSessionRuntimeForTest()

    await expect(runTestEffect(readProjectTerminalSessions(projectId))).resolves.toMatchObject({
      activeSessionId: first.session.id,
      sessions: [
        expect.objectContaining({ id: first.session.id }),
        expect.objectContaining({ id: second.session.id })
      ]
    })
  })

  it("rejects active terminal selection for a missing project session", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))

    await runTestEffect(createTerminalSession(projectId))

    await expect(runTestEffect(setProjectActiveTerminalSession(projectId, "missing-session"))).rejects.toThrow(
      "Terminal session not found: missing-session"
    )
  })

  it("resolves project aliases before checking terminal image session ownership", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))

    const result = await runTestEffect(createTerminalSession(projectId))

    await expect(
      runTestEffect(readProjectTerminalImage("repo-alias", result.session.id, "../image.png"))
    ).rejects.toThrow("Image path must not contain '.' or '..' segments.")
  })

  it("hydrates list, project lookup, and global lookup from persisted state after clearing runtime records", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))

    const first = await runTestEffect(createTerminalSession(projectId))
    const second = await runTestEffect(createTerminalSession(projectId))

    clearTerminalSessionRuntimeForTest()

    const listed = await runTestEffect(listProjectTerminalSessions(projectId))
    expect(listed.map((session) => session.id)).toEqual([
      first.session.id,
      second.session.id
    ])
    await expect(runTestEffect(getProjectTerminalSession(projectId, first.session.id))).resolves.toMatchObject({
      id: first.session.id,
      projectId,
      status: "ready"
    })
    await expect(runTestEffect(lookupTerminalSessionById(second.session.id))).resolves.toMatchObject({
      projectDisplayName: displayName,
      projectKey,
      session: {
        id: second.session.id,
        projectId,
        status: "ready"
      }
    })
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
    expect(getProjectMock).toHaveBeenCalledWith(projectId)
    expect(result.project).toEqual(projectDetails)
    expect(result.session.projectId).toBe(projectId)
    expect(phases).toEqual(["ssh.prepare", "ssh.wait", "ssh.ready", "ssh.post-start"])
  })

  it("starts terminal session asynchronously and emits a correlated created event", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))
    const requestId = "00000000-0000-4000-8000-000000000001"

    const accepted = await runTestEffect(startTerminalSession(projectId, requestId))

    expect(accepted).toEqual({
      accepted: true,
      cursor: 0,
      projectId,
      requestId
    })

    await vi.waitFor(() => {
      const created = listProjectEventsSince(projectId, 0).find((event) => event.type === "project.ssh.session")
      expect(created?.payload).toMatchObject({
        phase: "created",
        sessionId: requestId,
        requestId
      })
      expect(readPersistedSessionIds()).toContain(requestId)
    })
  })

  it("deletes a persisted session and makes future lookup fail", async () => {
    probeProjectSshReadyMock.mockImplementation(() => Effect.succeed(true))
    getProjectMock.mockImplementation(() => Effect.succeed(projectDetails))

    const result = await runTestEffect(createTerminalSession(projectId))
    clearTerminalSessionRuntimeForTest()

    await runTestEffect(deleteTerminalSession(projectId, result.session.id))

    expect(readPersistedSessionIds()).toEqual([])
    expect(readPersistedActiveSessionId()).toBeNull()
    await expect(runTestEffect(getProjectTerminalSession(projectId, result.session.id))).rejects.toThrow(
      `Terminal session not found: ${result.session.id}`
    )
  })
})

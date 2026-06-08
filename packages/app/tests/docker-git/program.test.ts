import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import type { Command } from "../../src/docker-git/frontend-lib/core/domain.js"

const ensureControllerReadyMock = vi.hoisted(() => vi.fn(() => Effect.void))
const runBrowserFrontendCommandMock = vi.hoisted(
  () => vi.fn<(options: { readonly daemon: boolean }) => Effect.Effect<void>>(() => Effect.void)
)
const runMenuCallMock = vi.hoisted(() => vi.fn(() => {}))
const readCommandMock = vi.hoisted(() => vi.fn<() => Command>())
const codexLoginMock = vi.hoisted(() => vi.fn(() => Effect.void))
const createAuthTerminalSessionMock = vi.hoisted(() => vi.fn())
const attachTerminalSessionMock = vi.hoisted(() => vi.fn(() => Effect.void))
const gitlabLoginMock = vi.hoisted(() => vi.fn(() => Effect.succeed({ ok: true })))
const readStatePullMock = vi.hoisted(() => vi.fn(() => Effect.succeed("State pull completed.")))

const menuCommand: Extract<Command, { readonly _tag: "Menu" }> = { _tag: "Menu" }
const browserCommand: Extract<Command, { readonly _tag: "Browser" }> = { _tag: "Browser", daemon: false }
const browserDaemonCommand: Extract<Command, { readonly _tag: "Browser" }> = { _tag: "Browser", daemon: true }
const browserRoutingCases: ReadonlyArray<{
  readonly command: Extract<Command, { readonly _tag: "Browser" }>
  readonly options: { readonly daemon: boolean }
}> = [
  { command: browserCommand, options: { daemon: false } },
  { command: browserDaemonCommand, options: { daemon: true } }
]
const codexLoginCommand: Extract<Command, { readonly _tag: "AuthCodexLogin" }> = {
  _tag: "AuthCodexLogin",
  label: null,
  codexAuthPath: ".docker-git/.orch/auth/codex"
}
const gitlabLoginCommand: Extract<Command, { readonly _tag: "AuthGitlabLogin" }> = {
  _tag: "AuthGitlabLogin",
  label: null,
  token: "glpat-token",
  envGlobalPath: ".docker-git/.orch/env/global.env"
}
const claudeLoginCommand: Extract<Command, { readonly _tag: "AuthClaudeLogin" }> = {
  _tag: "AuthClaudeLogin",
  label: "work",
  claudeAuthPath: ".docker-git/.orch/auth/claude"
}
const geminiLoginCommand: Extract<Command, { readonly _tag: "AuthGeminiLogin" }> = {
  _tag: "AuthGeminiLogin",
  label: null,
  geminiAuthPath: ".docker-git/.orch/auth/gemini",
  isWeb: false
}
const statePullCommand: Extract<Command, { readonly _tag: "StatePull" }> = { _tag: "StatePull" }

vi.mock("../../src/docker-git/cli/read-command.js", () => ({
  readCommand: Effect.sync(() => readCommandMock())
}))

vi.mock("../../src/docker-git/controller.js", () => ({
  ensureControllerReady: ensureControllerReadyMock
}))

vi.mock("../../src/docker-git/browser-frontend.js", () => ({
  runBrowserFrontendCommandWithOptions: (options: { readonly daemon: boolean }) =>
    Effect.flatMap(Effect.sync(() => runBrowserFrontendCommandMock(options)), (effect) => effect)
}))

vi.mock("../../src/docker-git/api-client.js", () => ({
  applyAllProjects: vi.fn(() => Effect.void),
  commitState: vi.fn(() => Effect.succeed("State commit completed.")),
  codexLogin: codexLoginMock,
  codexImport: vi.fn(() => Effect.succeed({ ok: true })),
  codexLogout: vi.fn(() => Effect.void),
  codexStatus: vi.fn(() => Effect.succeed({ ok: true })),
  createAuthTerminalSession: createAuthTerminalSessionMock,
  createProject: vi.fn(() => Effect.succeed(null)),
  downAllProjects: vi.fn(() => Effect.void),
  gitlabLogin: gitlabLoginMock,
  gitlabLogout: vi.fn(() => Effect.void),
  gitlabStatus: vi.fn(() => Effect.succeed({ ok: true })),
  githubLogin: vi.fn(() => Effect.succeed({ ok: true })),
  githubLogout: vi.fn(() => Effect.void),
  githubStatus: vi.fn(() => Effect.succeed({ ok: true })),
  initState: vi.fn(() => Effect.succeed("State init completed.")),
  listProjects: vi.fn(() => Effect.succeed([])),
  pullState: readStatePullMock,
  pushState: vi.fn(() => Effect.succeed("State push completed.")),
  readContainerTaskLogs: vi.fn(() => Effect.succeed("logs")),
  readContainerTaskSnapshot: vi.fn(() => Effect.succeed(null)),
  readStatePath: vi.fn(() => Effect.succeed("/controller-state/.docker-git")),
  readStateStatus: vi.fn(() => Effect.succeed("## main")),
  renderContainerTaskSnapshot: vi.fn(() => "tasks"),
  renderJsonPayload: vi.fn(() => "{}"),
  renderProjectSummaryLine: vi.fn(() => "project"),
  stopContainerTask: vi.fn(() => Effect.void),
  syncState: vi.fn(() => Effect.succeed("State sync completed."))
}))

vi.mock("../../src/docker-git/terminal-session-client.js", () => ({
  attachTerminalSession: attachTerminalSessionMock
}))

vi.mock("../../src/docker-git/menu.js", () => ({
  runMenu: Effect.sync(() => {
    runMenuCallMock()
  })
}))

const runProgram = () =>
  Effect.gen(function*(_) {
    const { program } = yield* _(Effect.promise(() => import("../../src/docker-git/program.js")))
    yield* _(program.pipe(Effect.provide(NodeContext.layer)))
  })

describe("program menu dispatch", () => {
  beforeEach(() => {
    ensureControllerReadyMock.mockReset()
    ensureControllerReadyMock.mockImplementation(() => Effect.void)
    runBrowserFrontendCommandMock.mockReset()
    runBrowserFrontendCommandMock.mockImplementation(() => Effect.void)
    runMenuCallMock.mockReset()
    readCommandMock.mockReset()
    readCommandMock.mockReturnValue(menuCommand)
    codexLoginMock.mockReset()
    codexLoginMock.mockImplementation(() => Effect.void)
    createAuthTerminalSessionMock.mockReset()
    createAuthTerminalSessionMock.mockImplementation(() =>
      Effect.succeed({
        createdAt: "2026-04-21T10:00:00.000Z",
        id: "auth-session-1",
        projectId: "auth",
        sshCommand: "ssh dev@auth",
        status: "ready"
      })
    )
    attachTerminalSessionMock.mockReset()
    attachTerminalSessionMock.mockImplementation(() => Effect.void)
    gitlabLoginMock.mockReset()
    gitlabLoginMock.mockImplementation(() => Effect.succeed({ ok: true }))
    readStatePullMock.mockReset()
    readStatePullMock.mockImplementation(() => Effect.succeed("State pull completed."))
    process.exitCode = 0
    vi.resetModules()
  })

  it.effect("routes menu through controller bootstrap instead of unsupported-command path", () =>
    Effect.gen(function*(_) {
      yield* _(runProgram())

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(runMenuCallMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))

  it.effect("routes browser frontend modes through the browser command runner", () =>
    Effect.forEach(
      browserRoutingCases,
      ({ command, options }) =>
        Effect.gen(function*(_) {
          readCommandMock.mockReturnValue(command)
          ensureControllerReadyMock.mockClear()
          runBrowserFrontendCommandMock.mockClear()
          process.exitCode = 0

          yield* _(runProgram())

          expect(ensureControllerReadyMock).not.toHaveBeenCalled()
          expect(runBrowserFrontendCommandMock).toHaveBeenCalledTimes(1)
          expect(runBrowserFrontendCommandMock).toHaveBeenCalledWith(options)
          expect(process.exitCode).toBe(0)
        }),
      { discard: true }
    ))

  it.effect("routes state pull through the controller API", () =>
    Effect.gen(function*(_) {
      readCommandMock.mockReturnValue(statePullCommand)
      yield* _(runProgram())

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(readStatePullMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))

  it.effect("routes codex login through the controller API", () =>
    Effect.gen(function*(_) {
      readCommandMock.mockReturnValue(codexLoginCommand)
      yield* _(runProgram())

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(codexLoginMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))

  it.effect("routes gitlab login through the controller API", () =>
    Effect.gen(function*(_) {
      readCommandMock.mockReturnValue(gitlabLoginCommand)
      yield* _(runProgram())

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(gitlabLoginMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))

  it.effect("routes claude login through controller auth terminal sessions", () =>
    Effect.gen(function*(_) {
      readCommandMock.mockReturnValue(claudeLoginCommand)
      yield* _(runProgram())

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(createAuthTerminalSessionMock).toHaveBeenCalledWith("ClaudeOauth", "work")
      expect(attachTerminalSessionMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))

  it.effect("routes gemini login through controller auth terminal sessions", () =>
    Effect.gen(function*(_) {
      readCommandMock.mockReturnValue(geminiLoginCommand)
      yield* _(runProgram())

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(createAuthTerminalSessionMock).toHaveBeenCalledWith("GeminiOauth", null)
      expect(attachTerminalSessionMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))
})

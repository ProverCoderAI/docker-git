import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

import type { Command } from "../../src/docker-git/frontend-lib/core/domain.js"

const ensureControllerReadyMock = vi.hoisted(() => vi.fn(() => Effect.void))
const runBrowserFrontendMock = vi.hoisted(() => vi.fn(() => Effect.void))
const runMenuCallMock = vi.hoisted(() => vi.fn(() => {}))
const readCommandMock = vi.hoisted(() => vi.fn<() => Command>())
const codexLoginMock = vi.hoisted(() => vi.fn(() => Effect.void))
const readStatePullMock = vi.hoisted(() => vi.fn(() => Effect.succeed("State pull completed.")))

const menuCommand: Extract<Command, { readonly _tag: "Menu" }> = { _tag: "Menu" }
const browserCommand: Extract<Command, { readonly _tag: "Browser" }> = { _tag: "Browser" }
const codexLoginCommand: Extract<Command, { readonly _tag: "AuthCodexLogin" }> = {
  _tag: "AuthCodexLogin",
  label: null,
  codexAuthPath: ".docker-git/.orch/auth/codex"
}
const statePullCommand: Extract<Command, { readonly _tag: "StatePull" }> = { _tag: "StatePull" }

vi.mock("../../src/docker-git/cli/read-command.js", () => ({
  readCommand: Effect.sync(() => readCommandMock())
}))

vi.mock("../../src/docker-git/controller.js", () => ({
  ensureControllerReady: ensureControllerReadyMock
}))

vi.mock("../../src/docker-git/browser-frontend.js", () => ({
  runBrowserFrontend: Effect.flatMap(Effect.sync(() => runBrowserFrontendMock()), (effect) => effect)
}))

vi.mock("../../src/docker-git/api-client.js", () => ({
  applyAllProjects: vi.fn(() => Effect.void),
  commitState: vi.fn(() => Effect.succeed("State commit completed.")),
  codexLogin: codexLoginMock,
  codexImport: vi.fn(() => Effect.succeed({ ok: true })),
  codexLogout: vi.fn(() => Effect.void),
  codexStatus: vi.fn(() => Effect.succeed({ ok: true })),
  createProject: vi.fn(() => Effect.succeed(null)),
  downAllProjects: vi.fn(() => Effect.void),
  githubLogin: vi.fn(() => Effect.succeed({ ok: true })),
  githubLogout: vi.fn(() => Effect.void),
  githubStatus: vi.fn(() => Effect.succeed({ ok: true })),
  initState: vi.fn(() => Effect.succeed("State init completed.")),
  listProjects: vi.fn(() => Effect.succeed([])),
  pullState: readStatePullMock,
  pushState: vi.fn(() => Effect.succeed("State push completed.")),
  readStatePath: vi.fn(() => Effect.succeed("/controller-state/.docker-git")),
  readStateStatus: vi.fn(() => Effect.succeed("## main")),
  renderJsonPayload: vi.fn(() => "{}"),
  renderProjectSummaryLine: vi.fn(() => "project"),
  syncState: vi.fn(() => Effect.succeed("State sync completed."))
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
    runBrowserFrontendMock.mockReset()
    runBrowserFrontendMock.mockImplementation(() => Effect.void)
    runMenuCallMock.mockReset()
    readCommandMock.mockReset()
    readCommandMock.mockReturnValue(menuCommand)
    codexLoginMock.mockReset()
    codexLoginMock.mockImplementation(() => Effect.void)
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

  it.effect("routes browser frontend through controller bootstrap", () =>
    Effect.gen(function*(_) {
      readCommandMock.mockReturnValue(browserCommand)
      yield* _(runProgram())

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(runBrowserFrontendMock).toHaveBeenCalledTimes(1)
      expect(process.exitCode ?? 0).toBe(0)
    }))

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
})

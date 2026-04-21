import { NodeContext as BrowserFrontendTestNodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

type CommandSpec = {
  readonly args: ReadonlyArray<string>
  readonly command: string
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

const ensureControllerReadyMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())
const restartControllerMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())
const controllerExistsMock = vi.hoisted(() => vi.fn<() => Effect.Effect<boolean>>())
const runCommandCaptureMock = vi.hoisted(() => vi.fn<(spec: CommandSpec) => Effect.Effect<string>>())
const runCommandExitCodeMock = vi.hoisted(() => vi.fn<(spec: CommandSpec) => Effect.Effect<number>>())
const runCommandExitCodeStreamingMock = vi.hoisted(() => vi.fn<(spec: CommandSpec) => Effect.Effect<number>>())

vi.mock("../../src/docker-git/controller.js", () => ({
  ensureControllerReady: ensureControllerReadyMock,
  resolveApiBaseUrl: () => "http://127.0.0.1:3334",
  restartController: restartControllerMock
}))

vi.mock("../../src/docker-git/controller-docker.js", () => ({
  controllerExists: controllerExistsMock
}))

vi.mock("../../src/docker-git/frontend-lib/shell/command-runner.js", () => ({
  runCommandCapture: runCommandCaptureMock,
  runCommandExitCode: runCommandExitCodeMock,
  runCommandExitCodeStreaming: runCommandExitCodeStreamingMock
}))

const originalStdinTty = process.stdin.isTTY
const originalStdoutTty = process.stdout.isTTY

const makeNonInteractive = (): void => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: false })
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: false })
}

const restoreTty = (): void => {
  Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: originalStdinTty })
  Object.defineProperty(process.stdout, "isTTY", { configurable: true, value: originalStdoutTty })
}

const runBrowserCommandUnderTest = Effect.gen(function*(_) {
  const { runBrowserFrontendCommand } = yield* _(
    Effect.promise(() => import("../../src/docker-git/browser-frontend.js"))
  )
  yield* _(runBrowserFrontendCommand.pipe(Effect.provide(BrowserFrontendTestNodeContext.layer)))
})

describe("browser frontend command", () => {
  beforeEach(() => {
    vi.resetModules()
    makeNonInteractive()
    ensureControllerReadyMock.mockReset()
    ensureControllerReadyMock.mockImplementation(() => Effect.void)
    restartControllerMock.mockReset()
    restartControllerMock.mockImplementation(() => Effect.void)
    controllerExistsMock.mockReset()
    controllerExistsMock.mockImplementation(() => Effect.succeed(false))
    runCommandCaptureMock.mockReset()
    runCommandCaptureMock.mockImplementation(() => Effect.succeed(""))
    runCommandExitCodeMock.mockReset()
    runCommandExitCodeMock.mockImplementation(() => Effect.succeed(0))
    runCommandExitCodeStreamingMock.mockReset()
    runCommandExitCodeStreamingMock.mockImplementation(() => Effect.succeed(0))
  })

  afterEach(() => {
    restoreTty()
    delete process.env["DOCKER_GIT_WEB_PORT"]
    delete process.env["DOCKER_GIT_WEB_HOST"]
  })

  it.effect("starts controller and web when nothing is running", () =>
    Effect.gen(function*(_) {
      yield* _(runBrowserCommandUnderTest)

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(restartControllerMock).not.toHaveBeenCalled()
      expect(runCommandExitCodeMock).not.toHaveBeenCalled()
      expect(runCommandExitCodeStreamingMock).toHaveBeenCalledTimes(2)
    }))

  it.effect("restarts controller and replaces the web process when rerun non-interactively", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      controllerExistsMock.mockImplementation(() => Effect.succeed(true))
      runCommandCaptureMock.mockImplementation(() => Effect.succeed("123\n"))
      restartControllerMock.mockImplementation(() =>
        Effect.sync(() => {
          events.push("restart-controller")
        })
      )
      runCommandExitCodeMock.mockImplementation((spec) =>
        Effect.sync(() => {
          events.push(`stop:${spec.args.join(" ")}`)
          return 0
        })
      )
      runCommandExitCodeStreamingMock.mockImplementation((spec) =>
        Effect.sync(() => {
          events.push(`stream:${spec.args.join(" ")}`)
          return 0
        })
      )

      yield* _(runBrowserCommandUnderTest)

      expect(ensureControllerReadyMock).not.toHaveBeenCalled()
      expect(events).toEqual([
        "restart-controller",
        "stop:-c kill \"$@\" 2>/dev/null || true\nsleep 1\nkill -9 \"$@\" 2>/dev/null || true sh 123",
        "stream:run --cwd packages/app build:web",
        "stream:run --cwd packages/app serve:web"
      ])
    }))
})

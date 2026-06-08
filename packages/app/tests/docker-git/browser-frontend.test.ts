import { NodeContext as BrowserFrontendTestNodeContext } from "@effect/platform-node"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import type { RunCommandSpec } from "../../src/docker-git/frontend-lib/shell/command-runner.js"
import type { ControllerBootstrapError } from "../../src/docker-git/host-errors.js"

const ensureControllerReadyMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())
const resolveApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())
const findReachableApiBaseUrlMock = vi.hoisted(
  () => vi.fn<(candidateUrls: ReadonlyArray<string>) => Effect.Effect<string, ControllerBootstrapError>>()
)
const resolveConfiguredApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string>())
const resolveDefaultLocalApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string | undefined>())
const resolveExplicitApiBaseUrlMock = vi.hoisted(() => vi.fn<() => string | undefined>())
const runCommandCaptureMock = vi.hoisted(() => vi.fn<(spec: RunCommandSpec) => Effect.Effect<string>>())
const runCommandExitCodeMock = vi.hoisted(() => vi.fn<(spec: RunCommandSpec) => Effect.Effect<number>>())
const runCommandExitCodeStreamingMock = vi.hoisted(
  () => vi.fn<(spec: RunCommandSpec) => Effect.Effect<number>>()
)

vi.mock("../../src/docker-git/controller.js", () => ({
  ensureControllerReady: ensureControllerReadyMock,
  resolveApiBaseUrl: resolveApiBaseUrlMock
}))

vi.mock("../../src/docker-git/controller-health.js", () => ({
  findReachableApiBaseUrl: findReachableApiBaseUrlMock
}))

vi.mock("../../src/docker-git/controller-reachability.js", () => ({
  resolveConfiguredApiBaseUrl: resolveConfiguredApiBaseUrlMock,
  resolveDefaultLocalApiBaseUrl: resolveDefaultLocalApiBaseUrlMock,
  resolveExplicitApiBaseUrl: resolveExplicitApiBaseUrlMock,
  uniqueStrings: (values: ReadonlyArray<string>) => [...new Set(values)]
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

const streamingEnvs = (): ReadonlyArray<Readonly<Record<string, string | undefined>> | undefined> =>
  runCommandExitCodeStreamingMock.mock.calls.map(([spec]) => spec.env)

const requireEnvValue = (
  env: Readonly<Record<string, string | undefined>> | undefined,
  key: string
): string => {
  const value = env?.[key]
  if (value === undefined) {
    throw new Error(`Missing ${key} in test command env.`)
  }
  return value
}

const makeHttpUrl = (host: string, port: string): string => `http://${host}:${port}`

const dockerBridgeHost = ["172", "17", "0", "2"].join(".")

const useReachableHostApiProbe = (defaultLocalApiBaseUrl?: string): void => {
  resolveApiBaseUrlMock.mockReturnValue(makeHttpUrl(dockerBridgeHost, "3334"))
  if (defaultLocalApiBaseUrl !== undefined) {
    resolveDefaultLocalApiBaseUrlMock.mockReturnValue(defaultLocalApiBaseUrl)
  }
  resolveConfiguredApiBaseUrlMock.mockReturnValue(makeHttpUrl("127.0.0.1", "3334"))
  findReachableApiBaseUrlMock.mockImplementation((candidateUrls) => Effect.succeed(candidateUrls[0] ?? ""))
}

const writeWebStateFile = (
  statePath: string,
  state: Readonly<Record<string, string | number>>
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    yield* _(fs.makeDirectory(path.dirname(statePath), { recursive: true }))
    yield* _(fs.writeFileString(statePath, `${JSON.stringify(state, null, 2)}\n`))
  }).pipe(Effect.provide(BrowserFrontendTestNodeContext.layer))

const makeProjectsRoot = (): Effect.Effect<string, PlatformError> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    return yield* _(fs.makeTempDirectory({ prefix: "docker-git-browser-test-" }))
  }).pipe(Effect.provide(BrowserFrontendTestNodeContext.layer))

const removeProjectsRoot = (root: string): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    yield* _(fs.remove(root, { force: true, recursive: true }))
  }).pipe(Effect.provide(BrowserFrontendTestNodeContext.layer))

describe("browser frontend command", () => {
  let projectsRoot: string | null = null

  beforeEach(() =>
    Effect.runPromise(
      makeProjectsRoot().pipe(
        Effect.tap((root) =>
          Effect.sync(() => {
            vi.resetModules()
            projectsRoot = root
            process.env["DOCKER_GIT_PROJECTS_ROOT"] = root
            makeNonInteractive()
            ensureControllerReadyMock.mockReset()
            ensureControllerReadyMock.mockImplementation(() => Effect.void)
            resolveApiBaseUrlMock.mockReset()
            resolveApiBaseUrlMock.mockReturnValue("http://127.0.0.1:3334")
            findReachableApiBaseUrlMock.mockReset()
            findReachableApiBaseUrlMock.mockImplementation((candidateUrls) => Effect.succeed(candidateUrls[0] ?? ""))
            resolveConfiguredApiBaseUrlMock.mockReset()
            resolveConfiguredApiBaseUrlMock.mockReturnValue("http://127.0.0.1:3334")
            resolveDefaultLocalApiBaseUrlMock.mockReset()
            resolveDefaultLocalApiBaseUrlMock.mockImplementation(() => {})
            resolveExplicitApiBaseUrlMock.mockReset()
            resolveExplicitApiBaseUrlMock.mockImplementation(() => {})
            runCommandCaptureMock.mockReset()
            runCommandCaptureMock.mockImplementation(() => Effect.succeed(""))
            runCommandExitCodeMock.mockReset()
            runCommandExitCodeMock.mockImplementation(() => Effect.succeed(0))
            runCommandExitCodeStreamingMock.mockReset()
            runCommandExitCodeStreamingMock.mockImplementation(() => Effect.succeed(0))
          })
        ),
        Effect.asVoid
      )
    )
  )

  afterEach(() =>
    Effect.runPromise(
      Effect.gen(function*(_) {
        const root = projectsRoot
        yield* _(
          Effect.sync(() => {
            restoreTty()
            delete process.env["DOCKER_GIT_WEB_PORT"]
            delete process.env["DOCKER_GIT_WEB_HOST"]
            delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
            projectsRoot = null
          })
        )
        if (root !== null) {
          yield* _(removeProjectsRoot(root))
        }
      })
    )
  )

  it.effect("starts controller and web when nothing is running", () =>
    Effect.gen(function*(_) {
      yield* _(runBrowserCommandUnderTest)

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(runCommandExitCodeMock).not.toHaveBeenCalled()
      expect(runCommandExitCodeStreamingMock).toHaveBeenCalledTimes(2)
    }))

  it.effect("prefers the reachable host API URL over a selected Docker bridge URL for the web proxy", () =>
    Effect.gen(function*(_) {
      useReachableHostApiProbe()

      yield* _(runBrowserCommandUnderTest)

      expect(findReachableApiBaseUrlMock).toHaveBeenCalledWith(["http://127.0.0.1:3334"])
      expect(streamingEnvs()).toEqual([
        expect.objectContaining({ DOCKER_GIT_API_URL: "http://127.0.0.1:3334" }),
        expect.objectContaining({ DOCKER_GIT_API_URL: "http://127.0.0.1:3334" })
      ])
    }))

  it.effect("falls back to the selected controller URL when the host API URL is unreachable", () =>
    Effect.gen(function*(_) {
      const dockerBridgeApiBaseUrl = makeHttpUrl(dockerBridgeHost, "3334")
      resolveApiBaseUrlMock.mockReturnValue(dockerBridgeApiBaseUrl)
      resolveConfiguredApiBaseUrlMock.mockReturnValue("http://127.0.0.1:3334")
      findReachableApiBaseUrlMock.mockReturnValue(Effect.fail({ _tag: "ControllerBootstrapError", message: "no" }))

      yield* _(runBrowserCommandUnderTest)

      expect(streamingEnvs()).toEqual([
        expect.objectContaining({ DOCKER_GIT_API_URL: dockerBridgeApiBaseUrl }),
        expect.objectContaining({ DOCKER_GIT_API_URL: dockerBridgeApiBaseUrl })
      ])
    }))

  it.effect("does not override an explicit API URL", () =>
    Effect.gen(function*(_) {
      resolveApiBaseUrlMock.mockReturnValue("https://api.example.test")
      resolveExplicitApiBaseUrlMock.mockReturnValue("https://api.example.test")

      yield* _(runBrowserCommandUnderTest)

      expect(findReachableApiBaseUrlMock).not.toHaveBeenCalled()
      expect(streamingEnvs()).toEqual([
        expect.objectContaining({ DOCKER_GIT_API_URL: "https://api.example.test" }),
        expect.objectContaining({ DOCKER_GIT_API_URL: "https://api.example.test" })
      ])
    }))

  it.effect("treats the default local API URL as a reachable host candidate instead of a strict override", () =>
    Effect.gen(function*(_) {
      useReachableHostApiProbe("http://localhost:3334")

      yield* _(runBrowserCommandUnderTest)

      expect(findReachableApiBaseUrlMock).toHaveBeenCalledWith([
        "http://localhost:3334",
        "http://127.0.0.1:3334"
      ])
      expect(streamingEnvs()).toEqual([
        expect.objectContaining({ DOCKER_GIT_API_URL: "http://localhost:3334" }),
        expect.objectContaining({ DOCKER_GIT_API_URL: "http://localhost:3334" })
      ])
    }))

  it.effect("binds browser web to all host interfaces by default", () =>
    Effect.gen(function*(_) {
      yield* _(runBrowserCommandUnderTest)

      expect(streamingEnvs()).toEqual([
        expect.objectContaining({
          DOCKER_GIT_WEB_HOST: "0.0.0.0",
          DOCKER_GIT_WEB_PORT: "4174"
        }),
        expect.objectContaining({
          DOCKER_GIT_WEB_HOST: "0.0.0.0",
          DOCKER_GIT_WEB_PORT: "4174"
        })
      ])
    }))

  it.effect("preserves an explicit web bind host", () =>
    Effect.gen(function*(_) {
      process.env["DOCKER_GIT_WEB_HOST"] = "127.0.0.1"

      yield* _(runBrowserCommandUnderTest)

      expect(streamingEnvs()).toEqual([
        expect.objectContaining({ DOCKER_GIT_WEB_HOST: "127.0.0.1" }),
        expect.objectContaining({ DOCKER_GIT_WEB_HOST: "127.0.0.1" })
      ])
    }))

  it.effect("replaces a stale web process without forcing the controller restart", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      runCommandCaptureMock.mockImplementation(() => Effect.succeed("123\n"))
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

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(events).toEqual([
        "stop:-c kill \"$@\" 2>/dev/null || true\nsleep 1\nkill -9 \"$@\" 2>/dev/null || true sh 123",
        "stream:run --cwd packages/app build:web",
        "stream:run --cwd packages/app serve:web"
      ])
    }))

  it.effect("does not restart the web process when .docker-git state matches the local revision", () =>
    Effect.gen(function*(_) {
      yield* _(runBrowserCommandUnderTest)
      const serveEnv = streamingEnvs()[1]
      const revision = requireEnvValue(serveEnv, "DOCKER_GIT_WEB_REVISION")
      const statePath = requireEnvValue(serveEnv, "DOCKER_GIT_WEB_STATE_PATH")

      yield* _(writeWebStateFile(statePath, {
        schemaVersion: 1,
        revision,
        pid: "123",
        host: "0.0.0.0",
        port: "4174",
        apiBaseUrl: "http://127.0.0.1:3334",
        startedAtIso: "2026-04-21T00:00:00.000Z"
      }))

      ensureControllerReadyMock.mockClear()
      runCommandExitCodeMock.mockClear()
      runCommandExitCodeStreamingMock.mockClear()
      runCommandCaptureMock.mockImplementation(() => Effect.succeed("123\n"))

      yield* _(runBrowserCommandUnderTest)

      expect(ensureControllerReadyMock).toHaveBeenCalledTimes(1)
      expect(runCommandExitCodeMock).not.toHaveBeenCalled()
      expect(runCommandExitCodeStreamingMock).not.toHaveBeenCalled()
    }))
})

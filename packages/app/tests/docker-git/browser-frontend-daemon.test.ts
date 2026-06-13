import { NodeContext as BrowserFrontendDaemonTestNodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, type MockInstance, vi } from "vitest"

import type { BrowserFrontendStartDecision } from "../../src/docker-git/browser-frontend-state.js"
import type { RunCommandSpec } from "../../src/docker-git/frontend-lib/shell/command-runner.js"

type DaemonNumericCommandMock = MockInstance<(spec: RunCommandSpec) => Effect.Effect<number>>

const captureDaemonCommandMock = vi.hoisted(
  () => vi.fn<(spec: RunCommandSpec) => Effect.Effect<string>>(() => Effect.succeed("456\n"))
)
const exitDaemonCommandMock = vi.hoisted(
  () => vi.fn<(spec: RunCommandSpec) => Effect.Effect<number>>(() => Effect.succeed(0))
)
const streamDaemonCommandMock = vi.hoisted(
  () => vi.fn<(spec: RunCommandSpec) => Effect.Effect<number>>(() => Effect.succeed(0))
)

vi.mock("../../src/docker-git/frontend-lib/shell/command-runner.js", () => ({
  runCommandCapture: captureDaemonCommandMock,
  runCommandExitCode: exitDaemonCommandMock,
  runCommandExitCodeStreaming: streamDaemonCommandMock
}))

const decision: BrowserFrontendStartDecision = {
  apiBaseUrl: "http://127.0.0.1:3334",
  host: "0.0.0.0",
  port: "4174",
  shouldStartWeb: true,
  statePath: "/home/dev/.docker-git/.orch/state/browser-frontend.json",
  webRevision: "revision-1"
}

const runDaemonUnderTest = Effect.gen(function*(_) {
  const { runBrowserFrontendDaemon } = yield* _(
    Effect.promise(() => import("../../src/docker-git/browser-frontend.js"))
  )
  yield* _(runBrowserFrontendDaemon(decision).pipe(Effect.provide(BrowserFrontendDaemonTestNodeContext.layer)))
})

const requireDaemonStartSpec = (): RunCommandSpec => {
  const spec = captureDaemonCommandMock.mock.calls[0]?.[0]
  if (spec === undefined) {
    throw new Error("expected daemon start command")
  }
  return spec
}

const resetDaemonCommandMock = (mock: DaemonNumericCommandMock): void => {
  mock.mockReset()
  mock.mockImplementation(() => Effect.succeed(0))
}

const resetDaemonCommandMocks = (): void => {
  vi.resetModules()
  captureDaemonCommandMock.mockReset()
  captureDaemonCommandMock.mockImplementation(() => Effect.succeed("456\n"))
  resetDaemonCommandMock(exitDaemonCommandMock)
  resetDaemonCommandMock(streamDaemonCommandMock)
}

describe("browser frontend daemon mode", () => {
  beforeEach(resetDaemonCommandMocks)

  it.effect("builds in the foreground and starts serve:web as a daemon", () =>
    Effect.gen(function*(_) {
      yield* _(runDaemonUnderTest)

      const daemonStartSpec = requireDaemonStartSpec()
      expect(streamDaemonCommandMock).toHaveBeenCalledTimes(1)
      expect(streamDaemonCommandMock).toHaveBeenCalledWith(
        expect.objectContaining({
          args: ["run", "--cwd", "packages/app", "build:web"],
          command: "bun"
        })
      )
      expect(daemonStartSpec.command).toBe("sh")
      expect(daemonStartSpec.args).toEqual([
        "-c",
        expect.stringContaining("nohup \"$@\""),
        "sh",
        "/home/dev/.docker-git/.orch/state/browser-frontend.log",
        "bun",
        "run",
        "--cwd",
        "packages/app",
        "serve:web"
      ])
      expect(daemonStartSpec.env).toEqual(
        expect.objectContaining({
          DOCKER_GIT_API_URL: "http://127.0.0.1:3334",
          DOCKER_GIT_WEB_PORT: "4174",
          DOCKER_GIT_WEB_STATE_PATH: "/home/dev/.docker-git/.orch/state/browser-frontend.json"
        })
      )
    }))
})

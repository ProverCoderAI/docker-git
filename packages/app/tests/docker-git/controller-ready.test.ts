/* jscpd:ignore-start */
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { beforeEach, vi } from "vitest"

const prepareLocalControllerRevisionMock = vi.hoisted(() => vi.fn<() => Effect.Effect<string>>())
const findReachableDirectHealthProbeMock = vi.hoisted(
  () =>
    vi.fn<
      (options: {
        readonly cachedApiBaseUrl: string | undefined
        readonly defaultLocalApiBaseUrl: string | undefined
        readonly explicitApiBaseUrl: string | undefined
      }) => Effect.Effect<{ readonly apiBaseUrl: string; readonly revision: string | null } | null>
    >()
)
const prepareControllerResourceLimitEnvMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())
const prepareControllerRuntimeEnvMock = vi.hoisted(() => vi.fn<() => Effect.Effect<void>>())

vi.mock("../../src/docker-git/controller-bootstrap-plan.js", () => ({
  resolveControllerComposeUpArgs: () => ["up", "-d"],
  shouldBuildControllerImage: () => false
}))

vi.mock("../../src/docker-git/controller-docker.js", () => ({
  controllerContainerName: "docker-git-api",
  controllerExists: () => Effect.succeed(false),
  ensureControllerReachabilityNetworks: () => Effect.void,
  inspectContainerNetworks: () => Effect.succeed({}),
  inspectControllerPublishedPorts: () => Effect.succeed("unavailable"),
  inspectControllerRevision: () => Effect.succeed(null),
  prepareLocalControllerRevision: prepareLocalControllerRevisionMock,
  resolveCurrentContainerNetworks: () => Effect.succeed({}),
  runCompose: () => Effect.void
}))

vi.mock("../../src/docker-git/controller-health.js", () => ({
  findReachableApiBaseUrl: () => Effect.succeed("http://127.0.0.1:3334"),
  findReachableDirectHealthProbe: findReachableDirectHealthProbeMock
}))

vi.mock("../../src/docker-git/controller-image-revision.js", () => ({
  inspectControllerImageRevision: () => Effect.succeed(null)
}))

vi.mock("../../src/docker-git/controller-reachability.js", () => ({
  buildApiBaseUrlCandidates: () => [],
  formatNetworkIps: () => "unavailable",
  isRemoteDockerHost: () => false,
  resolveApiPort: () => "3334",
  resolveConfiguredApiBaseUrl: () => "http://127.0.0.1:3334",
  resolveDefaultLocalApiBaseUrl: () => {
    const value = process.env["DOCKER_GIT_API_URL"]?.trim()
    return value === "http://127.0.0.1:3334" ? value : undefined
  },
  resolveExplicitApiBaseUrl: () => {
    const value = process.env["DOCKER_GIT_API_URL"]?.trim()
    return value !== undefined && value.length > 0 && value !== "http://127.0.0.1:3334"
      ? value
      : undefined
  },
  shouldRequireExplicitApiUrlForRemoteDocker: () => false,
  trimTrailingSlashes: (value: string) => {
    let end = value.length
    while (end > 0 && value[end - 1] === "/") {
      end -= 1
    }
    return value.slice(0, end)
  }
}))

vi.mock("../../src/docker-git/controller-resource-limits-shell.js", () => ({
  prepareControllerResourceLimitEnv: prepareControllerResourceLimitEnvMock,
  shouldForceRecreateForControllerResourceLimits: () => false
}))

vi.mock("../../src/docker-git/controller-revision.js", () => ({
  shouldForceRecreateController: () => false
}))

vi.mock("../../src/docker-git/controller-runtime-shell.js", () => ({
  prepareControllerRuntimeEnv: prepareControllerRuntimeEnvMock
}))

describe("controller readiness bootstrap", () => {
  beforeEach(() => {
    vi.resetModules()
    Reflect.deleteProperty(process.env, "DOCKER_GIT_API_URL")
    prepareLocalControllerRevisionMock.mockReset()
    findReachableDirectHealthProbeMock.mockReset()
    prepareControllerResourceLimitEnvMock.mockReset()
    prepareControllerRuntimeEnvMock.mockReset()
    prepareLocalControllerRevisionMock.mockImplementation(() => Effect.succeed("local-revision"))
    prepareControllerResourceLimitEnvMock.mockImplementation(() => Effect.void)
    prepareControllerRuntimeEnvMock.mockImplementation(() => Effect.void)
  })

  it.effect("probes explicit API URL before preparing a local controller revision", () =>
    Effect.gen(function*(_) {
      process.env["DOCKER_GIT_API_URL"] = "http://api.example.test"
      findReachableDirectHealthProbeMock.mockImplementation(({ explicitApiBaseUrl }) =>
        Effect.succeed({
          apiBaseUrl: explicitApiBaseUrl ?? "http://api.example.test",
          revision: "remote-revision"
        })
      )

      const { ensureControllerReady, resolveApiBaseUrl } = yield* _(
        Effect.promise(() => import("../../src/docker-git/controller.js"))
      )

      yield* _(ensureControllerReady().pipe(Effect.provide(NodeContext.layer)))

      expect(findReachableDirectHealthProbeMock).toHaveBeenCalledTimes(1)
      expect(prepareLocalControllerRevisionMock).not.toHaveBeenCalled()
      expect(prepareControllerResourceLimitEnvMock).not.toHaveBeenCalled()
      expect(prepareControllerRuntimeEnvMock).not.toHaveBeenCalled()
      expect(resolveApiBaseUrl()).toBe("http://api.example.test")
    }))

  it.effect("falls back to local bootstrap when the default local API URL is not reachable", () =>
    Effect.gen(function*(_) {
      process.env["DOCKER_GIT_API_URL"] = "http://127.0.0.1:3334"
      findReachableDirectHealthProbeMock.mockReturnValue(Effect.succeed(null))

      const { ensureControllerReady, resolveApiBaseUrl } = yield* _(
        Effect.promise(() => import("../../src/docker-git/controller.js"))
      )

      yield* _(ensureControllerReady().pipe(Effect.provide(NodeContext.layer)))

      expect(findReachableDirectHealthProbeMock).toHaveBeenCalledWith({
        cachedApiBaseUrl: undefined,
        defaultLocalApiBaseUrl: "http://127.0.0.1:3334",
        explicitApiBaseUrl: undefined
      })
      expect(prepareLocalControllerRevisionMock).toHaveBeenCalled()
      expect(prepareControllerResourceLimitEnvMock).toHaveBeenCalledTimes(1)
      expect(prepareControllerRuntimeEnvMock).toHaveBeenCalledTimes(1)
      expect(resolveApiBaseUrl()).toBe("http://127.0.0.1:3334")
    }))

  it.effect("rejects unreachable custom explicit API URLs before local bootstrap", () =>
    Effect.gen(function*(_) {
      process.env["DOCKER_GIT_API_URL"] = "https://api.example.test"
      findReachableDirectHealthProbeMock.mockReturnValue(Effect.succeed(null))

      const { ensureControllerReady } = yield* _(
        Effect.promise(() => import("../../src/docker-git/controller.js"))
      )
      const error = yield* _(ensureControllerReady().pipe(Effect.provide(NodeContext.layer), Effect.flip))

      expect(error._tag).toBe("ControllerBootstrapError")
      expect(error.message).toContain("https://api.example.test")
      expect(prepareLocalControllerRevisionMock).not.toHaveBeenCalled()
      expect(prepareControllerResourceLimitEnvMock).not.toHaveBeenCalled()
      expect(prepareControllerRuntimeEnvMock).not.toHaveBeenCalled()
    }))
})
/* jscpd:ignore-end */

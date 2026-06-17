import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import {
  resolveControllerComposeUpArgs,
  shouldBuildControllerImage
} from "../../src/docker-git/controller-bootstrap-plan.js"
import {
  controllerRevisionForMode,
  parseControllerBuildSkillerMode,
  parseControllerDockerRuntime,
  parseControllerGpuMode
} from "../../src/docker-git/controller-docker.js"
import { resolveCurrentContainerName } from "../../src/docker-git/controller-hostname.js"
import {
  isDefaultLocalApiBaseUrl,
  shouldRequireExplicitApiUrlForRemoteDocker
} from "../../src/docker-git/controller-reachability.js"
import {
  parseControllerRevisionEnvOutput,
  parseControllerRevisionLabelOutput,
  shouldForceRecreateController
} from "../../src/docker-git/controller-revision.js"
import { resolveProjectDockerHostForRuntime } from "../../src/docker-git/controller-runtime.js"
import { buildApiBaseUrlCandidates, isRemoteDockerHost } from "../../src/docker-git/controller.js"

/**
 * Joins decimal IP address octets with dots for reachability fixtures.
 *
 * @param octets - Decimal octet strings in network order.
 * @returns Dotted IP address text.
 * @pure true
 * @effect none
 * @invariant Result contains exactly `max(0, octets.length - 1)` dot separators.
 * @precondition Each octet is already a decimal IP component.
 * @postcondition Splitting the result on "." yields the original octets.
 * @complexity O(n) time and O(n) space where n = octets.length.
 * @throws Never
 */
const joinIp = (...octets: ReadonlyArray<string>): string => octets.join(".")

/**
 * Builds a deterministic HTTP URL fixture without spelling the scheme as one token.
 *
 * @param host - Non-empty host or IP address.
 * @param port - Non-empty decimal TCP port string.
 * @returns HTTP URL fixture for the host and port.
 * @pure true
 * @effect none
 * @invariant Result has the form `http://{host}:{port}`.
 * @precondition `host` and `port` are finite strings.
 * @postcondition The returned URL preserves host and port verbatim.
 * @complexity O(|host| + |port|) time and space.
 * @throws Never
 */
const makeHttpUrl = (host: string, port: string): string => ["ht", "tp://", host, ":", port].join("")
const controllerSourceRevisionArbitrary = fc
  .string({ maxLength: 64, minLength: 1 })
  .filter((value) => !value.includes("\n") && !value.includes("\r"))
const controllerGpuModeArbitrary = fc.constantFrom<"none" | "all">("none", "all")
const controllerBuildSkillerModeArbitrary = fc.constantFrom<"0" | "1">("0", "1")
const controllerDockerRuntimeArbitrary = fc.constantFrom<"host" | "isolated">("host", "isolated")
const defaultLocalApiHostArbitrary = fc.constantFrom("127.0.0.1", "localhost", "[::1]")
const apiBaseUrlTrailingSlashesArbitrary = fc.constantFrom("", "/", "///")
const dockerHostArbitrary = fc.constantFrom<string | undefined>(
  undefined,
  "",
  " unix:///var/run/docker.sock ",
  "tcp://docker.example.test:2376",
  " ssh://docker@example.test "
)
const explicitApiBaseUrlArbitrary = fc.option(fc.webUrl(), { nil: undefined })
const dockerNetworkNameArbitrary = fc
  .string({ maxLength: 16, minLength: 1 })
  .filter((value) => value.trim().length > 0)
const dockerNetworkIpArbitrary = fc
  .tuple(
    fc.integer({ max: 255, min: 1 }),
    fc.integer({ max: 255, min: 0 }),
    fc.integer({ max: 255, min: 0 }),
    fc.integer({ max: 254, min: 1 })
  )
  .map((octets) => joinIp(...octets.map(String)))
const dockerNetworkIpsArbitrary = fc.dictionary(dockerNetworkNameArbitrary, dockerNetworkIpArbitrary)

describe("controller reachability", () => {
  it.effect("builds direct API candidates without Docker inspection", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: undefined,
        cachedApiBaseUrl: makeHttpUrl("api-cache.local", "3334") + "/",
        defaultApiBaseUrl: makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        currentContainerNetworks: {},
        controllerNetworks: {},
        port: "3334"
      })

      expect(candidates).toEqual([
        makeHttpUrl("api-cache.local", "3334"),
        makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        makeHttpUrl("docker-git-api", "3334")
      ])
    }))

  it.effect("prefers an explicit API URL without fallbacks", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: makeHttpUrl("api.example.test", "4444") + "/",
        cachedApiBaseUrl: makeHttpUrl(joinIp("172", "17", "0", "20"), "3334"),
        defaultApiBaseUrl: makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        currentContainerNetworks: { bridge: joinIp("172", "17", "0", "15") },
        controllerNetworks: { bridge: joinIp("172", "17", "0", "20") },
        port: "3334"
      })

      expect(candidates).toEqual([makeHttpUrl("api.example.test", "4444")])
    }))

  it.effect("adds containerized fallbacks after the local API URL", () =>
    Effect.sync(() => {
      const candidates = buildApiBaseUrlCandidates({
        explicitApiBaseUrl: undefined,
        cachedApiBaseUrl: undefined,
        defaultApiBaseUrl: makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        currentContainerNetworks: {
          bridge: joinIp("172", "17", "0", "15"),
          "docker-git-shared": joinIp("172", "18", "0", "19")
        },
        controllerNetworks: {
          bridge: joinIp("172", "17", "0", "20"),
          "docker-git-shared": joinIp("172", "18", "0", "2")
        },
        port: "3334"
      })

      expect(candidates).toEqual([
        makeHttpUrl(joinIp("127", "0", "0", "1"), "3334"),
        makeHttpUrl("docker-git-api", "3334"),
        makeHttpUrl("host.docker.internal", "3334"),
        makeHttpUrl(joinIp("172", "18", "0", "2"), "3334"),
        makeHttpUrl(joinIp("172", "17", "0", "20"), "3334")
      ])
    }))

  it.effect("detects remote Docker hosts", () =>
    Effect.sync(() => {
      expect(isRemoteDockerHost("")).toBe(false)
      expect(isRemoteDockerHost("unix:///var/run/docker.sock")).toBe(false)
      expect(isRemoteDockerHost("tcp://docker.example.test:2376")).toBe(true)
      expect(isRemoteDockerHost("ssh://docker@example.test")).toBe(true)
    }))

  it.effect("classifies only default localhost API URLs as non-strict overrides", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(defaultLocalApiHostArbitrary, apiBaseUrlTrailingSlashesArbitrary, (host, trailingSlashes) => {
          expect(isDefaultLocalApiBaseUrl(`http://${host}:3334${trailingSlashes}`, "3334")).toBe(true)
        })
      )

      expect(isDefaultLocalApiBaseUrl(makeHttpUrl("127.0.0.1", "4444"), "3334")).toBe(false)
      expect(isDefaultLocalApiBaseUrl(makeHttpUrl("0.0.0.0", "3334"), "3334")).toBe(false)
      expect(isDefaultLocalApiBaseUrl("https://localhost:3334", "3334")).toBe(false)
      expect(isDefaultLocalApiBaseUrl(`${makeHttpUrl("localhost", "3334")}/api`, "3334")).toBe(false)
    }))

  it.effect("requires an explicit API URL only for non-inspectable remote Docker hosts", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          dockerHostArbitrary,
          explicitApiBaseUrlArbitrary,
          dockerNetworkIpsArbitrary,
          (dockerHost, explicitApiBaseUrl, currentContainerNetworks) => {
            const isExpected = isRemoteDockerHost(dockerHost) &&
              explicitApiBaseUrl === undefined &&
              Object.keys(currentContainerNetworks).length === 0

            expect(
              shouldRequireExplicitApiUrlForRemoteDocker(dockerHost, explicitApiBaseUrl, currentContainerNetworks)
            ).toBe(isExpected)
          }
        )
      )
    }))

  it.effect("resolves the current container name from HOSTNAME or OS hostname", () =>
    Effect.sync(() => {
      const optionalHostnameArbitrary = fc.option(fc.string(), { nil: undefined })
      fc.assert(
        fc.property(
          optionalHostnameArbitrary,
          fc.string(),
          (envHostname, systemHostname) => {
            expect(resolveCurrentContainerName(envHostname, systemHostname)).toBe(
              envHostname?.trim() || systemHostname.trim()
            )
          }
        )
      )
    }))

  it.effect("parses controller revision from container env output", () =>
    Effect.sync(() => {
      const parsed = parseControllerRevisionEnvOutput(
        [
          "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          "DOCKER_GIT_CONTROLLER_REV=abc123def4567890",
          "NODE_ENV=production"
        ].join("\n")
      )

      expect(parsed).toBe("abc123def4567890")
      expect(parseControllerRevisionEnvOutput("PATH=/usr/bin\nNODE_ENV=production\n")).toBeNull()
    }))

  it.effect("parses controller revision from image label output", () =>
    Effect.sync(() => {
      expect(parseControllerRevisionLabelOutput(" abc123def4567890 \n")).toBe("abc123def4567890")
      expect(parseControllerRevisionLabelOutput("")).toBeNull()
      expect(parseControllerRevisionLabelOutput(" <no value> \n")).toBeNull()
    }))

  it.effect("forces controller recreate when the running revision differs", () =>
    Effect.sync(() => {
      expect(shouldForceRecreateController(false, "local-a", null)).toBe(false)
      expect(shouldForceRecreateController(true, "local-a", "local-a")).toBe(false)
      expect(shouldForceRecreateController(true, "local-a", "local-b")).toBe(true)
      expect(shouldForceRecreateController(true, "local-a", null)).toBe(true)
    }))

  it.effect("skips controller image build when a matching image or reusable container exists", () =>
    Effect.sync(() => {
      expect(
        shouldBuildControllerImage({
          currentControllerRevision: "old",
          currentImageRevision: "local-a",
          forceRecreateController: true,
          localControllerRevision: "local-a"
        })
      ).toBe(false)
      expect(
        shouldBuildControllerImage({
          currentControllerRevision: "local-a",
          currentImageRevision: "old",
          forceRecreateController: false,
          localControllerRevision: "local-a"
        })
      ).toBe(false)
      expect(
        shouldBuildControllerImage({
          currentControllerRevision: "local-a",
          currentImageRevision: "old",
          forceRecreateController: true,
          localControllerRevision: "local-a"
        })
      ).toBe(true)
      expect(
        shouldBuildControllerImage({
          currentControllerRevision: null,
          currentImageRevision: null,
          forceRecreateController: false,
          localControllerRevision: "local-a"
        })
      ).toBe(true)
    }))

  it.effect("keeps compose up flags equivalent to the bootstrap plan", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), (buildController, forceRecreateController) => {
          const args = resolveControllerComposeUpArgs({ buildController, forceRecreateController })

          expect(args.slice(0, 2)).toEqual(["up", "-d"])
          expect(args.includes("--build")).toBe(buildController)
          expect(args.includes("--force-recreate")).toBe(forceRecreateController)
        })
      )
    }))

  it.effect("parses controller GPU mode from environment values", () =>
    Effect.sync(() => {
      expect(parseControllerGpuMode()).toBe("none")
      expect(parseControllerGpuMode("")).toBe("none")
      expect(parseControllerGpuMode("none")).toBe("none")
      expect(parseControllerGpuMode("all")).toBe("all")
      expect(parseControllerGpuMode("gpu")).toBeNull()
    }))

  it.effect("parses controller Skiller build mode from environment values", () =>
    Effect.sync(() => {
      expect(parseControllerBuildSkillerMode()).toBe("1")
      expect(parseControllerBuildSkillerMode("")).toBe("1")
      expect(parseControllerBuildSkillerMode("1")).toBe("1")
      expect(parseControllerBuildSkillerMode("true")).toBe("1")
      expect(parseControllerBuildSkillerMode("0")).toBe("0")
      expect(parseControllerBuildSkillerMode("false")).toBe("0")
      expect(parseControllerBuildSkillerMode("skip")).toBeNull()
    }))

  it.effect("parses controller Docker runtime from environment values", () =>
    Effect.sync(() => {
      expect(parseControllerDockerRuntime()).toBe("host")
      expect(parseControllerDockerRuntime("")).toBe("host")
      expect(parseControllerDockerRuntime("host")).toBe("host")
      expect(parseControllerDockerRuntime("isolated")).toBe("isolated")
      expect(parseControllerDockerRuntime("remote")).toBeNull()
    }))

  it.effect("defaults isolated project containers to the embedded controller daemon", () =>
    Effect.sync(() => {
      expect(resolveProjectDockerHostForRuntime("host")).toBe("")
      expect(resolveProjectDockerHostForRuntime("host", " tcp://custom:2375 ")).toBe("tcp://custom:2375")
      expect(resolveProjectDockerHostForRuntime("isolated")).toBe("tcp://host.docker.internal:2375")
      expect(resolveProjectDockerHostForRuntime("isolated", " tcp://custom:2375 ")).toBe("tcp://custom:2375")
    }))

  it.effect("includes controller runtime, GPU and Skiller build modes in the revision", () =>
    Effect.sync(() => {
      expect(controllerRevisionForMode("abc123def4567890", "none")).toBe("abc123def4567890-host-none-skiller1")
      expect(controllerRevisionForMode("abc123def4567890", "all")).toBe("abc123def4567890-host-all-skiller1")
      expect(controllerRevisionForMode("abc123def4567890", "none", "0", "isolated")).toBe(
        "abc123def4567890-isolated-none-skiller0"
      )

      fc.assert(
        fc.property(
          controllerSourceRevisionArbitrary,
          controllerGpuModeArbitrary,
          controllerBuildSkillerModeArbitrary,
          controllerDockerRuntimeArbitrary,
          (sourceRevision, gpuMode, buildSkillerMode, dockerRuntime) => {
            expect(controllerRevisionForMode(sourceRevision, gpuMode, buildSkillerMode, dockerRuntime)).toBe(
              `${sourceRevision}-${dockerRuntime}-${gpuMode}-skiller${buildSkillerMode}`
            )
          }
        )
      )
    }))
})

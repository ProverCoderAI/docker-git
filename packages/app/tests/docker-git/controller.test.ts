import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
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
  parseControllerGpuMode
} from "../../src/docker-git/controller-docker.js"
import {
  computeRevisionFromInputs,
  parseControllerRevisionEnvOutput,
  parseControllerRevisionLabelOutput,
  shouldForceRecreateController
} from "../../src/docker-git/controller-revision.js"
import { buildApiBaseUrlCandidates, isRemoteDockerHost } from "../../src/docker-git/controller.js"

const joinIp = (...octets: ReadonlyArray<string>): string => octets.join(".")
const makeHttpUrl = (host: string, port: string): string => ["ht", "tp://", host, ":", port].join("")
const ignoredControllerRevisionEntries: ReadonlyArray<string> = [
  ".git",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "dist-test",
  "dist-web",
  "node_modules",
  "out"
]

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

  it.effect("includes controller GPU and Skiller build modes in the revision", () =>
    Effect.sync(() => {
      expect(controllerRevisionForMode("abc123def4567890", "none")).toBe("abc123def4567890-none-skiller1")
      expect(controllerRevisionForMode("abc123def4567890", "all")).toBe("abc123def4567890-all-skiller1")
      expect(controllerRevisionForMode("abc123def4567890", "none", "0")).toBe("abc123def4567890-none-skiller0")
    }))

  it.effect("ignores generated paths when computing controller revisions", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const rootDir = yield* _(fs.makeTempDirectoryScoped({ prefix: "docker-git-controller-revision-" }))
        const sourceDir = path.join(rootDir, "src")
        yield* _(fs.makeDirectory(sourceDir, { recursive: true }))
        yield* _(fs.writeFileString(path.join(sourceDir, "tracked.ts"), "export const value = 1\n"))

        const before = yield* _(computeRevisionFromInputs(rootDir, ["src"]))

        for (const entry of ignoredControllerRevisionEntries) {
          if (entry === ".git") {
            yield* _(fs.writeFileString(path.join(sourceDir, entry), "gitdir: ignored\n"))
            continue
          }
          yield* _(fs.makeDirectory(path.join(sourceDir, entry), { recursive: true }))
          yield* _(fs.writeFileString(path.join(sourceDir, entry, "generated.txt"), "ignored\n"))
        }

        const after = yield* _(computeRevisionFromInputs(rootDir, ["src"]))
        expect(after).toBe(before)
      }).pipe(Effect.provide(NodeContext.layer))
    ))
})

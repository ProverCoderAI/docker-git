import { NodeContext } from "@effect/platform-node"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Either } from "effect"

import {
  controllerCpuLimitEnvKey,
  controllerMemoryLimitEnvKey,
  controllerMemorySwapLimitEnvKey,
  controllerPidsLimitEnvKey,
  controllerResourceLimitEnvAssignments,
  controllerResourceLimitsForceRecreateEnvKey,
  resolveControllerResourceLimitEnv,
  shouldForceRecreateForControllerResourceLimitIntent,
  stripControllerResourceLimitArgs
} from "../../src/docker-git/controller-resource-limits.js"

const composeFiles: ReadonlyArray<string> = ["docker-compose.yml", "docker-compose.api.yml"]
const isolatedComposeFiles: ReadonlyArray<string> = ["docker-compose.isolated.yml", "docker-compose.api.isolated.yml"]
const hostDockerDataBind = "/var/lib/docker:/var/lib/docker"
const isolatedDockerDataVolume = "docker_git_docker_data:/var/lib/docker"

const readComposeFile = (relativePath: string): Effect.Effect<string> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    return yield* _(fs.readFileString(path.join("..", "..", relativePath)))
  }).pipe(
    Effect.provide(NodeContext.layer),
    Effect.orDie
  )

describe("controller compose resource limits", () => {
  for (const composeFile of composeFiles) {
    describe(composeFile, () => {
      it.effect("caps controller CPU usage", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toContain("cpus: ${DOCKER_GIT_CONTROLLER_CPUS:-0.9}")
        }))

      it.effect("caps controller memory and swap separately", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toContain("mem_limit: ${DOCKER_GIT_CONTROLLER_MEMORY:-921m}")
          expect(contents).toContain("memswap_limit: ${DOCKER_GIT_CONTROLLER_MEMORY_SWAP:-1842m}")
        }))

      it.effect("caps controller PIDs to prevent fork bombs", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toMatch(/pids_limit: \$\{DOCKER_GIT_CONTROLLER_PIDS:-\d+\}/u)
        }))

      it.effect("binds host Docker data root for host runtime volume path access", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toContain(`- ${hostDockerDataBind}`)
          expect(contents).not.toContain(`- ${isolatedDockerDataVolume}`)
        }))
    })
  }

  for (const composeFile of isolatedComposeFiles) {
    describe(composeFile, () => {
      it.effect("removes the host Docker socket bind in isolated runtime overlays", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toContain("volumes: !override")
          expect(contents).not.toContain("/var/run/docker.sock:/var/run/docker.sock")
        }))

      it.effect("defaults project containers to the embedded controller daemon", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toContain(
            "DOCKER_GIT_PROJECT_DOCKER_HOST: ${DOCKER_GIT_PROJECT_DOCKER_HOST:-tcp://host.docker.internal:2375}"
          )
        }))

      it.effect("enables privileged controller mode for the embedded Docker daemon", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toContain("privileged: ${DOCKER_GIT_CONTROLLER_PRIVILEGED:-true}")
        }))

      it.effect("keeps Docker data inside the embedded controller daemon volume", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          expect(contents).toContain(`- ${isolatedDockerDataVolume}`)
          expect(contents).not.toContain(`- ${hostDockerDataBind}`)
        }))
    })
  }
})

describe("controller resource limit resolution", () => {
  it.effect("resolves CPU and RAM defaults to 90% of host resources", () =>
    Effect.sync(() => {
      const resolved = resolveControllerResourceLimitEnv(
        {},
        {
          cpuCount: 8,
          totalMemoryBytes: 16 * 1024 ** 3
        }
      )

      Either.match(resolved, {
        onLeft: (error) => {
          throw new Error(`unexpected parse error ${error._tag}`)
        },
        onRight: (env) => {
          expect(env).toEqual({
            cpus: "7.2",
            memory: "14745m",
            memorySwap: "29490m",
            pids: "4096"
          })
        }
      })
    }))

  it.effect("allows controller CLI flags before and after the command", () =>
    Effect.sync(() => {
      const parsed = stripControllerResourceLimitArgs([
        "--controller-cpu",
        "75%",
        "clone",
        "https://github.com/org/repo.git",
        "--controller-ram=8g",
        "--controller-pids",
        "8192"
      ])

      Either.match(parsed, {
        onLeft: (error) => {
          throw new Error(`unexpected parse error ${error._tag}`)
        },
        onRight: (result) => {
          expect(result.args).toEqual(["clone", "https://github.com/org/repo.git"])
          expect(result.controllerResourceLimits).toEqual({
            cpuLimit: "75%",
            ramLimit: "8g",
            pidsLimit: "8192"
          })
        }
      })
    }))

  it.effect("emits compose env intent and recreate marker for controller CLI overrides", () =>
    Effect.sync(() => {
      expect(
        controllerResourceLimitEnvAssignments({
          cpuLimit: "4",
          ramLimit: "16g",
          pidsLimit: "8192"
        })
      ).toEqual([
        { key: controllerCpuLimitEnvKey, value: "4" },
        { key: controllerMemoryLimitEnvKey, value: "16g" },
        { key: controllerPidsLimitEnvKey, value: "8192" },
        { key: controllerResourceLimitsForceRecreateEnvKey, value: "1" }
      ])
      expect(controllerMemorySwapLimitEnvKey).toBe("DOCKER_GIT_CONTROLLER_MEMORY_SWAP")
    }))

  it.effect("forces controller recreate for either CLI or env limit intent", () =>
    Effect.sync(() => {
      expect(
        shouldForceRecreateForControllerResourceLimitIntent(
          { cpuLimit: "75%" },
          {}
        )
      ).toBe(true)
      expect(
        shouldForceRecreateForControllerResourceLimitIntent(
          {},
          { ramLimit: "8g" }
        )
      ).toBe(true)
      expect(shouldForceRecreateForControllerResourceLimitIntent({}, {})).toBe(false)
    }))
})

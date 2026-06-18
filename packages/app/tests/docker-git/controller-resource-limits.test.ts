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
const skillerWebEnvLines: ReadonlyArray<string> = [
  "DOCKER_GIT_SKILLER_WEB_URL: ${DOCKER_GIT_SKILLER_WEB_URL-https://skiller-web-henna.vercel.app}",
  "DOCKER_GIT_SKILLER_BACKEND_URL: ${DOCKER_GIT_SKILLER_BACKEND_URL:-}",
  "DOCKER_GIT_API_PUBLIC_URL: ${DOCKER_GIT_API_PUBLIC_URL:-}",
  "DOCKER_GIT_SKILLER_ALLOWED_ORIGINS: ${DOCKER_GIT_SKILLER_ALLOWED_ORIGINS:-}"
]

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

      it.effect("passes external Skiller Web environment with empty-env opt-out", () =>
        Effect.gen(function*(_) {
          const contents = yield* _(readComposeFile(composeFile))
          for (const line of skillerWebEnvLines) {
            expect(contents).toContain(line)
          }
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

describe("API Dockerfile Electron materialization", () => {
  it.effect("materializes Electron binary before bundling Skiller", () =>
    Effect.gen(function*(_) {
      const contents = yield* _(readComposeFile("packages/api/Dockerfile"))
      expect(contents).toMatch(/electron_zip="\$\(find "\$\{electron_config_cache:-\/root\/\.cache\/electron\}"/u)
      expect(contents).toMatch(/Electron zip not found in cache/u)
      expect(contents).toMatch(/unzip -Z1 "\$electron_zip"/u)
      expect(contents).toMatch(/Unsafe paths in Electron zip/u)
      expect(contents).toMatch(/unzip -q "\$electron_zip" -d node_modules\/electron\/dist/u)
      expect(contents).toMatch(/test -x node_modules\/electron\/dist\/electron/u)
    }))
})

describe("API Dockerfile controller tooling install", () => {
  it.effect("retries network-bound controller tooling downloads", () =>
    Effect.gen(function*(_) {
      const contents = yield* _(readComposeFile("packages/api/Dockerfile"))
      expect(contents).toContain("https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-setup.sh")
      expect(contents).toContain("npm install -g --prefix /opt/bun --no-audit --no-fund bun@1.3.11 node-gyp@12.4.0")
      expect(contents).toContain("curl -fsSL --retry 5 --retry-all-errors --retry-delay 2")
      expect(contents).toContain("for attempt in 1 2 3 4 5; do")
      expect(contents).toContain("controller tooling install failed after retries")
      expect(contents).toContain("test \"$(bun --version)\" = \"1.3.11\"")
      expect(contents).toContain("node-gyp --version")
    }))
})

describe("OpenCode E2E auth bootstrap", () => {
  it.effect("retries controller auth commands before the clone scenario", () =>
    Effect.gen(function*(_) {
      const contents = yield* _(readComposeFile("scripts/e2e/opencode-autoconnect.sh"))
      expect(contents).toContain("auth_attempts=3")
      expect(contents).toContain(": > \"$AUTH_LOG\"")
      expect(contents).toContain("if (")
      expect(contents).toContain("dg_run_docker_git \"$REPO_ROOT\" auth codex import")
      expect(contents).toContain("dg_run_docker_git \"$REPO_ROOT\" auth codex status")
      expect(contents).toContain(") >>\"$AUTH_LOG\" 2>&1")
      expect(contents).toContain("auth bootstrap attempt $auth_attempt/$auth_attempts failed")
      expect(contents).toContain("docker-git auth bootstrap failed after $auth_attempts attempts")
    }))
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

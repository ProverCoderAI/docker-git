import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Logger } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Option from "effect/Option"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"
import fc from "fast-check"

import type { TemplateConfig } from "../../src/core/domain.js"
import { gpuModeAfterDockerFailure } from "../../src/core/gpu.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"
import { runDockerComposeUpWithPortCheck } from "../../src/usecases/projects-up.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
  readonly cwd?: string | undefined
}

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-projects-up-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const includesArgsInOrder = (
  args: ReadonlyArray<string>,
  expectedSequence: ReadonlyArray<string>
): boolean => {
  let searchFrom = 0
  for (const expected of expectedSequence) {
    const foundAt = args.indexOf(expected, searchFrom)
    if (foundAt === -1) {
      return false
    }
    searchFrom = foundAt + 1
  }
  return true
}

const isDockerComposePsFormatted = (cmd: RecordedCommand): boolean =>
  cmd.command === "docker" &&
  includesArgsInOrder(cmd.args, ["compose", "--ansi", "never", "--progress", "plain", "ps", "--format"])

const isDockerComposeUpWithBuild = (cmd: RecordedCommand): boolean =>
  cmd.command === "docker" &&
  includesArgsInOrder(cmd.args, ["compose", "--ansi", "never", "--progress", "plain", "up", "-d", "--build"])

const isDockerComposeUpReuse = (cmd: RecordedCommand): boolean =>
  cmd.command === "docker" &&
  includesArgsInOrder(cmd.args, ["compose", "--ansi", "never", "--progress", "plain", "up", "-d"]) &&
  !cmd.args.includes("--build")

const isDockerVolumeCreate = (cmd: RecordedCommand): boolean =>
  cmd.command === "docker" &&
  includesArgsInOrder(cmd.args, ["volume", "create"])

const isBootstrapSeed = (cmd: RecordedCommand): boolean =>
  cmd.command === "bash" &&
  (cmd.args[0] === "-c" || cmd.args[0] === "-lc") &&
  (cmd.args[1] ?? "").includes("docker run --rm -i -v 'dg-test-home-bootstrap:/target' alpine:3.20")

const isDockerInspectBridgeIp = (cmd: RecordedCommand): boolean =>
  cmd.command === "docker" &&
  includesArgsInOrder(cmd.args, ["inspect", "-f"]) &&
  cmd.args.some((arg) => arg.includes("NetworkSettings.Networks")) &&
  cmd.args.some((arg) => arg.includes("bridge"))

const decideStdout = (cmd: RecordedCommand): string => {
  if (isDockerComposePsFormatted(cmd)) {
    return "dg-test\tUp 2 minutes\t0.0.0.0:2237->22/tcp\tissue-84-image\n"
  }
  if (isDockerInspectBridgeIp(cmd)) {
    return "172.17.0.5\n"
  }
  return ""
}

const nvidiaContainerCliMarker = "nvidia-container-cli"
const libNvidiaMlMarker = "libnvidia-ml.so.1"
const missingDeviceDriverMarker = "could not select device driver"

const nvidiaRuntimeFailure = `Error response from daemon: failed to create task for container: ${nvidiaContainerCliMarker}: initialization error: load library failed: ${libNvidiaMlMarker}`

const nvidiaMissingDeviceDriverFailure =
  `Error response from daemon: ${missingDeviceDriverMarker} "" with capabilities: [[gpu]]`

const arbitraryComposeFailure =
  "Error response from daemon: network sandbox setup failed"

const gpuAllComposeYamlPattern = /(^|\s)gpus:\s*["']?all["']?(\s|$)/m

const nvidiaFailureMarkers: ReadonlyArray<string> = [
  nvidiaContainerCliMarker,
  libNvidiaMlMarker,
  missingDeviceDriverMarker
]

const containsNvidiaFailureMarker = (details: string): boolean => {
  const normalized = details.toLowerCase()
  return nvidiaFailureMarkers.some((marker) => normalized.includes(marker))
}

const hasNvidiaFallbackWarning = (logs: ReadonlyArray<string>, expectedDetail: string): boolean =>
  logs.some((entry) =>
    entry.includes("NVIDIA runtime failed") &&
    entry.includes(expectedDetail) &&
    entry.includes("GPU access disabled")
  )

const isDockerComposeUpAttempt = (cmd: RecordedCommand): boolean =>
  isDockerComposeUpWithBuild(cmd) || isDockerComposeUpReuse(cmd)

type FakeExecutorOptions = {
  readonly failGpuComposeUp?: boolean
  readonly gpuFailureStderr?: string
}

const makeFakeExecutor = (
  recorded: Array<RecordedCommand>,
  options: FakeExecutorOptions = {}
): CommandExecutor.CommandExecutor => {
  let shouldFailGpuComposeUp = options.failGpuComposeUp === true
  const gpuFailureStderr = options.gpuFailureStderr ?? nvidiaRuntimeFailure

  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({
          command: entry.command,
          args: entry.args,
          cwd: Option.getOrUndefined(entry.cwd)
        })
      }

      const last = flattened[flattened.length - 1]!
      const invocation: RecordedCommand = {
        command: last.command,
        args: last.args,
        cwd: Option.getOrUndefined(last.cwd)
      }
      const stdoutText = decideStdout(invocation)
      const stdout = stdoutText.length === 0 ? Stream.empty : Stream.succeed(encode(stdoutText))
      const failed = shouldFailGpuComposeUp && isDockerComposeUpAttempt(invocation)
      shouldFailGpuComposeUp = shouldFailGpuComposeUp && !failed
      const stderr = failed ? Stream.succeed(encode(gpuFailureStderr)) : Stream.empty

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(failed ? 1 : 0)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr,
        stdin: Sink.drain,
        stdout,
        toJSON: () => ({ _tag: "ProjectsUpTestProcess", command: invocation.command, args: invocation.args }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "ProjectsUpTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        toString: () => `[ProjectsUpTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

const makeTemplateConfig = (
  root: string,
  outDir: string,
  path: Path.Path,
  targetDir: string
): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2237,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  skipGithubAuth: false,
  targetDir,
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(outDir, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "project",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  gpu: "none",
  bunVersion: "1.3.11"
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const rewriteTargetDirInConfig = (source: string, targetDir: string): string => {
  const parsed: unknown = JSON.parse(source)
  if (!isRecord(parsed)) {
    throw new Error("invalid docker-git.json root")
  }
  const template = parsed["template"]
  if (!isRecord(template)) {
    throw new Error("invalid docker-git.json template")
  }
  const next = { ...parsed, template: { ...template, targetDir } }
  return `${JSON.stringify(next, null, 2)}\n`
}

describe("runDockerComposeUpWithPortCheck", () => {
  it.effect("auto-applies templates before docker compose up", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const initialTargetDir = "/home/dev/workspaces/org/repo"
        const updatedTargetDir = "/home/dev/workspaces/org/repo-updated"
        const globalConfig = makeTemplateConfig(root, outDir, path, initialTargetDir)
        const projectConfig = makeTemplateConfig(root, outDir, path, initialTargetDir)
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const configPath = path.join(outDir, "docker-git.json")
        const configBefore = yield* _(fs.readFileString(configPath))
        yield* _(fs.writeFileString(configPath, rewriteTargetDirInConfig(configBefore, updatedTargetDir)))
        yield* _(fs.writeFileString(path.join(outDir, "docker-compose.yml"), "# stale compose\n"))

        const updated = yield* _(
          runDockerComposeUpWithPortCheck(outDir).pipe(
            Effect.provideService(CommandExecutor.CommandExecutor, executor)
          )
        )

        expect(updated.targetDir).toBe(updatedTargetDir)
        expect(updated.cpuLimit).toBe("30%")
        expect(updated.ramLimit).toBe("30%")

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).toContain(`TARGET_DIR: "${updatedTargetDir}"`)
        expect(composeAfter).not.toContain("# stale compose")
        expect(composeAfter).toContain("cpus:")
        expect(composeAfter).toContain('mem_limit: "')

        const configAfter = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        expect(configAfter).toContain('"cpuLimit": "30%"')
        expect(configAfter).toContain('"ramLimit": "30%"')

        expect(recorded.some((entry) => isDockerComposePsFormatted(entry))).toBe(true)
        expect(recorded.some((entry) => isDockerVolumeCreate(entry))).toBe(true)
        expect(recorded.some((entry) => isBootstrapSeed(entry))).toBe(true)
        expect(recorded.some((entry) => isDockerComposeUpWithBuild(entry))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("falls back to GPU none when the host NVIDIA runtime is unavailable", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const targetDir = "/home/dev/workspaces/org/repo"
        const globalConfig = makeTemplateConfig(root, outDir, path, targetDir)
        const projectConfig: TemplateConfig = {
          ...makeTemplateConfig(root, outDir, path, targetDir),
          gpu: "all"
        }
        const recorded: Array<RecordedCommand> = []
        const logs: Array<string> = []
        const executor = makeFakeExecutor(recorded, { failGpuComposeUp: true })
        const logger = Logger.make(({ message }) => {
          logs.push(String(message))
        })

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const started = yield* _(
          runDockerComposeUpWithPortCheck(outDir).pipe(
            Effect.provideService(CommandExecutor.CommandExecutor, executor),
            Effect.provide(Logger.replace(Logger.defaultLogger, logger))
          )
        )

        expect(started.gpu).toBe("none")

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).not.toMatch(gpuAllComposeYamlPattern)

        const configAfter = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        expect(configAfter).toContain('"gpu": "none"')
        expect(recorded.filter((entry) => isDockerComposeUpWithBuild(entry)).length).toBe(2)
        expect(hasNvidiaFallbackWarning(logs, "libnvidia-ml.so.1")).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("falls back to GPU none on missing-device-driver NVIDIA runtime failure", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const targetDir = "/home/dev/workspaces/org/repo"
        const globalConfig = makeTemplateConfig(root, outDir, path, targetDir)
        const projectConfig: TemplateConfig = {
          ...makeTemplateConfig(root, outDir, path, targetDir),
          gpu: "all"
        }
        const recorded: Array<RecordedCommand> = []
        const logs: Array<string> = []
        const executor = makeFakeExecutor(recorded, {
          failGpuComposeUp: true,
          gpuFailureStderr: nvidiaMissingDeviceDriverFailure
        })
        const logger = Logger.make(({ message }) => {
          logs.push(String(message))
        })

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const started = yield* _(
          runDockerComposeUpWithPortCheck(outDir).pipe(
            Effect.provideService(CommandExecutor.CommandExecutor, executor),
            Effect.provide(Logger.replace(Logger.defaultLogger, logger))
          )
        )

        expect(started.gpu).toBe("none")

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).not.toMatch(gpuAllComposeYamlPattern)

        const configAfter = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        expect(configAfter).toContain('"gpu": "none"')
        expect(recorded.filter((entry) => isDockerComposeUpWithBuild(entry)).length).toBe(2)
        expect(hasNvidiaFallbackWarning(logs, "could not select device driver")).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it("keeps GPU access unchanged for arbitrary docker compose up failures", () => {
    expect(gpuModeAfterDockerFailure("all", arbitraryComposeFailure)).toBe("all")
    expect(gpuModeAfterDockerFailure("none", arbitraryComposeFailure)).toBe("none")
  })

  it("satisfies the GPU fallback classifier invariant", () => {
    const dockerFailureDetails = fc.oneof(
      fc.string(),
      fc
        .tuple(
          fc.string(),
          fc.constantFrom(nvidiaContainerCliMarker, libNvidiaMlMarker, missingDeviceDriverMarker),
          fc.string()
        )
        .map(([left, marker, right]) => `${left}${marker}${right}`)
    )

    fc.assert(
      fc.property(dockerFailureDetails, (details) => {
        const expectedGpu = containsNvidiaFailureMarker(details) ? "none" : "all"

        expect(gpuModeAfterDockerFailure("all", details)).toBe(expectedGpu)
        expect(gpuModeAfterDockerFailure("none", details)).toBe("none")
      }),
      { numRuns: 50 }
    )
  })

  it.effect("falls back to GPU none before retrying reuse mode when the host NVIDIA runtime is unavailable", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const targetDir = "/home/dev/workspaces/org/repo"
        const globalConfig = makeTemplateConfig(root, outDir, path, targetDir)
        const projectConfig: TemplateConfig = {
          ...makeTemplateConfig(root, outDir, path, targetDir),
          gpu: "all"
        }
        const recorded: Array<RecordedCommand> = []
        const logs: Array<string> = []
        const executor = makeFakeExecutor(recorded, { failGpuComposeUp: true })
        const logger = Logger.make(({ message }) => {
          logs.push(String(message))
        })

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const started = yield* _(
          runDockerComposeUpWithPortCheck(outDir, {
            buildMode: "reuse",
            waitForPostStart: false
          }).pipe(
            Effect.provideService(CommandExecutor.CommandExecutor, executor),
            Effect.provide(Logger.replace(Logger.defaultLogger, logger))
          )
        )

        expect(started.gpu).toBe("none")

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).not.toMatch(gpuAllComposeYamlPattern)

        const configAfter = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        expect(configAfter).toContain('"gpu": "none"')
        expect(recorded.filter((entry) => isDockerComposeUpReuse(entry)).length).toBe(2)
        expect(recorded.filter((entry) => isDockerComposeUpWithBuild(entry)).length).toBe(0)
        expect(hasNvidiaFallbackWarning(logs, "libnvidia-ml.so.1")).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("can reuse the existing image path for SSH-open cold start", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const targetDir = "/home/dev/workspaces/org/repo"
        const globalConfig = makeTemplateConfig(root, outDir, path, targetDir)
        const projectConfig = makeTemplateConfig(root, outDir, path, targetDir)
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        yield* _(
          runDockerComposeUpWithPortCheck(outDir, {
            buildMode: "reuse",
            waitForPostStart: false
          }).pipe(
            Effect.provideService(CommandExecutor.CommandExecutor, executor)
          )
        )

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).toContain(targetDir)
        expect(recorded.some((entry) => isDockerComposeUpReuse(entry))).toBe(true)
        expect(recorded.some((entry) => isDockerComposeUpWithBuild(entry))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("does not rebuild when prebuilt-image reuse compose up fails", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const targetDir = "/home/dev/workspaces/org/repo"
        const globalConfig = makeTemplateConfig(root, outDir, path, targetDir)
        const projectConfig: TemplateConfig = {
          ...makeTemplateConfig(root, outDir, path, targetDir),
          imageName: "docker-git-e2e-project:latest"
        }
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded, { failGpuComposeUp: true })

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, projectConfig, {
            force: false,
            forceEnv: false
          })
        )

        const result = yield* _(
          runDockerComposeUpWithPortCheck(outDir, {
            buildMode: "reuse",
            waitForPostStart: false
          }).pipe(
            Effect.provideService(CommandExecutor.CommandExecutor, executor),
            Effect.either
          )
        )

        expect(result._tag).toBe("Left")
        expect(recorded.filter((entry) => isDockerComposeUpReuse(entry)).length).toBe(1)
        expect(recorded.some((entry) => isDockerComposeUpWithBuild(entry))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})

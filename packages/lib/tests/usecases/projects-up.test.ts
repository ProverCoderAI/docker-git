import * as Command from "@effect/platform/Command"
import * as CommandExecutor from "@effect/platform/CommandExecutor"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as Inspectable from "effect/Inspectable"
import * as Sink from "effect/Sink"
import * as Stream from "effect/Stream"

import type { TemplateConfig } from "../../src/core/domain.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"
import { runDockerComposeUpWithPortCheck } from "../../src/usecases/projects-up.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
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

const isDockerComposeUp = (cmd: RecordedCommand): boolean =>
  cmd.command === "docker" &&
  includesArgsInOrder(cmd.args, ["compose", "--ansi", "never", "--progress", "plain", "up", "-d", "--build"])

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

const makeFakeExecutor = (recorded: Array<RecordedCommand>): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({ command: entry.command, args: entry.args })
      }

      const last = flattened[flattened.length - 1]!
      const invocation: RecordedCommand = { command: last.command, args: last.args }
      const stdoutText = decideStdout(invocation)
      const stdout = stdoutText.length === 0 ? Stream.empty : Stream.succeed(encode(stdoutText))

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(0)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
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
  pnpmVersion: "10.27.0"
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
        expect(recorded.some((entry) => isDockerComposeUp(entry))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})

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

import type { CreateCommand, TemplateConfig } from "../../src/core/domain.js"
import { createProject } from "../../src/usecases/actions/create-project.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-open-ssh-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const encode = (value: string): Uint8Array => new TextEncoder().encode(value)

const commandIncludes = (args: ReadonlyArray<string>, needle: string): boolean => args.includes(needle)

const decideExitCode = (cmd: RecordedCommand): number => {
  if (cmd.command === "git" && cmd.args[0] === "rev-parse") {
    // Auto-sync should detect "not a repo" and exit early.
    return 1
  }

  if (cmd.command === "docker" && cmd.args[0] === "exec") {
    if (commandIncludes(cmd.args, "/run/docker-git/clone.failed")) {
      return 1
    }
    if (commandIncludes(cmd.args, "/run/docker-git/clone.done")) {
      return 0
    }
  }

  return 0
}

const decideStdout = (cmd: RecordedCommand): string => {
  if (cmd.command === "docker" && cmd.args[0] === "inspect") {
    // Keep it empty so ensureDockerDnsHost skips /etc/hosts modifications in tests.
    return ""
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

      const last = flattened[flattened.length - 1]
      const invocation: RecordedCommand = { command: last.command, args: last.args }
      const exit = decideExitCode(invocation)
      const stdoutText = decideStdout(invocation)
      const stdout = stdoutText.length === 0 ? Stream.empty : Stream.succeed(encode(stdoutText))

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(exit)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout,
        toJSON: () => ({ _tag: "TestProcess", command: invocation.command, args: invocation.args, exit }),
        [Inspectable.NodeInspectSymbol]: () => ({ _tag: "TestProcess", command: invocation.command, args: invocation.args }),
        toString: () => `[TestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

const makeCommand = (root: string, outDir: string, path: Path.Path): CreateCommand => {
  const template: TemplateConfig = {
    containerName: "dg-test",
    serviceName: "dg-test",
    sshUser: "dev",
    sshPort: 2222,
    repoUrl: "https://github.com/org/repo.git",
    repoRef: "main",
    targetDir: "/home/dev/org/repo",
    volumeName: "dg-test-home",
    dockerGitPath: path.join(root, ".docker-git"),
    authorizedKeysPath: path.join(root, "authorized_keys"),
    envGlobalPath: path.join(root, ".orch/env/global.env"),
    envProjectPath: path.join(root, ".orch/env/project.env"),
    codexAuthPath: path.join(root, ".orch/auth/codex"),
    codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
    codexHome: "/home/dev/.codex",
    enableMcpPlaywright: false,
    pnpmVersion: "10.27.0"
  }

  return {
    _tag: "Create",
    config: template,
    outDir,
    runUp: true,
    openSsh: true,
    force: true,
    forceEnv: false,
    waitForClone: true
  }
}

describe("createProject (openSsh)", () => {
  it.effect("runs ssh after clone completion when openSsh=true", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const path = yield* _(Path.Path)

        const outDir = path.join(root, "project")
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)
        const command = makeCommand(root, outDir, path)

        const prevProjectsRoot = process.env["DOCKER_GIT_PROJECTS_ROOT"]
        const prevStdinTty = process.stdin.isTTY
        const prevStdoutTty = process.stdout.isTTY

        process.env["DOCKER_GIT_PROJECTS_ROOT"] = path.join(root, "state")
        Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true })
        Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true })

        try {
          yield* _(createProject(command).pipe(Effect.provideService(CommandExecutor.CommandExecutor, executor)))
        } finally {
          if (prevProjectsRoot === undefined) {
            delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
          } else {
            process.env["DOCKER_GIT_PROJECTS_ROOT"] = prevProjectsRoot
          }
          Object.defineProperty(process.stdin, "isTTY", { value: prevStdinTty, configurable: true })
          Object.defineProperty(process.stdout, "isTTY", { value: prevStdoutTty, configurable: true })
        }

        const sshInvocations = recorded.filter((entry) => entry.command === "ssh")
        expect(sshInvocations).toHaveLength(1)
        const ssh = sshInvocations[0]!
        expect(ssh.args).toContain("-p")
        expect(ssh.args).toContain("2222")
        expect(ssh.args).toContain("dev@localhost")

        const cloneDoneIndex = recorded.findIndex(
          (entry) => entry.command === "docker" && entry.args[0] === "exec" && entry.args.includes("/run/docker-git/clone.done")
        )
        const sshIndex = recorded.findIndex((entry) => entry.command === "ssh")
        expect(cloneDoneIndex).toBeGreaterThanOrEqual(0)
        expect(sshIndex).toBeGreaterThan(cloneDoneIndex)
      })
    )
      .pipe(Effect.provide(NodeContext.layer))
  )
})

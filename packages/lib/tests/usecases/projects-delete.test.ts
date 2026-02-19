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

import type { ProjectItem } from "../../src/usecases/projects-core.js"
import { deleteDockerGitProject } from "../../src/usecases/projects-delete.js"

type RecordedCommand = {
  readonly command: string
  readonly args: ReadonlyArray<string>
}

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

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-delete-project-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withProjectsRootEnv = <A, E, R>(
  projectsRoot: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.acquireRelease(
      Effect.sync(() => {
        const prev = process.env["DOCKER_GIT_PROJECTS_ROOT"]
        process.env["DOCKER_GIT_PROJECTS_ROOT"] = projectsRoot
        return prev
      }),
      (prev) =>
        Effect.sync(() => {
          if (prev === undefined) {
            delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
          } else {
            process.env["DOCKER_GIT_PROJECTS_ROOT"] = prev
          }
        })
    ).pipe(Effect.flatMap(() => effect))
  )

const makeProjectItem = (root: string, path: Path.Path): ProjectItem => {
  const projectDir = path.join(root, "org", "repo")
  return {
    projectDir,
    displayName: "org/repo",
    repoUrl: "https://github.com/org/repo.git",
    repoRef: "main",
    containerName: "dg-org-repo",
    serviceName: "dg-org-repo",
    sshUser: "dev",
    sshPort: 2222,
    targetDir: "/home/dev/org/repo",
    sshCommand: "ssh -p 2222 dev@localhost",
    sshKeyPath: null,
    authorizedKeysPath: path.join(root, "authorized_keys"),
    authorizedKeysExists: false,
    envGlobalPath: path.join(root, ".orch/env/global.env"),
    envProjectPath: path.join(projectDir, ".orch/env/project.env"),
    codexAuthPath: path.join(projectDir, ".orch/auth/codex"),
    codexHome: "/home/dev/.codex"
  }
}

const makeFakeExecutor = (
  recorded: Array<RecordedCommand>,
  failComposeDownVolumes: boolean
): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({ command: entry.command, args: entry.args })
      }

      const last = flattened[flattened.length - 1]!
      const shouldFailComposeDownVolumes = failComposeDownVolumes &&
        last.command === "docker" &&
        includesArgsInOrder(last.args, ["compose", "down", "-v"])
      const exit = shouldFailComposeDownVolumes ? 1 : 0

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(CommandExecutor.ExitCode(exit)),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout: Stream.empty,
        toJSON: () => ({ _tag: "DeleteProjectTestProcess", command: last.command, args: last.args, exit }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "DeleteProjectTestProcess",
          command: last.command,
          args: last.args
        }),
        toString: () => `[DeleteProjectTestProcess ${last.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

describe("deleteDockerGitProject", () => {
  it.effect("runs docker compose down -v before deleting the project directory", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const item = makeProjectItem(root, path)
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded, false)

        yield* _(fs.makeDirectory(item.projectDir, { recursive: true }))

        yield* _(
          withProjectsRootEnv(
            root,
            deleteDockerGitProject(item).pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, executor)
            )
          )
        )

        const existsAfter = yield* _(fs.exists(item.projectDir))
        expect(existsAfter).toBe(false)
        expect(
          recorded.some(
            (entry) =>
              entry.command === "docker" &&
              includesArgsInOrder(entry.args, ["compose", "down", "-v"])
          )
        ).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("falls back to docker rm -f when docker compose down -v fails", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const item = makeProjectItem(root, path)
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded, true)

        yield* _(fs.makeDirectory(item.projectDir, { recursive: true }))

        yield* _(
          withProjectsRootEnv(
            root,
            deleteDockerGitProject(item).pipe(
              Effect.provideService(CommandExecutor.CommandExecutor, executor)
            )
          )
        )

        const existsAfter = yield* _(fs.exists(item.projectDir))
        expect(existsAfter).toBe(false)

        const rmInvocations = recorded.filter(
          (entry) =>
            entry.command === "docker" &&
            entry.args[0] === "rm" &&
            entry.args[1] === "-f"
        )
        expect(rmInvocations.map((entry) => entry.args[2])).toContain(item.containerName)
        expect(rmInvocations.map((entry) => entry.args[2])).toContain(`${item.containerName}-browser`)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})

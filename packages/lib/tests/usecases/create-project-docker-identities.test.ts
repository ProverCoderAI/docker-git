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
import { vi } from "vitest"

import type { CreateCommand, TemplateConfig } from "../../src/core/domain.js"
import { DockerIdentityConflictError } from "../../src/shell/errors.js"
import { createProject } from "../../src/usecases/actions/create-project.js"

vi.mock("../../src/usecases/actions/ports.js", () => ({
  resolveSshPort: (config: CreateCommand["config"]) => Effect.succeed(config)
}))

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
          prefix: "docker-git-create-identities-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const withWorkingDirectory = <A, E, R>(
  cwd: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.cwd()
      process.chdir(cwd)
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        process.chdir(previous)
      })
  )

const withProjectsRoot = <A, E, R>(
  projectsRoot: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = process.env["DOCKER_GIT_PROJECTS_ROOT"]
      process.env["DOCKER_GIT_PROJECTS_ROOT"] = projectsRoot
      return previous
    }),
    () => effect,
    (previous) =>
      Effect.sync(() => {
        if (previous === undefined) {
          delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
          return
        }
        process.env["DOCKER_GIT_PROJECTS_ROOT"] = previous
      })
  )

const makeFakeExecutor = (recorded: Array<RecordedCommand>): CommandExecutor.CommandExecutor => {
  const start = (command: Command.Command): Effect.Effect<CommandExecutor.Process, never> =>
    Effect.gen(function*(_) {
      const flattened = Command.flatten(command)
      for (const entry of flattened) {
        recorded.push({ command: entry.command, args: entry.args })
      }

      const invocation = flattened[flattened.length - 1]!
      const exitCode =
        invocation.command === "git" && invocation.args[0] === "rev-parse"
          ? CommandExecutor.ExitCode(1)
          : CommandExecutor.ExitCode(0)

      const process: CommandExecutor.Process = {
        [CommandExecutor.ProcessTypeId]: CommandExecutor.ProcessTypeId,
        pid: CommandExecutor.ProcessId(1),
        exitCode: Effect.succeed(exitCode),
        isRunning: Effect.succeed(false),
        kill: (_signal) => Effect.void,
        stderr: Stream.empty,
        stdin: Sink.drain,
        stdout: Stream.empty,
        toJSON: () => ({ _tag: "CreateProjectDockerIdentitiesTestProcess", command: invocation.command, args: invocation.args }),
        [Inspectable.NodeInspectSymbol]: () => ({
          _tag: "CreateProjectDockerIdentitiesTestProcess",
          command: invocation.command,
          args: invocation.args
        }),
        toString: () => `[CreateProjectDockerIdentitiesTestProcess ${invocation.command}]`
      }

      return process
    })

  return CommandExecutor.makeExecutor(start)
}

const makeTemplate = (
  root: string,
  repoUrl: string,
  path: Path.Path
): TemplateConfig => ({
  containerName: "dg-openclaw_autodeployer",
  serviceName: "dg-openclaw_autodeployer",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl,
  repoRef: "main",
  skipGithubAuth: true,
  targetDir: "/home/dev/workspaces/openclaw_autodeployer",
  volumeName: "dg-openclaw_autodeployer-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch", "env", "global.env"),
  envProjectPath: path.join(root, ".orch", "env", "project.env"),
  codexAuthPath: path.join(root, ".orch", "auth", "codex"),
  codexSharedAuthPath: path.join(root, ".orch", "auth", "codex-shared"),
  codexHome: "/home/dev/.codex",
  geminiAuthPath: path.join(root, ".orch", "auth", "gemini"),
  geminiHome: "/home/dev/.gemini",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: true,
  pnpmVersion: "10.27.0"
})

const makeCommand = (
  root: string,
  outDir: string,
  repoUrl: string,
  path: Path.Path,
  force: boolean
): CreateCommand => ({
  _tag: "Create",
  config: makeTemplate(root, repoUrl, path),
  outDir,
  runUp: false,
  openSsh: false,
  force,
  forceEnv: false,
  waitForClone: false
})

const runCreate = (
  cwd: string,
  projectsRoot: string,
  command: CreateCommand,
  executor: CommandExecutor.CommandExecutor
) =>
  withProjectsRoot(
    projectsRoot,
    withWorkingDirectory(
      cwd,
      createProject(command).pipe(
        Effect.provideService(CommandExecutor.CommandExecutor, executor)
      )
    )
  )

describe("createProject docker identity invariants", () => {
  it.effect("rejects a second project with the same docker identities without force", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)
        const firstOutDir = path.join(projectsRoot, "telegramgpt", "openclaw_autodeployer")
        const secondOutDir = path.join(projectsRoot, "testorganization123213", "openclaw_autodeployer")

        yield* _(
          runCreate(
            root,
            projectsRoot,
            makeCommand(root, firstOutDir, "https://git.example.test/test-owner-a/openclaw_autodeployer.git", path, false),
            executor
          )
        )

        const error = yield* _(
          runCreate(
            root,
            projectsRoot,
            makeCommand(
              root,
              secondOutDir,
              "https://git.example.test/test-owner-b/openclaw_autodeployer.git",
              path,
              false
            ),
            executor
          ).pipe(Effect.flip)
        )

        expect(error).toBeInstanceOf(DockerIdentityConflictError)
        if (error instanceof DockerIdentityConflictError) {
          expect(error.conflicts.map((conflict) => conflict.name)).toContain("dg-openclaw_autodeployer")
          expect(error.conflicts.map((conflict) => conflict.conflictingProjectDir)).toContain(firstOutDir)
        }

        expect(yield* _(fs.exists(secondOutDir))).toBe(false)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("force replaces the conflicting project and keeps docker identities unique", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)
        const firstOutDir = path.join(projectsRoot, "telegramgpt", "openclaw_autodeployer")
        const secondOutDir = path.join(projectsRoot, "testorganization123213", "openclaw_autodeployer")

        yield* _(
          runCreate(
            root,
            projectsRoot,
            makeCommand(root, firstOutDir, "https://git.example.test/test-owner-a/openclaw_autodeployer.git", path, false),
            executor
          )
        )

        yield* _(
          runCreate(
            root,
            projectsRoot,
            makeCommand(
              root,
              secondOutDir,
              "https://git.example.test/test-owner-b/openclaw_autodeployer.git",
              path,
              true
            ),
            executor
          )
        )

        expect(yield* _(fs.exists(firstOutDir))).toBe(false)
        expect(yield* _(fs.exists(secondOutDir))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))

  it.effect("force still allows recreating the same project directory in place", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const projectsRoot = path.join(root, ".docker-git")
        const recorded: Array<RecordedCommand> = []
        const executor = makeFakeExecutor(recorded)
        const outDir = path.join(projectsRoot, "telegramgpt", "openclaw_autodeployer")

        yield* _(
          runCreate(
            root,
            projectsRoot,
            makeCommand(root, outDir, "https://git.example.test/test-owner-a/openclaw_autodeployer.git", path, false),
            executor
          )
        )

        yield* _(
          runCreate(
            root,
            projectsRoot,
            makeCommand(root, outDir, "https://git.example.test/test-owner-a/openclaw_autodeployer.git", path, true),
            executor
          )
        )

        expect(yield* _(fs.exists(path.join(outDir, "docker-git.json")))).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})

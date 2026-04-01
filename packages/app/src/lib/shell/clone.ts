import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { type CloneRequest, resolveCloneRequest } from "../core/clone.js"
import { runCommandWithExitCodes } from "./command-runner.js"
import { CommandFailedError } from "./errors.js"

const successExitCode = Number(ExitCode(0))

// CHANGE: read shortcut requests from process argv and npm lifecycle metadata
// WHY: allow pnpm run clone/open <url> to work without "--"
// QUOTE(ТЗ): "Добавить команду open. ... Просто открывает существующий по ссылке"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall env: read(env) -> deterministic(request)
// PURITY: SHELL
// EFFECT: Effect<CloneRequest, never, never>
// INVARIANT: only argv/env are read
// COMPLEXITY: O(n)
export const readCloneRequest: Effect.Effect<CloneRequest> = Effect.sync(() =>
  resolveCloneRequest(process.argv.slice(2), process.env["npm_lifecycle_event"])
)

const runDockerGitCommand = (
  commandName: "clone" | "open",
  args: ReadonlyArray<string>
): Effect.Effect<
  void,
  CommandFailedError | PlatformError,
  CommandExecutor.CommandExecutor | Path.Path
> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const workspaceRoot = process.cwd()
    const appRoot = path.join(workspaceRoot, "packages", "app")
    const dockerGitCli = path.join(appRoot, "dist", "src", "docker-git", "main.js")
    const buildLabel = `pnpm -C ${appRoot} build:docker-git`
    const runLabel = `node ${dockerGitCli} ${commandName}`

    yield* _(
      runCommandWithExitCodes(
        { cwd: workspaceRoot, command: "pnpm", args: ["-C", appRoot, "build:docker-git"] },
        [successExitCode],
        (exitCode) => new CommandFailedError({ command: buildLabel, exitCode })
      )
    )
    yield* _(
      runCommandWithExitCodes(
        { cwd: workspaceRoot, command: "node", args: [dockerGitCli, commandName, ...args] },
        [successExitCode],
        (exitCode) => new CommandFailedError({ command: runLabel, exitCode })
      )
    )
  })

// CHANGE: run docker-git clone by building and invoking its CLI
// WHY: reuse docker-git without mutating its codebase
// QUOTE(ТЗ): "docker git мы никак не изменяем"
// REF: user-request-2026-01-27
// SOURCE: n/a
// FORMAT THEOREM: forall args: build && run(args) -> docker_git_invoked(args)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor | Path>
// INVARIANT: build runs before clone command
// COMPLEXITY: O(build + clone)
export const runDockerGitClone = (
  args: ReadonlyArray<string>
): Effect.Effect<
  void,
  CommandFailedError | PlatformError,
  CommandExecutor.CommandExecutor | Path.Path
> => runDockerGitCommand("clone", args)

// CHANGE: run docker-git open by building and invoking its CLI
// WHY: mirror clone shortcut behavior for opening an existing repo workspace
// QUOTE(ТЗ): "Добавить команду open. ... Просто открывает существующий по ссылке"
// REF: user-request-2026-02-20-open-command
// SOURCE: n/a
// FORMAT THEOREM: forall args: build && run(args) -> docker_git_open_invoked(args)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor | Path>
// INVARIANT: build runs before open command
// COMPLEXITY: O(build + open)
export const runDockerGitOpen = (
  args: ReadonlyArray<string>
): Effect.Effect<
  void,
  CommandFailedError | PlatformError,
  CommandExecutor.CommandExecutor | Path.Path
> => runDockerGitCommand("open", args)

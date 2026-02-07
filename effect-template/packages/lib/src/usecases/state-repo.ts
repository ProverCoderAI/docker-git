import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { defaultProjectsRoot } from "./menu-helpers.js"
import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "../shell/command-runner.js"
import { CommandFailedError } from "../shell/errors.js"

const successExitCode = Number(ExitCode(0))

const gitEnv: Readonly<Record<string, string>> = {
  // Avoid blocking on interactive credential prompts in CI / TUI contexts.
  GIT_TERMINAL_PROMPT: "0"
}

const resolveStateRoot = (
  path: Path.Path,
  cwd: string
): string => path.resolve(defaultProjectsRoot(cwd))

// CHANGE: manage docker-git state dir as a git repository
// WHY: allow sharing docker-git state across machines using a private git repo
// QUOTE(ТЗ): "общая память через гит" / "иметь возможность комитить его на гит"
// REF: user-request-2026-02-07-state-repo
// SOURCE: n/a
// FORMAT THEOREM: forall op: state(op) -> deterministic(root)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: never deletes user data; only runs git commands in the state root
// COMPLEXITY: O(command)

export const statePath: Effect.Effect<void, PlatformError, Path.Path> =
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const cwd = process.cwd()
    const root = resolveStateRoot(path, cwd)
    yield* _(Effect.log(root))
  }).pipe(Effect.asVoid)

const git = (
  cwd: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    { cwd, command: "git", args, env: gitEnv },
    [successExitCode],
    (exitCode) => new CommandFailedError({ command: `git ${args[0] ?? ""}`, exitCode })
  )

const gitExitCode = (
  cwd: string,
  args: ReadonlyArray<string>
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({ cwd, command: "git", args, env: gitEnv })

const gitCapture = (
  cwd: string,
  args: ReadonlyArray<string>
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    { cwd, command: "git", args, env: gitEnv },
    [successExitCode],
    (exitCode) => new CommandFailedError({ command: `git ${args[0] ?? ""}`, exitCode })
  )

export const stateInit = (
  input: {
    readonly repoUrl: string
    readonly repoRef: string
  }
): Effect.Effect<void, CommandFailedError | PlatformError, FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const cwd = process.cwd()
    const root = resolveStateRoot(path, cwd)

    yield* _(fs.makeDirectory(root, { recursive: true }))

    const gitDir = path.join(root, ".git")
    const hasGit = yield* _(fs.exists(gitDir))
    if (!hasGit) {
      const entries = yield* _(fs.readDirectory(root))
      if (entries.length === 0) {
        const cloneArgs = ["clone", "--branch", input.repoRef, input.repoUrl, root]
        yield* _(
          runCommandWithExitCodes(
            { cwd: root, command: "git", args: cloneArgs, env: gitEnv },
            [successExitCode],
            (exitCode) => new CommandFailedError({ command: "git clone", exitCode })
          )
        )
        yield* _(Effect.log(`State dir cloned: ${root}`))
        yield* _(Effect.log(`Remote: ${input.repoUrl}`))
        return
      }

      yield* _(git(root, ["init"]))
    }

    const setUrlExit = yield* _(gitExitCode(root, ["remote", "set-url", "origin", input.repoUrl]))
    if (setUrlExit !== successExitCode) {
      yield* _(git(root, ["remote", "add", "origin", input.repoUrl]))
    }

    // Best-effort: ensure the local branch exists and can be tracked later.
    const checkoutExit = yield* _(gitExitCode(root, ["checkout", "-B", input.repoRef]))
    if (checkoutExit !== successExitCode) {
      yield* _(Effect.logWarning(`git checkout -B ${input.repoRef} failed (exit ${checkoutExit})`))
    }

    yield* _(Effect.log(`State dir ready: ${root}`))
    yield* _(Effect.log(`Remote: ${input.repoUrl}`))
  }).pipe(Effect.asVoid)

export const stateStatus = Effect.gen(function*(_) {
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const output = yield* _(gitCapture(root, ["status", "-sb", "--porcelain=v1"]))
  yield* _(Effect.log(output.trim().length > 0 ? output.trimEnd() : "(clean)"))
}).pipe(Effect.asVoid)

export const statePull = Effect.gen(function*(_) {
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  yield* _(git(root, ["pull", "--rebase"]))
}).pipe(Effect.asVoid)

export const statePush = Effect.gen(function*(_) {
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  yield* _(git(root, ["push", "-u", "origin", "HEAD"]))
}).pipe(Effect.asVoid)

export const stateCommit = (
  message: string
): Effect.Effect<void, CommandFailedError | PlatformError, Path.Path | CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, process.cwd())

    yield* _(git(root, ["add", "-A"]))
    const diffExit = yield* _(gitExitCode(root, ["diff", "--cached", "--quiet"]))

    if (diffExit === successExitCode) {
      yield* _(Effect.log("Nothing to commit."))
      return
    }

    yield* _(git(root, ["commit", "-m", message]))
  }).pipe(Effect.asVoid)

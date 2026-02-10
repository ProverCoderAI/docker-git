import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import { ExitCode } from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"
import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "../../shell/command-runner.js"
import { CommandFailedError } from "../../shell/errors.js"

export const successExitCode = Number(ExitCode(0))

export const gitBaseEnv: Readonly<Record<string, string>> = {
  // Avoid blocking on interactive credential prompts in CI / TUI contexts.
  GIT_TERMINAL_PROMPT: "0"
}

export const git = (
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>> = gitBaseEnv
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    { cwd, command: "git", args, env },
    [successExitCode],
    (exitCode) => new CommandFailedError({ command: `git ${args[0] ?? ""}`, exitCode })
  )

export const gitExitCode = (
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>> = gitBaseEnv
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandExitCode({ cwd, command: "git", args, env })

export const gitCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  env: Readonly<Record<string, string | undefined>> = gitBaseEnv
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandCapture(
    { cwd, command: "git", args, env },
    [successExitCode],
    (exitCode) => new CommandFailedError({ command: `git ${args[0] ?? ""}`, exitCode })
  )

export const isGitRepo = (root: string) =>
  Effect.map(gitExitCode(root, ["rev-parse", "--is-inside-work-tree"]), (exit) => exit === successExitCode)

export const hasOriginRemote = (root: string) =>
  Effect.map(gitExitCode(root, ["remote", "get-url", "origin"]), (exit) => exit === successExitCode)

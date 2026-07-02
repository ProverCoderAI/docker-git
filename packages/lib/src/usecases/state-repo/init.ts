import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { runCommandExitCode } from "../../shell/command-runner.js"
import { CommandFailedError } from "../../shell/errors.js"
import { defaultProjectsRoot } from "../menu-helpers.js"
import { adoptRemoteHistoryIfOrphan } from "./adopt-remote.js"
import { selectStateInitEffect } from "./auth-effects.js"
import { git, gitExitCode, successExitCode } from "./git-commands.js"
import type { GitAuthEnv } from "./github-auth.js"
import { ensureStateGitignore } from "./gitignore.js"

type StateRepoEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

export type StateInitInput = {
  readonly repoUrl: string
  readonly repoRef: string
  readonly token?: string
}

const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))

const cloneStateRepo = (
  root: string,
  input: StateInitInput,
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const cloneWithBranch = ["clone", "--branch", input.repoRef, input.repoUrl, root]
    const cloneBranchExit = yield* _(
      runCommandExitCode({ cwd: root, command: "git", args: cloneWithBranch, env })
    )
    if (cloneBranchExit === successExitCode) {
      return
    }

    // Empty remotes and remotes without the requested branch can fail here.
    yield* _(
      Effect.logWarning(
        `git clone --branch ${input.repoRef} failed (exit ${cloneBranchExit}); retrying without --branch`
      )
    )
    const cloneDefault = ["clone", input.repoUrl, root]
    const cloneDefaultExit = yield* _(
      runCommandExitCode({ cwd: root, command: "git", args: cloneDefault, env })
    )
    if (cloneDefaultExit !== successExitCode) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "git clone", exitCode: cloneDefaultExit })))
    }
  }).pipe(Effect.asVoid)

const initRepoIfNeeded = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  input: StateInitInput,
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    yield* _(fs.makeDirectory(root, { recursive: true }))

    const gitDir = path.join(root, ".git")
    const hasGit = yield* _(fs.exists(gitDir))
    if (hasGit) {
      return
    }

    const entries = yield* _(fs.readDirectory(root))
    if (entries.length === 0) {
      yield* _(cloneStateRepo(root, input, env))
      yield* _(Effect.log("State dir cloned."))
      return
    }

    yield* _(git(root, ["init", "--initial-branch=main"], env))
  }).pipe(Effect.asVoid)

const ensureOriginRemote = (
  root: string,
  repoUrl: string,
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const urlExitCode = yield* _(gitExitCode(root, ["remote", "set-url", "origin", repoUrl], env))
    if (urlExitCode === successExitCode) {
      return
    }
    yield* _(git(root, ["remote", "add", "origin", repoUrl], env))
  })

const checkoutBranchBestEffort = (
  root: string,
  repoRef: string,
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const checkoutExit = yield* _(gitExitCode(root, ["checkout", "-B", repoRef], env))
    if (checkoutExit === successExitCode) {
      return
    }
    yield* _(Effect.logWarning(`git checkout -B ${repoRef} failed (exit ${checkoutExit})`))
  })

export const stateInitRaw = (
  input: StateInitInput,
  cwd: string
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> => {
  const doInit = (env: GitAuthEnv) =>
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const path = yield* _(Path.Path)
      const root = resolveStateRoot(path, cwd)

      yield* _(initRepoIfNeeded(fs, path, root, input, env))
      yield* _(ensureOriginRemote(root, input.repoUrl, env))
      yield* _(adoptRemoteHistoryIfOrphan(root, input.repoRef, env))
      yield* _(checkoutBranchBestEffort(root, input.repoRef, env))
      yield* _(ensureStateGitignore(fs, path, root))

      yield* _(Effect.log("State dir ready."))
      yield* _(Effect.log("Remote configured."))
    }).pipe(Effect.asVoid)

  const token = input.token?.trim() ?? ""
  return selectStateInitEffect(input.repoUrl, token, doInit)
}

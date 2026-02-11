import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import { runCommandExitCode } from "../shell/command-runner.js"
import { CommandFailedError } from "../shell/errors.js"
import { defaultProjectsRoot } from "./menu-helpers.js"
import { autoSyncEnvKey, autoSyncStrictEnvKey, isAutoSyncEnabled, isTruthyEnv } from "./state-repo/env.js"
import {
  git,
  gitBaseEnv,
  gitCapture,
  gitExitCode,
  hasOriginRemote,
  isGitRepo,
  successExitCode
} from "./state-repo/git-commands.js"
import { isGithubHttpsRemote, resolveGithubToken, withGithubAskpassEnv } from "./state-repo/github-auth.js"
import { ensureStateGitignore } from "./state-repo/gitignore.js"
import { runStateSyncOps, runStateSyncWithToken } from "./state-repo/sync-ops.js"

type StateRepoEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))

export const statePath: Effect.Effect<void, PlatformError, Path.Path> = Effect.gen(function*(_) {
  const path = yield* _(Path.Path)
  const cwd = process.cwd()
  const root = resolveStateRoot(path, cwd)
  yield* _(Effect.log(root))
}).pipe(Effect.asVoid)

export const stateSync = (
  message: string | null
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, process.cwd())

    const repoExit = yield* _(gitExitCode(root, ["rev-parse", "--is-inside-work-tree"], gitBaseEnv))
    if (repoExit !== successExitCode) {
      yield* _(Effect.logWarning(`State dir is not a git repository: ${root}`))
      yield* _(Effect.logWarning(`Run: docker-git state init --repo-url <url>`))
      return yield* _(
        Effect.fail(new CommandFailedError({ command: "git rev-parse --is-inside-work-tree", exitCode: repoExit }))
      )
    }

    const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
    if (originUrlExit !== successExitCode) {
      yield* _(Effect.logWarning(`State dir has no origin remote: ${root}`))
      yield* _(Effect.logWarning(`Run: docker-git state init --repo-url <url>`))
      return yield* _(
        Effect.fail(new CommandFailedError({ command: "git remote get-url origin", exitCode: originUrlExit }))
      )
    }
    const originUrl = yield* _(
      gitCapture(root, ["remote", "get-url", "origin"], gitBaseEnv).pipe(Effect.map((value) => value.trim()))
    )
    const token = yield* _(resolveGithubToken(fs, path, root))
    const syncEffect = token && token.length > 0 && isGithubHttpsRemote(originUrl)
      ? runStateSyncWithToken(token, root, originUrl, message)
      : runStateSyncOps(root, originUrl, message, gitBaseEnv)

    yield* _(syncEffect)
  }).pipe(Effect.asVoid)

export const autoSyncState = (message: string): Effect.Effect<void, never, StateRepoEnv> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, process.cwd())

    const repoOk = yield* _(isGitRepo(root))
    if (!repoOk) {
      return
    }

    const originOk = yield* _(hasOriginRemote(root))
    const enabled = isAutoSyncEnabled(process.env[autoSyncEnvKey], originOk)
    if (!enabled) {
      return
    }

    const strictValue = process.env[autoSyncStrictEnvKey]
    const strict = strictValue !== undefined && strictValue.trim().length > 0 ? isTruthyEnv(strictValue) : false
    const effect = stateSync(message)
    if (strict) {
      yield* _(effect)
      return
    }
    yield* _(
      effect.pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            Effect.logWarning(
              `State auto-sync failed: ${
                error._tag === "CommandFailedError"
                  ? `${error.command} (exit ${error.exitCode})`
                  : String(error)
              }`
            ),
          onSuccess: () => Effect.void
        })
      )
    )
  }).pipe(
    Effect.matchEffect({
      onFailure: (error) => Effect.logWarning(`State auto-sync failed: ${String(error)}`),
      onSuccess: () => Effect.void
    }),
    Effect.asVoid
  )

type StateInitInput = {
  readonly repoUrl: string
  readonly repoRef: string
}

const cloneStateRepo = (
  root: string,
  input: StateInitInput
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const cloneWithBranch = ["clone", "--branch", input.repoRef, input.repoUrl, root]
    const cloneBranchExit = yield* _(
      runCommandExitCode({ cwd: root, command: "git", args: cloneWithBranch, env: gitBaseEnv })
    )
    if (cloneBranchExit === successExitCode) {
      return
    }

    // Empty remotes (no branch yet) and remotes without the requested branch can fail here.
    // Fall back to cloning the default branch so we can still set up the repo and create the branch locally.
    yield* _(
      Effect.logWarning(
        `git clone --branch ${input.repoRef} failed (exit ${cloneBranchExit}); retrying without --branch`
      )
    )
    const cloneDefault = ["clone", input.repoUrl, root]
    const cloneDefaultExit = yield* _(
      runCommandExitCode({ cwd: root, command: "git", args: cloneDefault, env: gitBaseEnv })
    )
    if (cloneDefaultExit !== successExitCode) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "git clone", exitCode: cloneDefaultExit })))
    }
  }).pipe(Effect.asVoid)

const initRepoIfNeeded = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string,
  input: StateInitInput
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
      yield* _(cloneStateRepo(root, input))
      yield* _(Effect.log(`State dir cloned: ${root}`))
      return
    }

    yield* _(git(root, ["init"], gitBaseEnv))
  }).pipe(Effect.asVoid)

const ensureOriginRemote = (
  root: string,
  repoUrl: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const setUrlExit = yield* _(gitExitCode(root, ["remote", "set-url", "origin", repoUrl], gitBaseEnv))
    if (setUrlExit === successExitCode) {
      return
    }
    yield* _(git(root, ["remote", "add", "origin", repoUrl], gitBaseEnv))
  })

const checkoutBranchBestEffort = (
  root: string,
  repoRef: string
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const checkoutExit = yield* _(gitExitCode(root, ["checkout", "-B", repoRef], gitBaseEnv))
    if (checkoutExit === successExitCode) {
      return
    }
    yield* _(Effect.logWarning(`git checkout -B ${repoRef} failed (exit ${checkoutExit})`))
  })

export const stateInit = (
  input: StateInitInput
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, process.cwd())

    yield* _(initRepoIfNeeded(fs, path, root, input))
    yield* _(ensureOriginRemote(root, input.repoUrl))
    yield* _(checkoutBranchBestEffort(root, input.repoRef))
    yield* _(ensureStateGitignore(fs, path, root))

    yield* _(Effect.log(`State dir ready: ${root}`))
    yield* _(Effect.log(`Remote: ${input.repoUrl}`))
  }).pipe(Effect.asVoid)

export const stateStatus = Effect.gen(function*(_) {
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const output = yield* _(gitCapture(root, ["status", "-sb", "--porcelain=v1"], gitBaseEnv))
  yield* _(Effect.log(output.trim().length > 0 ? output.trimEnd() : "(clean)"))
}).pipe(Effect.asVoid)

export const statePull = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
  if (originUrlExit !== successExitCode) {
    yield* _(git(root, ["pull", "--rebase"], gitBaseEnv))
    return
  }
  const originUrl = yield* _(
    gitCapture(root, ["remote", "get-url", "origin"], gitBaseEnv).pipe(Effect.map((value) => value.trim()))
  )
  const token = yield* _(resolveGithubToken(fs, path, root))
  const effect = token && token.length > 0 && isGithubHttpsRemote(originUrl)
    ? withGithubAskpassEnv(token, (env) => git(root, ["pull", "--rebase"], env))
    : git(root, ["pull", "--rebase"], gitBaseEnv)
  yield* _(effect)
}).pipe(Effect.asVoid)

export const statePush = Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
  if (originUrlExit !== successExitCode) {
    yield* _(git(root, ["push", "-u", "origin", "HEAD"], gitBaseEnv))
    return
  }
  const originUrl = yield* _(
    gitCapture(root, ["remote", "get-url", "origin"], gitBaseEnv).pipe(Effect.map((value) => value.trim()))
  )
  const token = yield* _(resolveGithubToken(fs, path, root))
  const effect = token && token.length > 0 && isGithubHttpsRemote(originUrl)
    ? withGithubAskpassEnv(token, (env) => git(root, ["push", "-u", "origin", "HEAD"], env))
    : git(root, ["push", "-u", "origin", "HEAD"], gitBaseEnv)
  yield* _(effect)
}).pipe(Effect.asVoid)

export const stateCommit = (
  message: string
): Effect.Effect<void, CommandFailedError | PlatformError, Path.Path | CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, process.cwd())

    yield* _(git(root, ["add", "-A"], gitBaseEnv))
    const diffExit = yield* _(gitExitCode(root, ["diff", "--cached", "--quiet"], gitBaseEnv))

    if (diffExit === successExitCode) {
      yield* _(Effect.log("Nothing to commit."))
      return
    }

    yield* _(git(root, ["commit", "-m", message], gitBaseEnv))
  }).pipe(Effect.asVoid)

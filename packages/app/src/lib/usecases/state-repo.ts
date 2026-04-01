import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import { runCommandExitCode } from "../shell/command-runner.js"
import { CommandFailedError } from "../shell/errors.js"
import { defaultProjectsRoot } from "./menu-helpers.js"
import { adoptRemoteHistoryIfOrphan } from "./state-repo/adopt-remote.js"
import {
  autoPullEnvKey,
  autoSyncEnvKey,
  autoSyncStrictEnvKey,
  isAutoPullEnabled,
  isAutoSyncEnabled,
  isTruthyEnv
} from "./state-repo/env.js"
import {
  git,
  gitBaseEnv,
  gitCapture,
  gitExitCode,
  hasOriginRemote,
  isGitRepo,
  successExitCode
} from "./state-repo/git-commands.js"
import {
  githubAuthLoginHint,
  normalizeOriginUrlIfNeeded,
  shouldLogGithubAuthHintForStateSyncFailure
} from "./state-repo/github-auth-state.js"
import type { GitAuthEnv } from "./state-repo/github-auth.js"
import { isGithubHttpsRemote, resolveGithubToken, withGithubAskpassEnv } from "./state-repo/github-auth.js"
import { ensureStateGitignore } from "./state-repo/gitignore.js"
import { runStateSyncOps, runStateSyncWithToken } from "./state-repo/sync-ops.js"

type StateRepoEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))
const managedRepositoryCachePaths: ReadonlyArray<string> = [".cache/git-mirrors", ".cache/packages"]
const ensureStateIgnoreAndUntrackCaches = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    yield* _(ensureStateGitignore(fs, path, root))
    // Best-effort idempotent cleanup: keep cache artifacts out of git history.
    yield* _(git(root, ["rm", "-r", "--cached", "--ignore-unmatch", ...managedRepositoryCachePaths], gitBaseEnv))
  }).pipe(Effect.asVoid)

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
    yield* _(ensureStateIgnoreAndUntrackCaches(fs, path, root))
    const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
    if (originUrlExit !== successExitCode) {
      yield* _(Effect.logWarning(`State dir has no origin remote: ${root}`))
      yield* _(Effect.logWarning(`Run: docker-git state init --repo-url <url>`))
      return yield* _(
        Effect.fail(new CommandFailedError({ command: "git remote get-url origin", exitCode: originUrlExit }))
      )
    }
    const rawOriginUrl = yield* _(
      gitCapture(root, ["remote", "get-url", "origin"], gitBaseEnv).pipe(Effect.map((value) => value.trim()))
    )
    const originUrl = yield* _(normalizeOriginUrlIfNeeded(root, rawOriginUrl))
    const token = yield* _(resolveGithubToken(fs, path, root))
    const syncEffect = token && token.length > 0 && isGithubHttpsRemote(originUrl)
      ? runStateSyncWithToken(token, root, originUrl, message)
      : runStateSyncOps(root, originUrl, message, gitBaseEnv)
    yield* _(
      syncEffect.pipe(
        Effect.tapError((error) =>
          shouldLogGithubAuthHintForStateSyncFailure(originUrl, token, error)
            ? Effect.logWarning(githubAuthLoginHint)
            : Effect.void
        )
      )
    )
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

// CHANGE: add autoPullState to perform git pull on .docker-git at startup
// WHY: ensure local .docker-git state is up-to-date every time the docker-git command runs
// QUOTE(ТЗ): "Сделать что бы когда вызывается команда docker-git то происходит git pull для .docker-git папки"
// REF: issue-178
// PURITY: SHELL
// EFFECT: Effect<void, never, StateRepoEnv>
// INVARIANT: never fails — errors are logged as warnings; does not block CLI execution
// COMPLEXITY: O(1) network round-trip
export const autoPullState: Effect.Effect<void, never, StateRepoEnv> = Effect.gen(function*(_) {
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, process.cwd())
  const repoOk = yield* _(isGitRepo(root))
  if (!repoOk) {
    return
  }
  const originOk = yield* _(hasOriginRemote(root))
  const enabled = isAutoPullEnabled(process.env[autoPullEnvKey], originOk)
  if (!enabled) {
    return
  }
  // CHANGE: abort any in-progress rebase if pull fails to prevent conflict markers
  // WHY: if git pull --rebase fails (e.g. due to merge commits), git leaves the repo
  //      in a conflicted state with conflict markers; rebase --abort restores clean state
  // PURITY: SHELL
  yield* _(
    statePullInternal(root).pipe(
      Effect.tapError(() => git(root, ["rebase", "--abort"], gitBaseEnv).pipe(Effect.orElse(() => Effect.void)))
    )
  )
}).pipe(
  Effect.matchEffect({
    onFailure: (error) => Effect.logWarning(`State auto-pull failed: ${String(error)}`),
    onSuccess: () => Effect.void
  }),
  Effect.asVoid
)

// Internal pull that takes an already-resolved root, reusing auth logic from pull-push.
const statePullInternal = (
  root: string
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
    if (originUrlExit !== successExitCode) {
      yield* _(git(root, ["pull", "--rebase"], gitBaseEnv))
      return
    }
    const rawOriginUrl = yield* _(
      gitCapture(root, ["remote", "get-url", "origin"], gitBaseEnv).pipe(Effect.map((value) => value.trim()))
    )
    const originUrl = yield* _(normalizeOriginUrlIfNeeded(root, rawOriginUrl))
    const token = yield* _(resolveGithubToken(fs, path, root))
    // CHANGE: resolve current branch and pass origin <branch> explicitly
    // WHY: bare `git pull --rebase` can fail or pull the wrong branch in some git configurations
    // QUOTE(ТЗ): "Сделай что бы правильные параметры передавались"
    // REF: issue-181
    // PURITY: SHELL
    const branchRaw = yield* _(
      gitCapture(root, ["rev-parse", "--abbrev-ref", "HEAD"], gitBaseEnv).pipe(
        Effect.map((value) => value.trim()),
        Effect.orElse(() => Effect.succeed("main"))
      )
    )
    const branch = branchRaw === "HEAD" ? "main" : branchRaw
    const effect = token && token.length > 0 && isGithubHttpsRemote(originUrl)
      ? withGithubAskpassEnv(token, (env) => git(root, ["pull", "--rebase", "origin", branch], env))
      : git(root, ["pull", "--rebase", "origin", branch], gitBaseEnv)
    yield* _(effect)
  }).pipe(Effect.asVoid)

type StateInitInput = {
  readonly repoUrl: string
  readonly repoRef: string
  readonly token?: string
}

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

    // Empty remotes (no branch yet) and remotes without the requested branch can fail here.
    // Fall back to cloning the default branch so we can still set up the repo and create the branch locally.
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
      yield* _(Effect.log(`State dir cloned: ${root}`))
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
    const setUrlExit = yield* _(gitExitCode(root, ["remote", "set-url", "origin", repoUrl], env))
    if (setUrlExit === successExitCode) {
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

export const stateInit = (
  input: StateInitInput
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> => {
  const doInit = (env: GitAuthEnv) =>
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const path = yield* _(Path.Path)
      const root = resolveStateRoot(path, process.cwd())

      yield* _(initRepoIfNeeded(fs, path, root, input, env))
      yield* _(ensureOriginRemote(root, input.repoUrl, env))
      yield* _(adoptRemoteHistoryIfOrphan(root, input.repoRef, env))
      yield* _(checkoutBranchBestEffort(root, input.repoRef, env))
      yield* _(ensureStateGitignore(fs, path, root))

      yield* _(Effect.log(`State dir ready: ${root}`))
      yield* _(Effect.log(`Remote: ${input.repoUrl}`))
    }).pipe(Effect.asVoid)

  const token = input.token?.trim() ?? ""
  return token.length > 0 && isGithubHttpsRemote(input.repoUrl)
    ? withGithubAskpassEnv(token, doInit)
    : doInit(gitBaseEnv)
}

export { stateCommit, stateStatus } from "./state-repo/local-ops.js"
export { statePull, statePush } from "./state-repo/pull-push.js"

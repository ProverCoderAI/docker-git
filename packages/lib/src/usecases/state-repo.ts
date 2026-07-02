import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import { CommandFailedError } from "../shell/errors.js"
import { defaultProjectsRoot } from "./menu-helpers.js"
import { resolveGitlabTokenForOrigin, selectStatePullEffect, selectStateSyncEffect } from "./state-repo/auth-effects.js"
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
import { resolveGithubToken } from "./state-repo/github-auth.js"
import { ensureStateGitignore } from "./state-repo/gitignore.js"
import { type StateInitInput, stateInitRaw } from "./state-repo/init.js"
import { withStateGitLock } from "./state-repo/lock.js"

type StateRepoEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))
const resolveGitIndexLockPath = (path: Path.Path, root: string): string => path.join(root, ".git", "index.lock")
const managedRepositoryCachePaths: ReadonlyArray<string> = [".cache/git-mirrors", ".cache/packages"]

const renderStateSyncFailure = (error: CommandFailedError | PlatformError): string =>
  error._tag === "CommandFailedError"
    ? `${error.command} (exit ${error.exitCode})`
    : error._tag

const logStateAutoSyncFailure = (
  error: CommandFailedError | PlatformError
): Effect.Effect<void> => Effect.logWarning(`State auto-sync failed: ${renderStateSyncFailure(error)}`)

const logStateAutoPullFailure = (
  error: CommandFailedError | PlatformError
): Effect.Effect<void> => Effect.logWarning(`State auto-pull failed: ${renderStateSyncFailure(error)}`)

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

const stateSyncRaw = (
  cwd: string,
  message: string | null
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, cwd)
    const repoExit = yield* _(gitExitCode(root, ["rev-parse", "--is-inside-work-tree"], gitBaseEnv))
    if (repoExit !== successExitCode) {
      yield* _(Effect.logWarning("State dir is not a git repository."))
      yield* _(Effect.logWarning(`Run: docker-git state init --repo-url <url>`))
      return yield* _(
        Effect.fail(new CommandFailedError({ command: "git rev-parse --is-inside-work-tree", exitCode: repoExit }))
      )
    }
    yield* _(ensureStateIgnoreAndUntrackCaches(fs, path, root))
    const originUrlExit = yield* _(gitExitCode(root, ["remote", "get-url", "origin"], gitBaseEnv))
    if (originUrlExit !== successExitCode) {
      yield* _(Effect.logWarning("State dir has no origin remote."))
      yield* _(Effect.logWarning(`Run: docker-git state init --repo-url <url>`))
      return yield* _(
        Effect.fail(new CommandFailedError({ command: "git remote get-url origin", exitCode: originUrlExit }))
      )
    }
    const rawOriginUrl = yield* _(
      gitCapture(root, ["remote", "get-url", "origin"], gitBaseEnv).pipe(Effect.map((value) => value.trim()))
    )
    const originUrl = yield* _(normalizeOriginUrlIfNeeded(root, rawOriginUrl))
    const githubToken = yield* _(resolveGithubToken(fs, path, root))
    const gitlabToken = yield* _(resolveGitlabTokenForOrigin(fs, path, root, originUrl))
    const syncEffect = selectStateSyncEffect(root, originUrl, message, githubToken, gitlabToken)
    yield* _(
      syncEffect.pipe(
        Effect.tapError((error) =>
          shouldLogGithubAuthHintForStateSyncFailure(originUrl, githubToken, error)
            ? Effect.logWarning(githubAuthLoginHint)
            : Effect.void
        )
      )
    )
  }).pipe(Effect.asVoid)

export const stateSync = (message: string | null) =>
  Effect.sync(() => process.cwd()).pipe(
    Effect.flatMap((cwd) => withStateGitLock(cwd, stateSyncRaw(cwd, message)))
  )

const autoSyncStateRaw = (cwd: string, message: string): Effect.Effect<void, never, StateRepoEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, cwd)
    const isRepoOk = yield* _(isGitRepo(root))
    if (!isRepoOk) {
      return
    }
    const isOriginOk = yield* _(hasOriginRemote(root))
    const isEnabled = isAutoSyncEnabled(process.env[autoSyncEnvKey], isOriginOk)
    if (!isEnabled) {
      return
    }
    const strictValue = process.env[autoSyncStrictEnvKey]
    const isStrict = strictValue !== undefined && strictValue.trim().length > 0 ? isTruthyEnv(strictValue) : false
    if (!isStrict) {
      const indexLockPath = resolveGitIndexLockPath(path, root)
      const hasIndexLock = yield* _(fs.exists(indexLockPath))
      if (hasIndexLock) {
        yield* _(
          Effect.logWarning(
            "State auto-sync skipped: git index lock exists. Another git process may be running; retry later."
          )
        )
        return
      }
    }
    const effect = stateSyncRaw(cwd, message)
    if (isStrict) {
      yield* _(effect)
      return
    }
    yield* _(
      effect.pipe(
        Effect.matchEffect({
          onFailure: logStateAutoSyncFailure,
          onSuccess: () => Effect.void
        })
      )
    )
  }).pipe(
    Effect.matchEffect({
      onFailure: logStateAutoSyncFailure,
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
const autoPullStateRaw = (cwd: string): Effect.Effect<void, never, StateRepoEnv> => Effect.gen(function*(_) {
  const fs = yield* _(FileSystem.FileSystem)
  const path = yield* _(Path.Path)
  const root = resolveStateRoot(path, cwd)
  const isRootExists = yield* _(fs.exists(root))
  if (!isRootExists) {
    return
  }
  const isRepoOk = yield* _(isGitRepo(root))
  if (!isRepoOk) {
    return
  }
  const isOriginOk = yield* _(hasOriginRemote(root))
  const isEnabled = isAutoPullEnabled(process.env[autoPullEnvKey], isOriginOk)
  if (!isEnabled) {
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
    onFailure: logStateAutoPullFailure,
    onSuccess: () => Effect.void
  }),
  Effect.asVoid
)

export const autoSyncState = (message: string): Effect.Effect<void, never, StateRepoEnv> =>
  Effect.sync(() => process.cwd()).pipe(
    Effect.flatMap((cwd) => withStateGitLock(cwd, autoSyncStateRaw(cwd, message))),
    Effect.matchEffect({
      onFailure: logStateAutoSyncFailure,
      onSuccess: () => Effect.void
    }),
    Effect.asVoid
  )

export const autoPullState: Effect.Effect<void, never, StateRepoEnv> = Effect.sync(() => process.cwd()).pipe(
  Effect.flatMap((cwd) => withStateGitLock(cwd, autoPullStateRaw(cwd))),
  Effect.matchEffect({
    onFailure: logStateAutoPullFailure,
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
    const githubToken = yield* _(resolveGithubToken(fs, path, root))
    const gitlabToken = yield* _(resolveGitlabTokenForOrigin(fs, path, root, originUrl))
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
    const effect = selectStatePullEffect(root, originUrl, branch, githubToken, gitlabToken)
    yield* _(effect)
  }).pipe(Effect.asVoid)

export const stateInit = (input: StateInitInput) =>
  Effect.sync(() => process.cwd()).pipe(
    Effect.flatMap((cwd) => withStateGitLock(cwd, stateInitRaw(input, cwd)))
  )

export { stateCommit, stateStatus } from "./state-repo/local-ops.js"
export { statePull, statePush } from "./state-repo/pull-push.js"

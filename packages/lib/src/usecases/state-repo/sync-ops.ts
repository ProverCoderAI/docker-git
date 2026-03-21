import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"
import { CommandFailedError } from "../../shell/errors.js"
import { normalizeLegacyStateProjects } from "../state-normalize.js"
import { defaultSyncMessage } from "./env.js"
import { git, gitCapture, gitExitCode, successExitCode } from "./git-commands.js"
import type { GitAuthEnv } from "./github-auth.js"
import { tryBuildGithubCompareUrl, withGithubAskpassEnv } from "./github-auth.js"

type StateRepoEnv = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

const resolveOriginPushTarget = (originUrl: string | null): string => {
  const trimmed = originUrl?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : "origin"
}

const resolveSyncMessage = (value: string | null): string => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : defaultSyncMessage
}

const logOpenPr = (originUrl: string, baseBranch: string, prBranch: string, compareUrl: string | null) =>
  compareUrl
    ? Effect.log(`Open PR: ${compareUrl}`)
    : Effect.log(`Open PR from '${prBranch}' into '${baseBranch}' (origin: ${originUrl}).`)

const commitAllIfNeeded = (
  root: string,
  message: string,
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(git(root, ["add", "-A"], env))
    const diffExit = yield* _(gitExitCode(root, ["diff", "--cached", "--quiet"], env))
    if (diffExit === successExitCode) {
      return
    }
    yield* _(git(root, ["commit", "-m", message], env))
  })

const sanitizeBranchComponent = (value: string): string =>
  value
    .trim()
    .replaceAll(" ", "-")
    .replaceAll(":", "-")
    .replaceAll("..", "-")
    .replaceAll("@{", "-")
    .replaceAll("\\", "-")
    .replaceAll("^", "-")
    .replaceAll("~", "-")

// CHANGE: stash local changes → hard reset to remote → restore local changes on top
// WHY: remote is source of truth; local changes must overlay latest remote without losing remote updates
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: after pull, working tree == origin/{baseBranch} ∧ local modifications restored on top
const pullRemoteAndRestoreLocal = (
  root: string,
  baseBranch: string,
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const fetchExit = yield* _(gitExitCode(root, ["fetch", "origin", "--prune"], env))
    if (fetchExit !== successExitCode) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "git fetch origin --prune", exitCode: fetchExit })))
    }

    const remoteRef = `refs/remotes/origin/${baseBranch}`
    const hasRemoteBranchExit = yield* _(gitExitCode(root, ["show-ref", "--verify", "--quiet", remoteRef], env))
    if (hasRemoteBranchExit !== successExitCode) {
      return // Remote branch does not exist yet (brand-new repo)
    }

    // Stash local uncommitted changes (including untracked files)
    yield* _(git(root, ["add", "-A"], env))
    const stashExit = yield* _(gitExitCode(root, ["stash", "--include-untracked"], env))

    // Hard reset: working tree + index + HEAD = exact remote state
    yield* _(git(root, ["reset", "--hard", `origin/${baseBranch}`], env))

    // Restore local changes on top of remote
    if (stashExit === successExitCode) {
      const popExit = yield* _(gitExitCode(root, ["stash", "pop"], env))
      if (popExit !== successExitCode) {
        // Resolve conflicts by keeping local (stashed) version — local changes always win
        yield* _(gitExitCode(root, ["checkout", "--theirs", "--", "."], env))
        yield* _(git(root, ["add", "-A"], env))
        yield* _(gitExitCode(root, ["stash", "drop"], env))
      }
    }
  })

const pushToNewBranch = (
  root: string,
  baseBranch: string,
  originPushTarget: string,
  env: GitAuthEnv
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const headShort = yield* _(
      gitCapture(root, ["rev-parse", "--short", "HEAD"], env).pipe(Effect.map((value) => value.trim()))
    )
    const timestamp = yield* _(Effect.sync(() => new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")))
    const branch = sanitizeBranchComponent(`state-sync/${baseBranch}/${timestamp}-${headShort}`)

    yield* _(git(root, ["push", "--no-verify", originPushTarget, `HEAD:refs/heads/${branch}`], env))
    return branch
  })

const resolveBaseBranch = (value: string): string => (value === "HEAD" ? "main" : value)

const getCurrentBranch = (
  root: string,
  env: GitAuthEnv
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  gitCapture(root, ["rev-parse", "--abbrev-ref", "HEAD"], env).pipe(Effect.map((value) => value.trim()))

export const runStateSyncOps = (
  root: string,
  originUrl: string,
  message: string | null,
  env: GitAuthEnv,
  options?: { readonly originPushUrlOverride?: string | null }
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    const originPushUrlOverride = options?.originPushUrlOverride ?? null
    const originPushTarget = resolveOriginPushTarget(originPushUrlOverride)
    yield* _(normalizeLegacyStateProjects(root))

    const branch = yield* _(getCurrentBranch(root, env))
    const baseBranch = resolveBaseBranch(branch)

    // First: pull latest remote state, stashing and restoring local changes
    yield* _(pullRemoteAndRestoreLocal(root, baseBranch, env))
    // Then: commit local changes on top of remote
    yield* _(commitAllIfNeeded(root, resolveSyncMessage(message), env))

    const pushExit = yield* _(
      gitExitCode(root, ["push", "--no-verify", originPushTarget, `HEAD:refs/heads/${baseBranch}`], env)
    )
    if (pushExit === successExitCode) {
      return
    }

    const prBranch = yield* _(pushToNewBranch(root, baseBranch, originPushTarget, env))
    const compareUrl = tryBuildGithubCompareUrl(originUrl, baseBranch, prBranch)
    yield* _(Effect.logWarning(`State push failed (exit ${pushExit}); pushed changes to branch '${prBranch}'.`))
    yield* _(logOpenPr(originUrl, baseBranch, prBranch, compareUrl))
  }).pipe(Effect.asVoid)

export const runStateSyncWithToken = (
  token: string,
  root: string,
  originUrl: string,
  message: string | null
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  withGithubAskpassEnv(
    token,
    (env) => runStateSyncOps(root, originUrl, message, env, { originPushUrlOverride: originUrl })
  )

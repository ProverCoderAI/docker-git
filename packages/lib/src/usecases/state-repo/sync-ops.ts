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

const rebaseOntoOriginIfPossible = (
  root: string,
  baseBranch: string,
  env: GitAuthEnv
): Effect.Effect<"ok" | "skipped" | "conflict", CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    // Ensure we see the latest remote branch tip before attempting to rebase.
    const fetchExit = yield* _(gitExitCode(root, ["fetch", "origin", "--prune"], env))
    if (fetchExit !== successExitCode) {
      return yield* _(Effect.fail(new CommandFailedError({ command: "git fetch origin --prune", exitCode: fetchExit })))
    }

    const remoteRef = `refs/remotes/origin/${baseBranch}`
    const hasRemoteBranchExit = yield* _(gitExitCode(root, ["show-ref", "--verify", "--quiet", remoteRef], env))
    if (hasRemoteBranchExit !== successExitCode) {
      return "skipped"
    }

    const rebaseExit = yield* _(gitExitCode(root, ["rebase", `origin/${baseBranch}`], env))
    if (rebaseExit === successExitCode) {
      return "ok"
    }

    // Best-effort: avoid leaving the repo in a rebase-in-progress state.
    yield* _(gitExitCode(root, ["rebase", "--abort"], env))
    return "conflict"
  })

const pushToNewBranch = (
  root: string,
  baseBranch: string,
  env: GitAuthEnv
): Effect.Effect<string, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const headShort = yield* _(
      gitCapture(root, ["rev-parse", "--short", "HEAD"], env).pipe(Effect.map((value) => value.trim()))
    )
    const timestamp = yield* _(Effect.sync(() => new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-")))
    const branch = sanitizeBranchComponent(`state-sync/${baseBranch}/${timestamp}-${headShort}`)

    yield* _(git(root, ["push", "origin", `HEAD:refs/heads/${branch}`], env))
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
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  Effect.gen(function*(_) {
    yield* _(normalizeLegacyStateProjects(root))
    const commitMessage = message && message.trim().length > 0 ? message.trim() : defaultSyncMessage
    yield* _(commitAllIfNeeded(root, commitMessage, env))

    const branch = yield* _(getCurrentBranch(root, env))
    const baseBranch = resolveBaseBranch(branch)

    const rebaseResult = yield* _(rebaseOntoOriginIfPossible(root, baseBranch, env))
    if (rebaseResult === "conflict") {
      const prBranch = yield* _(pushToNewBranch(root, baseBranch, env))
      const compareUrl = tryBuildGithubCompareUrl(originUrl, baseBranch, prBranch)

      yield* _(Effect.logWarning(`State sync needs manual merge: pushed changes to branch '${prBranch}'.`))
      yield* (compareUrl
        ? _(Effect.log(`Open PR: ${compareUrl}`))
        : _(Effect.log(`Open PR from '${prBranch}' into '${baseBranch}' (origin: ${originUrl}).`)))
      return
    }

    const pushExit = yield* _(gitExitCode(root, ["push", "-u", "origin", "HEAD"], env))
    if (pushExit === successExitCode) {
      return
    }

    const prBranch = yield* _(pushToNewBranch(root, baseBranch, env))
    const compareUrl = tryBuildGithubCompareUrl(originUrl, baseBranch, prBranch)
    yield* _(Effect.logWarning(`State push failed (exit ${pushExit}); pushed changes to branch '${prBranch}'.`))
    if (compareUrl) {
      yield* _(Effect.log(`Open PR: ${compareUrl}`))
      return
    }
    yield* _(Effect.log(`Open PR from '${prBranch}' into '${baseBranch}' (origin: ${originUrl}).`))
  }).pipe(Effect.asVoid)

export const runStateSyncWithToken = (
  token: string,
  root: string,
  originUrl: string,
  message: string | null
): Effect.Effect<void, CommandFailedError | PlatformError, StateRepoEnv> =>
  withGithubAskpassEnv(token, (env) => runStateSyncOps(root, originUrl, message, env))

import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"
import type { CommandFailedError } from "../../shell/errors.js"
import { git, gitExitCode, successExitCode } from "./git-commands.js"
import type { GitAuthEnv } from "./github-auth.js"

// CHANGE: align local history with remote when histories have no common ancestor
// WHY: prevents creation of new branches when local repo was git-init'd without cloning (divergent root commits)
// QUOTE(ТЗ): "у нас должна быть единая система облака в виде .docker-git. Новая ветка открывается только тогда когда не возможно исправить конфликт и сделать push в main"
// REF: issue-141
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: soft-resets only when merge-base finds no common ancestor; idempotent when histories are already related
// COMPLEXITY: O(1) git operations
export const adoptRemoteHistoryIfOrphan = (
  root: string,
  repoRef: string,
  env: GitAuthEnv
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    // Fetch remote history first — required for merge-base and reset
    const fetchExit = yield* _(gitExitCode(root, ["fetch", "origin", repoRef], env))
    if (fetchExit !== successExitCode) {
      yield* _(Effect.logWarning(`git fetch origin ${repoRef} failed (exit ${fetchExit}); starting fresh history`))
      return
    }
    const remoteRef = `origin/${repoRef}`
    const hasRemoteExit = yield* _(
      gitExitCode(root, ["show-ref", "--verify", "--quiet", `refs/remotes/${remoteRef}`], env)
    )
    if (hasRemoteExit !== successExitCode) {
      return // Remote branch does not exist yet (brand-new repo)
    }

    // Case 1: orphan branch (no local commits at all)
    const revParseExit = yield* _(gitExitCode(root, ["rev-parse", "HEAD"], env))
    if (revParseExit !== successExitCode) {
      // Mixed reset: moves HEAD and updates index to match remote (working tree untouched)
      yield* _(git(root, ["reset", remoteRef], env))
      // Populate working tree with remote files, skipping files that already exist locally
      yield* _(gitExitCode(root, ["checkout-index", "--all"], env))
      yield* _(Effect.log(`Adopted remote history from ${remoteRef}`))
      return
    }

    // Case 2: local commits exist but histories share no common ancestor
    // (e.g. git-init without cloning produced a divergent root commit)
    const mergeBaseExit = yield* _(gitExitCode(root, ["merge-base", "HEAD", remoteRef], env))
    if (mergeBaseExit === successExitCode) {
      return // Histories are related — sync will reset --soft onto the remote tip
    }

    // Merge unrelated histories so both are preserved; abort on conflict — stateSync will open a PR
    yield* _(Effect.logWarning(`Local history has no common ancestor with ${remoteRef}; merging unrelated histories`))
    const mergeExit = yield* _(
      gitExitCode(root, ["merge", "--allow-unrelated-histories", "--no-edit", remoteRef], env)
    )
    if (mergeExit === successExitCode) {
      yield* _(Effect.log(`Merged unrelated histories from ${remoteRef}`))
      return
    }
    // Conflict — abort and leave resolution to stateSync (which will push a branch and log a PR URL)
    yield* _(gitExitCode(root, ["merge", "--abort"], env))
    yield* _(Effect.logWarning(`Merge conflict with ${remoteRef}; sync will open a PR for manual resolution`))
  })

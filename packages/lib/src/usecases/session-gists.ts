import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import type {
  SessionGistBackupCommand,
  SessionGistDownloadCommand,
  SessionGistListCommand,
  SessionGistViewCommand
} from "../core/domain.js"
import { runCommandWithExitCodes } from "../shell/command-runner.js"
import { CommandFailedError } from "../shell/errors.js"

// CHANGE: implement session backup repository operations via shell commands
// WHY: enables CLI access to session backup/list/view/download functionality
// QUOTE(ТЗ): "иметь возможность возвращаться ко всем старым сессиям с агентами"
// REF: issue-143
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: all operations require gh CLI authentication
// COMPLEXITY: O(n) where n = number of files/gists

type SessionGistsError = CommandFailedError | PlatformError
type SessionGistsRequirements = CommandExecutor.CommandExecutor

const nodeOk = [0]

const makeNodeSpec = (scriptPath: string, args: ReadonlyArray<string>) => ({
  cwd: process.cwd(),
  command: "node",
  args: [scriptPath, ...args]
})

const runNodeScript = (
  scriptPath: string,
  args: ReadonlyArray<string>
): Effect.Effect<void, SessionGistsError, SessionGistsRequirements> =>
  runCommandWithExitCodes(
    makeNodeSpec(scriptPath, args),
    nodeOk,
    (exitCode) => new CommandFailedError({ command: `node ${scriptPath}`, exitCode })
  )

export const sessionGistBackup = (
  cmd: SessionGistBackupCommand
): Effect.Effect<void, SessionGistsError, SessionGistsRequirements> => {
  const args: Array<string> = ["--verbose"]
  if (cmd.prNumber !== null) {
    args.push("--pr-number", cmd.prNumber.toString())
  }
  if (cmd.repo !== null) {
    args.push("--repo", cmd.repo)
  }
  if (!cmd.postComment) {
    args.push("--no-comment")
  }
  return Effect.gen(function*(_) {
    yield* _(Effect.log("Backing up AI session to private session repository..."))
    yield* _(runNodeScript("scripts/session-backup-gist.js", args))
    yield* _(Effect.log("Session backup complete."))
  })
}

export const sessionGistList = (
  cmd: SessionGistListCommand
): Effect.Effect<void, SessionGistsError, SessionGistsRequirements> => {
  const args: Array<string> = ["list", "--limit", cmd.limit.toString()]
  if (cmd.repo !== null) {
    args.push("--repo", cmd.repo)
  }
  return Effect.gen(function*(_) {
    yield* _(Effect.log("Listing session backup snapshots..."))
    yield* _(runNodeScript("scripts/session-list-gists.js", args))
  })
}

export const sessionGistView = (
  cmd: SessionGistViewCommand
): Effect.Effect<void, SessionGistsError, SessionGistsRequirements> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Viewing snapshot: ${cmd.snapshotRef}`))
    yield* _(runNodeScript("scripts/session-list-gists.js", ["view", cmd.snapshotRef]))
  })

export const sessionGistDownload = (
  cmd: SessionGistDownloadCommand
): Effect.Effect<void, SessionGistsError, SessionGistsRequirements> =>
  Effect.gen(function*(_) {
    yield* _(Effect.log(`Downloading snapshot ${cmd.snapshotRef} to ${cmd.outputDir}...`))
    yield* _(runNodeScript("scripts/session-list-gists.js", ["download", cmd.snapshotRef, "--output", cmd.outputDir]))
    yield* _(Effect.log("Download complete."))
  })

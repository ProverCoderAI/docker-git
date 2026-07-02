import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Duration, Effect } from "effect"

import { CommandFailedError } from "../../shell/errors.js"
import { defaultProjectsRoot } from "../menu-helpers.js"

const stateGitLock = Effect.unsafeMakeSemaphore(1)
const stateGitLockRetryDelay = Duration.millis(100)
const stateGitLockMaxAttempts = 50
const stateGitLockBusyExitCode = 75

const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))
const resolveStateLockPath = (root: string): string => `${root}.lock`

const isStateFileLockBusy = (error: Extract<PlatformError, { readonly _tag: "SystemError" }>): boolean =>
  error.reason === "AlreadyExists" || error.reason === "Busy"

const acquireStateFileLock = (
  fs: FileSystem.FileSystem,
  lockPath: string,
  attempt: number = 0
): Effect.Effect<string, CommandFailedError | PlatformError> =>
  fs.makeDirectory(lockPath).pipe(
    Effect.as(lockPath),
    Effect.catchTag("SystemError", (error) => {
      if (!isStateFileLockBusy(error)) {
        return Effect.fail(error)
      }
      if (attempt >= stateGitLockMaxAttempts) {
        return Effect.fail(new CommandFailedError({ command: "state git lock", exitCode: stateGitLockBusyExitCode }))
      }
      return Effect.sleep(stateGitLockRetryDelay).pipe(
        Effect.zipRight(acquireStateFileLock(fs, lockPath, attempt + 1))
      )
    })
  )

const releaseStateFileLock = (
  fs: FileSystem.FileSystem,
  lockPath: string
): Effect.Effect<void> =>
  fs.remove(lockPath, { recursive: true, force: true }).pipe(
    Effect.orElseSucceed(() => void 0)
  )

/**
 * Serializes git operations against the shared `.docker-git` working tree.
 *
 * @param effect - State git operation to run under the process-local lock.
 * @returns The same effect guarded by a single permit semaphore.
 *
 * @pure false
 * @effect Semaphore coordination for state repository shell effects.
 * @invariant At most one guarded state git effect runs in this process.
 * @precondition Effect must not already hold this lock.
 * @postcondition Success/failure value is preserved.
 * @complexity O(effect)
 * @throws Never - failures remain in the Effect error channel.
 */
// CHANGE: serialize state repository git effects across process and fiber boundaries
// WHY: auth auto-sync can run from separate docker-git processes and otherwise race on one git index
// QUOTE(ТЗ): "fatal: Unable to create '/home/dev/.docker-git/.git/index.lock': File exists."
// REF: user-report-2026-07-01-claude-auth-login
// SOURCE: n/a
// FORMAT THEOREM: forall a,b in StateGitOps: overlap(file_guard(a), file_guard(b)) = false
// PURITY: SHELL
// EFFECT: Effect<A, E | CommandFailedError | PlatformError, R | FileSystem | Path>
// INVARIANT: a single process-local permit and a state-root lock directory protect the shared state repo
// COMPLEXITY: O(effect)
export const withStateGitLock = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | CommandFailedError | PlatformError, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, process.cwd())
    const lockPath = resolveStateLockPath(root)
    return yield* _(
      Effect.acquireUseRelease(
        acquireStateFileLock(fs, lockPath),
        () => effect,
        (acquiredLockPath) => releaseStateFileLock(fs, acquiredLockPath)
      )
    )
  }).pipe(stateGitLock.withPermits(1))

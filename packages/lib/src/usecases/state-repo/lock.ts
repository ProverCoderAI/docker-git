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
export const stateGitLockStaleAfterMillis = 10 * 60 * 1000
const stateGitLockCreatedAtFileName = "created-at-ms"

const resolveStateRoot = (path: Path.Path, cwd: string): string => path.resolve(defaultProjectsRoot(cwd))
const resolveStateLockPath = (root: string): string => `${root}.lock`

const isStateFileLockBusy = (error: Extract<PlatformError, { readonly _tag: "SystemError" }>): boolean =>
  error.reason === "AlreadyExists" || error.reason === "Busy"

const stateGitLockCreatedAtPath = (lockPath: string): string => `${lockPath}/${stateGitLockCreatedAtFileName}`

const writeStateFileLockMetadata = (
  fs: FileSystem.FileSystem,
  lockPath: string,
  now: number
): Effect.Effect<void, PlatformError> =>
  fs.writeFileString(stateGitLockCreatedAtPath(lockPath), `${now}\n`)

const isStateFileLockMtimeStale = (
  fs: FileSystem.FileSystem,
  lockPath: string,
  now: number
): Effect.Effect<boolean, PlatformError> =>
  fs.stat(lockPath).pipe(
    Effect.map((info) =>
      info.mtime._tag === "Some" && now - info.mtime.value.getTime() > stateGitLockStaleAfterMillis
    ),
    Effect.catchTag("SystemError", () => Effect.succeed(false))
  )

const isStateFileLockStale = (
  fs: FileSystem.FileSystem,
  lockPath: string,
  now: number
): Effect.Effect<boolean, PlatformError> =>
  fs.readFileString(stateGitLockCreatedAtPath(lockPath)).pipe(
    Effect.map((raw) => {
      const createdAt = Number(raw.trim())
      return Number.isFinite(createdAt) && now - createdAt > stateGitLockStaleAfterMillis
    }),
    Effect.catchTag("SystemError", () => isStateFileLockMtimeStale(fs, lockPath, now))
  )

const acquireStateFileLockAttempt = (
  fs: FileSystem.FileSystem,
  lockPath: string
): Effect.Effect<string, PlatformError> =>
  fs.makeDirectory(lockPath).pipe(
    Effect.zipRight(writeStateFileLockMetadata(fs, lockPath, Date.now())),
    Effect.as(lockPath)
  )

const retryAcquireStateFileLock = (
  fs: FileSystem.FileSystem,
  lockPath: string,
  attempt: number
): Effect.Effect<string, CommandFailedError | PlatformError> =>
  removeStaleStateFileLock(fs, lockPath, Date.now()).pipe(
    Effect.flatMap((isReclaimed) => {
      if (isReclaimed) {
        return acquireStateFileLock(fs, lockPath, attempt)
      }
      if (attempt >= stateGitLockMaxAttempts) {
        return Effect.fail(new CommandFailedError({ command: "state git lock", exitCode: stateGitLockBusyExitCode }))
      }
      return Effect.sleep(stateGitLockRetryDelay).pipe(
        Effect.zipRight(acquireStateFileLock(fs, lockPath, attempt + 1))
      )
    })
  )

const acquireStateFileLock = (
  fs: FileSystem.FileSystem,
  lockPath: string,
  attempt: number = 0
): Effect.Effect<string, CommandFailedError | PlatformError> =>
  acquireStateFileLockAttempt(fs, lockPath).pipe(
    Effect.catchTag("SystemError", (error) => {
      if (!isStateFileLockBusy(error)) {
        return Effect.fail(error)
      }
      return retryAcquireStateFileLock(fs, lockPath, attempt)
    })
  )

const removeStaleStateFileLock = (
  fs: FileSystem.FileSystem,
  lockPath: string,
  now: number
): Effect.Effect<boolean, PlatformError> =>
  isStateFileLockStale(fs, lockPath, now).pipe(
    Effect.flatMap((isStale) =>
      isStale
        ? fs.remove(lockPath, { recursive: true, force: true }).pipe(Effect.as(true))
        : Effect.succeed(false)
    ),
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
  cwd: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | CommandFailedError | PlatformError, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const root = resolveStateRoot(path, cwd)
    const lockPath = resolveStateLockPath(root)
    return yield* _(
      Effect.acquireUseRelease(
        acquireStateFileLock(fs, lockPath),
        () => effect,
        (acquiredLockPath) => releaseStateFileLock(fs, acquiredLockPath)
      )
    )
  }).pipe(stateGitLock.withPermits(1))

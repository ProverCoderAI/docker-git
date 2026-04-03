import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/path-helpers"
import {
  stateCommit as runStateCommit,
  stateInit as runStateInit,
  statePath as runStatePath,
  statePull as runStatePull,
  statePush as runStatePush,
  stateStatus as runStateStatus,
  stateSync as runStateSync
} from "@effect-template/lib/usecases/state-repo"
import { Effect, Logger } from "effect"

import type { StateCommitRequest, StateInitRequest, StateSyncRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError } from "../api/errors.js"

type StateRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type StateError = CommandFailedError | PlatformError

const toStateApiError = (error: StateError): ApiBadRequestError | ApiInternalError =>
  error._tag === "CommandFailedError"
    ? new ApiBadRequestError({
      message: `${error.command} failed (exit ${error.exitCode}).`
    })
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const runWithCapturedLogs = <R>(
  effect: Effect.Effect<void, StateError, R>,
  fallbackOutput: string
): Effect.Effect<string, StateError, R> =>
  Effect.gen(function*(_) {
    const lines: Array<string> = []
    const logger = Logger.make(({ message }) => {
      lines.push(String(message))
    })

    yield* _(effect.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))))

    return lines.length > 0 ? lines.join("\n") : fallbackOutput
  })

export const readStatePathOutput = (): Effect.Effect<string, ApiInternalError, Path.Path> =>
  runWithCapturedLogs(runStatePath, defaultProjectsRoot(process.cwd())).pipe(
    Effect.mapError((error) =>
      new ApiInternalError({
        message: String(error),
        cause: error
      }))
  )

export const readStateStatusOutput = (): Effect.Effect<string, ApiBadRequestError | ApiInternalError, StateRuntime> =>
  runWithCapturedLogs(runStateStatus, "(clean)").pipe(Effect.mapError(toStateApiError))

export const initStateFromRequest = (
  request: StateInitRequest
): Effect.Effect<string, ApiBadRequestError | ApiInternalError, StateRuntime> =>
  runWithCapturedLogs(
    runStateInit({
      repoUrl: request.repoUrl,
      repoRef: request.repoRef?.trim() && request.repoRef.trim().length > 0 ? request.repoRef.trim() : "main"
    }),
    "State init completed."
  ).pipe(Effect.mapError(toStateApiError))

export const pullState = (): Effect.Effect<string, ApiBadRequestError | ApiInternalError, StateRuntime> =>
  runWithCapturedLogs(runStatePull, "State pull completed.").pipe(Effect.mapError(toStateApiError))

export const pushState = (): Effect.Effect<string, ApiBadRequestError | ApiInternalError, StateRuntime> =>
  runWithCapturedLogs(runStatePush, "State push completed.").pipe(Effect.mapError(toStateApiError))

export const commitStateFromRequest = (
  request: StateCommitRequest
): Effect.Effect<string, ApiBadRequestError | ApiInternalError, StateRuntime> =>
  runWithCapturedLogs(runStateCommit(request.message), "State commit completed.").pipe(Effect.mapError(toStateApiError))

export const syncStateFromRequest = (
  request: StateSyncRequest
): Effect.Effect<string, ApiBadRequestError | ApiInternalError, StateRuntime> =>
  runWithCapturedLogs(runStateSync(request.message ?? null), "State sync completed.").pipe(Effect.mapError(toStateApiError))

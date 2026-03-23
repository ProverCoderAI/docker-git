import {
  stateCommit,
  stateInit,
  statePath,
  statePull,
  statePush,
  stateStatus,
  stateSync
} from "@effect-template/lib/usecases/state-repo"
import { Effect } from "effect"

import type {
  StateCommitRequest,
  StateInitRequest,
  StateSyncRequest
} from "../api/contracts.js"
import { ApiInternalError } from "../api/errors.js"
import { captureLogOutput } from "./capture-output.js"

const toApiError = (cause: unknown): ApiInternalError =>
  new ApiInternalError({
    message: String(cause),
    cause: cause instanceof Error ? cause : new Error(String(cause))
  })

// CHANGE: expose lib state-repo functions through REST API
// WHY: CLI becomes HTTP client; all state operations run on API server
// PURITY: SHELL
// EFFECT: Effect<StatePathResponse | StateOutputResponse, ApiInternalError, Path>
// INVARIANT: captured log messages form the response body

export const runStatePath = () =>
  captureLogOutput(statePath).pipe(
    Effect.map(({ output }) => ({ path: output.trim() })),
    Effect.mapError(toApiError)
  )

export const runStateInit = (req: StateInitRequest) =>
  captureLogOutput(
    stateInit({
      repoUrl: req.repoUrl,
      repoRef: req.repoRef ?? "main"
    })
  ).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runStateStatus = () =>
  captureLogOutput(stateStatus).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "(clean)" })),
    Effect.mapError(toApiError)
  )

export const runStatePull = () =>
  captureLogOutput(statePull).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runStatePush = () =>
  captureLogOutput(statePush).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runStateCommit = (req: StateCommitRequest) =>
  captureLogOutput(stateCommit(req.message)).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runStateSync = (req: StateSyncRequest) =>
  captureLogOutput(stateSync(req.message ?? null)).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

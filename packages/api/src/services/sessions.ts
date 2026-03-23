import {
  killTerminalProcess,
  listTerminalSessions,
  tailTerminalLogs
} from "@effect-template/lib/usecases/terminal-sessions"
import { Effect } from "effect"

import type { SessionsKillRequest, SessionsListRequest, SessionsLogsRequest } from "../api/contracts.js"
import { ApiInternalError } from "../api/errors.js"
import { captureLogOutput } from "./capture-output.js"

const toApiError = (cause: unknown): ApiInternalError =>
  new ApiInternalError({
    message: String(cause),
    cause: cause instanceof Error ? cause : new Error(String(cause))
  })

// CHANGE: expose lib terminal-sessions functions through REST API
// WHY: CLI becomes HTTP client; session management runs on API server
// PURITY: SHELL
// EFFECT: Effect<SessionsOutput, ApiInternalError, FileSystem | Path | CommandExecutor>
// INVARIANT: captured log output forms the response body

export const runSessionsList = (req: SessionsListRequest) =>
  captureLogOutput(
    listTerminalSessions({
      _tag: "SessionsList",
      projectDir: req.projectDir,
      includeDefault: req.includeDefault ?? false
    })
  ).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "(no sessions)" })),
    Effect.mapError(toApiError)
  )

export const runSessionsKill = (req: SessionsKillRequest) =>
  captureLogOutput(
    killTerminalProcess({
      _tag: "SessionsKill",
      projectDir: req.projectDir,
      pid: req.pid
    })
  ).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runSessionsLogs = (req: SessionsLogsRequest) =>
  captureLogOutput(
    tailTerminalLogs({
      _tag: "SessionsLogs",
      projectDir: req.projectDir,
      pid: req.pid,
      lines: req.lines ?? 200
    })
  ).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "(no output)" })),
    Effect.mapError(toApiError)
  )

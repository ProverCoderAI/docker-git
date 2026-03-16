import { exportScrap, importScrap } from "@effect-template/lib/usecases/scrap"
import { Effect } from "effect"

import type { ScrapExportRequest, ScrapImportRequest } from "../api/contracts.js"
import { ApiInternalError } from "../api/errors.js"
import { captureLogOutput } from "./capture-output.js"

const DEFAULT_ARCHIVE_PATH = ".orch/scrap/session"

const toApiError = (cause: unknown): ApiInternalError =>
  new ApiInternalError({
    message: String(cause),
    cause: cause instanceof Error ? cause : new Error(String(cause))
  })

// CHANGE: expose lib scrap functions through REST API
// WHY: CLI becomes HTTP client; scrap export/import runs on API server
// PURITY: SHELL
// EFFECT: Effect<SessionsOutput, ApiInternalError, FileSystem | Path | CommandExecutor>
// INVARIANT: captured log output forms the response body

export const runScrapExport = (req: ScrapExportRequest) =>
  captureLogOutput(
    exportScrap({
      _tag: "ScrapExport",
      projectDir: req.projectDir,
      archivePath: req.archivePath ?? DEFAULT_ARCHIVE_PATH,
      mode: "session"
    })
  ).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Export complete." })),
    Effect.mapError(toApiError)
  )

export const runScrapImport = (req: ScrapImportRequest) =>
  captureLogOutput(
    importScrap({
      _tag: "ScrapImport",
      projectDir: req.projectDir,
      archivePath: req.archivePath,
      wipe: req.wipe ?? true,
      mode: "session"
    })
  ).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Import complete." })),
    Effect.mapError(toApiError)
  )

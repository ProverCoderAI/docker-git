import { mcpPlaywrightUp } from "@effect-template/lib/usecases/mcp-playwright"
import { Effect } from "effect"

import type { McpPlaywrightUpRequest } from "../api/contracts.js"
import { ApiInternalError } from "../api/errors.js"
import { captureLogOutput } from "./capture-output.js"

const toApiError = (cause: unknown): ApiInternalError =>
  new ApiInternalError({
    message: String(cause),
    cause: cause instanceof Error ? cause : new Error(String(cause))
  })

// CHANGE: expose lib mcpPlaywrightUp through REST API
// WHY: CLI becomes HTTP client; MCP Playwright setup runs on API server
// PURITY: SHELL
// EFFECT: Effect<SessionsOutput, ApiInternalError, FileSystem | Path | CommandExecutor>
// INVARIANT: captured log output forms the response body

export const runMcpPlaywrightUp = (req: McpPlaywrightUpRequest) =>
  captureLogOutput(
    mcpPlaywrightUp({
      _tag: "McpPlaywrightUp",
      projectDir: req.projectDir,
      runUp: req.runUp ?? false
    })
  ).pipe(
    Effect.map(({ output }) => ({ output: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

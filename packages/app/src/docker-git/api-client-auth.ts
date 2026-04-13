import * as FsPlatform from "@effect/platform/FileSystem"
import * as PathPlatform from "@effect/platform/Path"
import { Effect } from "effect"

import { request, requestTextStream, requestVoid } from "./api-http.js"
import { asObject, type JsonRequest, type JsonValue } from "./api-json.js"
import type { ControllerRuntime } from "./controller.js"
import type {
  AuthCodexImportCommand,
  AuthCodexLoginCommand,
  AuthCodexLogoutCommand,
  AuthCodexStatusCommand,
  AuthGithubLoginCommand,
  AuthGithubLogoutCommand,
  AuthGithubStatusCommand
} from "./frontend-lib/core/domain.js"
import { resolvePathFromCwd } from "./frontend-lib/usecases/path-helpers.js"
import type { ApiAuthRequiredError, ApiRequestError } from "./host-errors.js"

type StreamMarkers = {
  readonly success: string
  readonly errorPrefix: string
}

const codexLoginMarkers: StreamMarkers = {
  success: "__DOCKER_GIT_CODEX_LOGIN_STATUS__:ok",
  errorPrefix: "__DOCKER_GIT_CODEX_LOGIN_STATUS__:error:"
}

const githubLoginMarkers: StreamMarkers = {
  success: "__DOCKER_GIT_GITHUB_LOGIN_STATUS__:ok",
  errorPrefix: "__DOCKER_GIT_GITHUB_LOGIN_STATUS__:error:"
}

const isMarkerLine = (line: string, markers: StreamMarkers): boolean =>
  line.startsWith(markers.success) || line.startsWith(markers.errorPrefix)

const visibleLines = (output: string, markers: StreamMarkers): ReadonlyArray<string> =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !isMarkerLine(line, markers))

const markerExitCode = (output: string, markers: StreamMarkers): string | null => {
  const failureLine = output
    .split(/\r?\n/u)
    .find((line) => line.startsWith(markers.errorPrefix))

  return failureLine === undefined
    ? null
    : failureLine.slice(markers.errorPrefix.length)
}

const makeVisibleChunkWriter = (markers: StreamMarkers) => {
  let pending = ""
  const flushVisiblePending = () => {
    if (pending.length > 0 && !isMarkerLine(pending, markers)) {
      process.stdout.write(pending)
    }
  }

  const writeVisibleChunk = (chunk: string) => {
    pending += chunk
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""

    for (const line of lines) {
      if (!isMarkerLine(line, markers)) {
        process.stdout.write(`${line}\n`)
      }
    }
  }

  return { flushVisiblePending, writeVisibleChunk }
}

const codexLoginFailureMessage = (output: string, exitCode: string | null): string => {
  if (output.includes("429 Too Many Requests")) {
    return "Codex device auth is rate-limited by OpenAI (429 Too Many Requests). Wait a few minutes and retry."
  }

  const detailedLine = visibleLines(output, codexLoginMarkers)
    .findLast((line) => line.toLowerCase().includes("error"))
  if (detailedLine !== undefined) {
    return detailedLine
  }

  const lastLine = visibleLines(output, codexLoginMarkers).at(-1)
  if (lastLine !== undefined) {
    return lastLine
  }

  return exitCode === null
    ? "Codex login stream ended without a completion marker."
    : `Codex login failed (${exitCode}).`
}

const githubLoginFailureMessage = (output: string, exitCode: string | null): string => {
  const detailedLine = visibleLines(output, githubLoginMarkers)
    .findLast((line) => line.toLowerCase().includes("failed") || line.toLowerCase().includes("error"))
  if (detailedLine !== undefined) {
    return detailedLine
  }

  const lastLine = visibleLines(output, githubLoginMarkers).at(-1)
  if (lastLine !== undefined) {
    return lastLine
  }

  return exitCode === null
    ? "GitHub login stream ended without a completion marker."
    : `GitHub login failed (${exitCode}).`
}

const streamFailure = (
  method: "POST",
  path: string,
  message: string
): ApiRequestError => ({
  _tag: "ApiRequestError",
  method,
  path,
  message,
  displayOnlyMessage: true
})

const requestMarkedAuthStream = (
  path: string,
  body: JsonRequest,
  markers: StreamMarkers,
  failureMessage: (output: string, exitCode: string | null) => string
) =>
  Effect.gen(function*(_) {
    const writer = makeVisibleChunkWriter(markers)
    const output = yield* _(requestTextStream("POST", path, body, writer.writeVisibleChunk))
    writer.flushVisiblePending()

    if (output.includes(markers.success)) {
      return output
    }

    return yield* _(
      Effect.fail<ApiRequestError>(
        streamFailure("POST", path, failureMessage(output, markerExitCode(output, markers)))
      )
    )
  })

const githubLoginSuccessPayload = (statusPayload: JsonValue): JsonValue => {
  const object = asObject(statusPayload)
  return {
    ok: true,
    status: object === null ? statusPayload : (object["status"] ?? statusPayload)
  }
}

const githubWebLogin = (
  command: AuthGithubLoginCommand
): Effect.Effect<JsonValue, ApiRequestError | ApiAuthRequiredError, ControllerRuntime> =>
  requestMarkedAuthStream(
    "/auth/github/login/stream",
    {
      label: command.label,
      token: null,
      scopes: command.scopes
    },
    githubLoginMarkers,
    githubLoginFailureMessage
  ).pipe(
    Effect.flatMap(() => request("GET", "/auth/github/status")),
    Effect.map((statusPayload) => githubLoginSuccessPayload(statusPayload))
  )

export const githubLogin = (
  command: AuthGithubLoginCommand
): Effect.Effect<JsonValue, ApiRequestError | ApiAuthRequiredError, ControllerRuntime> =>
  command.token !== null && command.token.trim().length > 0
    ? request("POST", "/auth/github/login", {
      label: command.label,
      token: command.token,
      scopes: command.scopes
    })
    : githubWebLogin(command)

export const githubStatus = (_command: AuthGithubStatusCommand) => request("GET", "/auth/github/status")

export const githubLogout = (command: AuthGithubLogoutCommand) =>
  requestVoid("POST", "/auth/github/logout", {
    label: command.label
  })

export const codexLogin = (command: AuthCodexLoginCommand) =>
  requestMarkedAuthStream(
    "/auth/codex/login",
    { label: command.label },
    codexLoginMarkers,
    codexLoginFailureMessage
  ).pipe(Effect.asVoid)

const readCodexAuthText = (command: AuthCodexImportCommand) =>
  Effect.gen(function*(_) {
    const fs = yield* _(FsPlatform.FileSystem)
    const path = yield* _(PathPlatform.Path)
    const resolvedCodexAuthDir = resolvePathFromCwd(path, process.cwd(), command.codexAuthPath)
    const authFilePath = path.join(resolvedCodexAuthDir, "auth.json")
    return yield* _(fs.readFileString(authFilePath))
  })

export const codexImport = (command: AuthCodexImportCommand) =>
  Effect.gen(function*(_) {
    const authText = yield* _(readCodexAuthText(command))
    return yield* _(request("POST", "/auth/codex/import", { label: command.label, authText }))
  })

export const codexStatus = (command: AuthCodexStatusCommand) => {
  const query = command.label === null ? "" : `?label=${encodeURIComponent(command.label)}`
  return request("GET", `/auth/codex/status${query}`)
}

export const codexLogout = (command: AuthCodexLogoutCommand) =>
  requestVoid("POST", "/auth/codex/logout", {
    label: command.label
  })

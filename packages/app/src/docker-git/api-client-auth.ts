import * as FsPlatform from "@effect/platform/FileSystem"
import * as PathPlatform from "@effect/platform/Path"
import { Effect } from "effect"

import {
  authStreamMarkerExitCode,
  type AuthStreamMarkers,
  codexLoginFailureMessage,
  codexLoginStreamMarkers,
  didAuthStreamSucceed,
  githubLoginFailureMessage,
  githubLoginStreamMarkers,
  gitlabLoginFailureMessage,
  gitlabLoginStreamMarkers,
  makeVisibleAuthStreamWriter
} from "../shared/auth-stream-markers.js"
import { request, requestTextStream, requestVoid } from "./api-http.js"
import { asObject, type JsonRequest, type JsonValue } from "./api-json.js"
import type { ControllerRuntime } from "./controller.js"
import type {
  AuthClaudeStatusCommand,
  AuthCodexImportCommand,
  AuthCodexLoginCommand,
  AuthCodexLogoutCommand,
  AuthCodexStatusCommand,
  AuthGithubLoginCommand,
  AuthGithubLogoutCommand,
  AuthGithubStatusCommand,
  AuthGitlabLoginCommand,
  AuthGitlabLogoutCommand,
  AuthGitlabStatusCommand,
  AuthGitLoginCommand,
  AuthGitLogoutCommand,
  AuthGitStatusCommand,
  AuthGrokLogoutCommand,
  AuthGrokStatusCommand
} from "./frontend-lib/core/domain.js"
import { resolvePathFromCwd } from "./frontend-lib/usecases/path-helpers.js"
import type { ApiAuthRequiredError, ApiRequestError } from "./host-errors.js"

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
  markers: AuthStreamMarkers,
  failureMessage: (output: string, exitCode: string | null) => string
) =>
  Effect.gen(function*(_) {
    const writer = makeVisibleAuthStreamWriter(markers, (chunk) => {
      process.stdout.write(chunk)
    })
    const output = yield* _(requestTextStream("POST", path, body, writer.writeChunk))
    writer.flushVisiblePending()

    if (didAuthStreamSucceed(output, markers)) {
      return output
    }

    const exitCode = authStreamMarkerExitCode(output, markers)
    const message = failureMessage(output, exitCode)
    return yield* _(
      Effect.fail<ApiRequestError>(streamFailure("POST", path, message))
    )
  })

const authLoginSuccessPayload = (statusPayload: JsonValue): JsonValue => {
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
    githubLoginStreamMarkers,
    githubLoginFailureMessage
  ).pipe(
    Effect.flatMap(() => request("GET", "/auth/github/status")),
    Effect.map((statusPayload) => authLoginSuccessPayload(statusPayload))
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

const gitlabWebLogin = (
  command: AuthGitlabLoginCommand
): Effect.Effect<JsonValue, ApiRequestError | ApiAuthRequiredError, ControllerRuntime> =>
  requestMarkedAuthStream(
    "/auth/gitlab/login/stream",
    {
      label: command.label,
      token: null
    },
    gitlabLoginStreamMarkers,
    gitlabLoginFailureMessage
  ).pipe(
    Effect.flatMap(() => request("GET", "/auth/gitlab/status")),
    Effect.map((statusPayload) => authLoginSuccessPayload(statusPayload))
  )

export const gitlabLogin = (
  command: AuthGitlabLoginCommand
): Effect.Effect<JsonValue, ApiRequestError | ApiAuthRequiredError, ControllerRuntime> =>
  command.token !== null && command.token.trim().length > 0
    ? request("POST", "/auth/gitlab/login", {
      label: command.label,
      token: command.token
    })
    : gitlabWebLogin(command)

export const gitlabStatus = (_command: AuthGitlabStatusCommand) => request("GET", "/auth/gitlab/status")

export const gitlabLogout = (command: AuthGitlabLogoutCommand) =>
  requestVoid("POST", "/auth/gitlab/logout", {
    label: command.label
  })

// CHANGE: route generic per-host git auth through the controller HTTP API
// WHY: issue #368 enables connecting git providers other than github/gitlab via token
// QUOTE(ТЗ): "реализовать возможность добавлять git подключения отличных от gitlab, github ... просто здавая токен"
// REF: issue-368
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: gitLogin(cmd) -> POST /auth/git/login {host, token, user}
// PURITY: SHELL
// EFFECT: Effect<JsonValue | void, ApiRequestError | ApiAuthRequiredError, ControllerRuntime>
// INVARIANT: token-only flow; host is always forwarded
// COMPLEXITY: O(1)
export const gitLogin = (
  command: AuthGitLoginCommand
): Effect.Effect<JsonValue, ApiRequestError | ApiAuthRequiredError, ControllerRuntime> =>
  request("POST", "/auth/git/login", {
    host: command.host,
    token: command.token,
    user: command.user
  })

export const gitStatus = (_command: AuthGitStatusCommand) => request("GET", "/auth/git/status")

export const gitLogout = (command: AuthGitLogoutCommand) =>
  requestVoid("POST", "/auth/git/logout", {
    host: command.host
  })

export const codexLogin = (command: AuthCodexLoginCommand) =>
  requestMarkedAuthStream(
    "/auth/codex/login",
    { label: command.label },
    codexLoginStreamMarkers,
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

export const claudeStatus = (command: AuthClaudeStatusCommand) => {
  const query = command.label === null ? "" : `?label=${encodeURIComponent(command.label)}`
  return request("GET", `/auth/claude/status${query}`)
}

export const grokStatus = (command: AuthGrokStatusCommand) => {
  const query = command.label === null ? "" : `?label=${encodeURIComponent(command.label)}`
  return request("GET", `/auth/grok/status${query}`)
}

export const grokLogout = (command: AuthGrokLogoutCommand) =>
  requestVoid("POST", "/auth/grok/logout", {
    label: command.label
  })

export const codexLogout = (command: AuthCodexLogoutCommand) =>
  requestVoid("POST", "/auth/codex/logout", {
    label: command.label
  })

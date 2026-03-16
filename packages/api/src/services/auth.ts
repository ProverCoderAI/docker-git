import {
  authClaudeLogin,
  authClaudeLogout,
  authClaudeStatus,
  authCodexLogin,
  authCodexLogout,
  authCodexStatus,
  authGithubLogin,
  authGithubLogout,
  authGithubStatus
} from "@effect-template/lib/usecases/auth"
import { Effect } from "effect"

import type {
  AuthClaudeLoginRequest,
  AuthClaudeLogoutRequest,
  AuthClaudeStatusRequest,
  AuthCodexLoginRequest,
  AuthCodexLogoutRequest,
  AuthCodexStatusRequest,
  AuthGithubLoginRequest,
  AuthGithubLogoutRequest,
  AuthGithubStatusRequest
} from "../api/contracts.js"
import { ApiInternalError } from "../api/errors.js"
import { captureLogOutput } from "./capture-output.js"

const toApiError = (cause: unknown): ApiInternalError =>
  new ApiInternalError({
    message: String(cause),
    cause: cause instanceof Error ? cause : new Error(String(cause))
  })

// CHANGE: expose lib auth functions through REST API
// WHY: CLI becomes HTTP client; all auth operations run on API server
// PURITY: SHELL
// EFFECT: Effect<AuthStatusResponse, ApiInternalError, FileSystem | Path | CommandExecutor>
// INVARIANT: captured log messages form the response body
// COMPLEXITY: O(n) where n = env file size

export const runAuthGithubLogin = (req: AuthGithubLoginRequest) =>
  captureLogOutput(
    authGithubLogin({
      _tag: "AuthGithubLogin",
      label: req.label ?? null,
      token: req.token ?? null,
      scopes: req.scopes ?? null,
      envGlobalPath: req.envGlobalPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runAuthGithubStatus = (req: AuthGithubStatusRequest) =>
  captureLogOutput(
    authGithubStatus({
      _tag: "AuthGithubStatus",
      envGlobalPath: req.envGlobalPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "(no status)" })),
    Effect.mapError(toApiError)
  )

export const runAuthGithubLogout = (req: AuthGithubLogoutRequest) =>
  captureLogOutput(
    authGithubLogout({
      _tag: "AuthGithubLogout",
      label: req.label ?? null,
      envGlobalPath: req.envGlobalPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runAuthCodexLogin = (req: AuthCodexLoginRequest) =>
  captureLogOutput(
    authCodexLogin({
      _tag: "AuthCodexLogin",
      label: req.label ?? null,
      codexAuthPath: req.codexAuthPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runAuthCodexStatus = (req: AuthCodexStatusRequest) =>
  captureLogOutput(
    authCodexStatus({
      _tag: "AuthCodexStatus",
      label: req.label ?? null,
      codexAuthPath: req.codexAuthPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "(no status)" })),
    Effect.mapError(toApiError)
  )

export const runAuthCodexLogout = (req: AuthCodexLogoutRequest) =>
  captureLogOutput(
    authCodexLogout({
      _tag: "AuthCodexLogout",
      label: req.label ?? null,
      codexAuthPath: req.codexAuthPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runAuthClaudeLogin = (req: AuthClaudeLoginRequest) =>
  captureLogOutput(
    authClaudeLogin({
      _tag: "AuthClaudeLogin",
      label: req.label ?? null,
      claudeAuthPath: req.claudeAuthPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

export const runAuthClaudeStatus = (req: AuthClaudeStatusRequest) =>
  captureLogOutput(
    authClaudeStatus({
      _tag: "AuthClaudeStatus",
      label: req.label ?? null,
      claudeAuthPath: req.claudeAuthPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "(no status)" })),
    Effect.mapError(toApiError)
  )

export const runAuthClaudeLogout = (req: AuthClaudeLogoutRequest) =>
  captureLogOutput(
    authClaudeLogout({
      _tag: "AuthClaudeLogout",
      label: req.label ?? null,
      claudeAuthPath: req.claudeAuthPath
    })
  ).pipe(
    Effect.map(({ output }) => ({ message: output.length > 0 ? output : "Done." })),
    Effect.mapError(toApiError)
  )

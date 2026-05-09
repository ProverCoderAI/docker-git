import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { defaultTemplateConfig } from "@effect-template/lib/core/template-defaults"
import { migrateLegacyOrchLayout } from "@effect-template/lib/usecases/auth-sync"
import { buildGitlabTokenKey, gitlabLabelFromKey } from "@effect-template/lib/usecases/auth-gitlab"
import { ensureEnvFile, readEnvText, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import { gitlabAuthRoot } from "@effect-template/lib/usecases/gitlab-auth-image"
import { resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"
import { Effect, Logger, Runtime } from "effect"
import * as Stream from "effect/Stream"

import type { GitlabAuthLoginRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiInternalError } from "../api/errors.js"

type GitlabRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

type PreparedGitlabLogin = {
  readonly envPath: string
  readonly key: string
  readonly label: string
}

export type GitlabDeviceAuthorization = {
  readonly deviceCode: string
  readonly userCode: string
  readonly verificationUri: string
  readonly verificationUriComplete: string
  readonly expiresIn: number
  readonly interval: number
}

type GitlabTokenResponse = {
  readonly accessToken: string
}

type GitlabTokenPendingResponse = {
  readonly error: string
  readonly errorDescription: string | null
}

const gitlabLoginStreamSuccessMarker = "__DOCKER_GIT_GITLAB_LOGIN_STATUS__:ok"
const gitlabLoginStreamErrorMarkerPrefix = "__DOCKER_GIT_GITLAB_LOGIN_STATUS__:error:"
const gitlabDeviceClientId = "41d48f9422ebd655dd9cf2947d6979681dfaddc6d0c56f7628f6ada59559af1e"
const gitlabDeviceScope = "openid profile read_user write_repository api"
const gitlabDeviceAuthorizeUrl = "https://gitlab.com/oauth/authorize_device"
const gitlabDeviceTokenUrl = "https://gitlab.com/oauth/token"
const gitlabDeviceGrantType = "urn:ietf:params:oauth:grant-type:device_code"

const ensureGitlabOrchLayout = (
  cwd: string,
  envGlobalPath: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  migrateLegacyOrchLayout(cwd, {
    envGlobalPath,
    envProjectPath: defaultTemplateConfig.envProjectPath,
    codexAuthPath: defaultTemplateConfig.codexAuthPath,
    ghAuthPath: ".docker-git/.orch/auth/gh",
    gitlabAuthPath: gitlabAuthRoot,
    claudeAuthPath: ".docker-git/.orch/auth/claude"
  })

const toApiError = (error: PlatformError): ApiInternalError =>
  new ApiInternalError({
    message: String(error),
    cause: error
  })

const prepareGitlabLogin = (
  request: GitlabAuthLoginRequest
): Effect.Effect<PreparedGitlabLogin, ApiBadRequestError | ApiInternalError, GitlabRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const cwd = process.cwd()

    yield* _(
      ensureGitlabOrchLayout(cwd, defaultTemplateConfig.envGlobalPath).pipe(
        Effect.mapError(toApiError)
      )
    )

    const envPath = resolvePathFromCwd(path, cwd, defaultTemplateConfig.envGlobalPath)
    const authPath = resolvePathFromCwd(path, cwd, gitlabAuthRoot)
    const key = buildGitlabTokenKey(request.label ?? null)

    yield* _(fs.makeDirectory(authPath, { recursive: true }).pipe(Effect.mapError(toApiError)))

    return {
      envPath,
      key,
      label: gitlabLabelFromKey(key)
    }
  })

const persistGitlabToken = (
  fs: FileSystem.FileSystem,
  envPath: string,
  key: string,
  token: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const current = yield* _(readEnvText(fs, envPath))
    const nextText = upsertEnvKey(current, key, token)
    yield* _(fs.writeFileString(envPath, nextText))
  })

const finalizeMessage = (status: string): string =>
  status === "ok"
    ? `\nGitLab login completed.\n${gitlabLoginStreamSuccessMarker}\n`
    : `\n${gitlabLoginStreamErrorMarkerPrefix}${status}\n`

const normalizeCapturedLogLines = (lines: ReadonlyArray<string>): ReadonlyArray<string> =>
  lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

export const renderGitlabDeviceLoginInstructions = (authorization: GitlabDeviceAuthorization): string =>
  [
    "GitLab device login:",
    `- Open: ${authorization.verificationUri}`,
    `- Enter code: ${authorization.userCode}`,
    `- Direct link: ${authorization.verificationUriComplete}`,
    `Waiting for authorization for up to ${authorization.expiresIn} seconds...`
  ].join("\n") + "\n"

export const renderGitlabPostLoginOutput = (
  lines: ReadonlyArray<string>,
  status: string
): string => {
  const output = normalizeCapturedLogLines(lines).join("\n")
  const logBlock = output.length === 0 ? "" : `\n${output}\n`
  return `${logBlock}${finalizeMessage(status)}`
}

const toStreamError = (error: unknown): ApiInternalError | ApiBadRequestError =>
  error instanceof ApiBadRequestError || error instanceof ApiInternalError
    ? error
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const asRecord = (value: unknown): Record<string, unknown> | null =>
  typeof value === "object" && value !== null ? value as Record<string, unknown> : null

const stringField = (record: Record<string, unknown>, key: string): string | null => {
  const value = record[key]
  return typeof value === "string" && value.trim().length > 0 ? value : null
}

const numberField = (record: Record<string, unknown>, key: string, fallback: number): number => {
  const value = record[key]
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback
}

const parseDeviceAuthorization = (payload: unknown): GitlabDeviceAuthorization => {
  const record = asRecord(payload)
  const deviceCode = record === null ? null : stringField(record, "device_code")
  const userCode = record === null ? null : stringField(record, "user_code")
  const verificationUri = record === null ? null : stringField(record, "verification_uri")
  const verificationUriComplete = record === null ? null : stringField(record, "verification_uri_complete")

  if (record === null || deviceCode === null || userCode === null || verificationUri === null || verificationUriComplete === null) {
    throw new Error("GitLab device authorization response was missing required fields.")
  }

  return {
    deviceCode,
    userCode,
    verificationUri,
    verificationUriComplete,
    expiresIn: numberField(record, "expires_in", 300),
    interval: numberField(record, "interval", 5)
  }
}

const parseTokenResponse = (payload: unknown): GitlabTokenResponse | GitlabTokenPendingResponse => {
  const record = asRecord(payload)
  const accessToken = record === null ? null : stringField(record, "access_token")
  if (accessToken !== null) {
    return { accessToken }
  }

  return {
    error: record === null ? "invalid_response" : (stringField(record, "error") ?? "invalid_response"),
    errorDescription: record === null ? null : stringField(record, "error_description")
  }
}

const formBody = (entries: ReadonlyArray<readonly [string, string]>): URLSearchParams => {
  const params = new URLSearchParams()
  for (const [key, value] of entries) {
    params.set(key, value)
  }
  return params
}

const postGitlabOauthForm = async (url: string, body: URLSearchParams): Promise<unknown> => {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  })
  const payload = await response.json() as unknown
  if (response.ok) {
    return payload
  }
  return payload
}

const requestGitlabDeviceAuthorization = async (): Promise<GitlabDeviceAuthorization> =>
  parseDeviceAuthorization(
    await postGitlabOauthForm(
      gitlabDeviceAuthorizeUrl,
      formBody([
        ["client_id", gitlabDeviceClientId],
        ["scope", gitlabDeviceScope]
      ])
    )
  )

const delay = (ms: number) => new Promise((resolve) => {
  setTimeout(resolve, ms)
})

const formatGitlabDeviceError = (response: GitlabTokenPendingResponse): string =>
  response.errorDescription === null
    ? response.error
    : `${response.error}: ${response.errorDescription}`

const pollGitlabDeviceToken = async (
  authorization: GitlabDeviceAuthorization,
  shouldStop: () => boolean
): Promise<string> => {
  const startedAt = Date.now()
  const expiresAt = startedAt + authorization.expiresIn * 1000
  let intervalMs = authorization.interval * 1000

  while (!shouldStop() && Date.now() < expiresAt) {
    await delay(intervalMs)

    const result = parseTokenResponse(
      await postGitlabOauthForm(
        gitlabDeviceTokenUrl,
        formBody([
          ["grant_type", gitlabDeviceGrantType],
          ["device_code", authorization.deviceCode],
          ["client_id", gitlabDeviceClientId]
        ])
      )
    )

    if ("accessToken" in result) {
      return result.accessToken
    }

    if (result.error === "authorization_pending") {
      continue
    }

    if (result.error === "slow_down") {
      intervalMs += 5000
      continue
    }

    throw new Error(formatGitlabDeviceError(result))
  }

  throw new Error("GitLab device login expired before authorization completed.")
}

const finalizeGitlabLogin = (
  prepared: PreparedGitlabLogin,
  token: string
): Effect.Effect<void, ApiBadRequestError | ApiInternalError, GitlabRuntime> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    yield* _(ensureEnvFile(fs, path, prepared.envPath).pipe(Effect.mapError(toApiError)))
    yield* _(persistGitlabToken(fs, prepared.envPath, prepared.key, token).pipe(Effect.mapError(toApiError)))
    yield* _(autoSyncState(`chore(state): auth gitlab ${prepared.label}`))
  })

export const streamGitlabAuthLogin = (
  request: GitlabAuthLoginRequest
): Effect.Effect<Stream.Stream<Uint8Array, ApiBadRequestError | ApiInternalError>, ApiBadRequestError | ApiInternalError, GitlabRuntime> =>
  Effect.gen(function*(_) {
    const prepared = yield* _(prepareGitlabLogin(request))
    const encoder = new TextEncoder()
    const runPromise = Runtime.runPromise(yield* _(Effect.runtime<GitlabRuntime>()))

    let cancelled = false
    const readable = new ReadableStream<Uint8Array>({
      start(controller) {
        const enqueue = (chunk: Buffer | string) => {
          const encoded = typeof chunk === "string" ? encoder.encode(chunk) : new Uint8Array(chunk)
          controller.enqueue(encoded)
        }

        void (async () => {
          const postLoginLogs: Array<string> = []
          const logger = Logger.make(({ message }) => {
            postLoginLogs.push(String(message))
          })

          try {
            enqueue("Starting GitLab device login...\n")
            const authorization = await requestGitlabDeviceAuthorization()
            enqueue(renderGitlabDeviceLoginInstructions(authorization))
            const token = await pollGitlabDeviceToken(authorization, () => cancelled)
            await runPromise(
              finalizeGitlabLogin(prepared, token).pipe(
                Effect.provide(Logger.replace(Logger.defaultLogger, logger))
              )
            )
            enqueue(renderGitlabPostLoginOutput(postLoginLogs, "ok"))
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            if (cancelled) {
              return
            }
            const output = renderGitlabPostLoginOutput([
              ...postLoginLogs,
              `GitLab device login failed: ${message}`
            ], "device-login")
            enqueue(output)
          } finally {
            controller.close()
          }
        })()
      },
      cancel() {
        cancelled = true
      }
    })

    return Stream.fromReadableStream({
      evaluate: () => readable,
      onError: toStreamError,
      releaseLockOnEnd: true
    })
  })

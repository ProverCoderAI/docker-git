import * as FileSystem from "@effect/platform/FileSystem"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { defaultTemplateConfig } from "@effect-template/lib/core/template-defaults"
import { parseGithubRepoUrl } from "@effect-template/lib/core/repo"
import { authGithubLogin as runGithubLogin, authGithubLogout as runGithubLogout } from "@effect-template/lib/usecases/auth-github"
import { readEnvText } from "@effect-template/lib/usecases/env-file"
import {
  githubInvalidTokenMessage,
  resolveGithubCloneAuthToken
} from "@effect-template/lib/usecases/github-token-preflight"
import { validateGithubToken, type GithubTokenValidationResult } from "@effect-template/lib/usecases/github-token-validation"
import { resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { Effect, Match } from "effect"

import type {
  GithubAuthLoginRequest,
  GithubAuthLogoutRequest,
  GithubAuthStatus,
  GithubAuthTokenStatus
} from "../api/contracts.js"
import { ApiAuthRequiredError } from "../api/errors.js"

export const githubAuthRequiredCommand = "docker-git auth github login --web"
export const githubAuthRequiredMessage = "GitHub authentication is required. Run: docker-git auth github login --web"
export const githubAuthEnvGlobalPath = defaultTemplateConfig.envGlobalPath

const githubTokenKey = "GITHUB_TOKEN"
const githubTokenPrefix = "GITHUB_TOKEN__"

type GithubTokenEntry = {
  readonly key: string
  readonly label: string
  readonly token: string
}

const labelFromKey = (key: string): string =>
  key.startsWith(githubTokenPrefix) ? key.slice(githubTokenPrefix.length) : "default"

const listGithubTokens = (envText: string): ReadonlyArray<GithubTokenEntry> => {
  const entries: Array<GithubTokenEntry> = []
  for (const line of envText.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue
    }
    const raw = trimmed.startsWith("export ") ? trimmed.slice("export ".length).trimStart() : trimmed
    const eqIndex = raw.indexOf("=")
    if (eqIndex <= 0) {
      continue
    }
    const key = raw.slice(0, eqIndex).trim()
    const value = raw.slice(eqIndex + 1).trim()
    if ((key === githubTokenKey || key.startsWith(githubTokenPrefix)) && value.length > 0) {
      entries.push({
        key,
        label: labelFromKey(key),
        token: value
      })
    }
  }
  return entries
}

const toTokenStatus = (
  entry: GithubTokenEntry,
  validation: GithubTokenValidationResult
): GithubAuthTokenStatus => ({
  key: entry.key,
  label: entry.label,
  status: validation.status,
  login: validation.login
})

const buildStatusSummary = (tokens: ReadonlyArray<GithubAuthTokenStatus>): string =>
  tokens.length === 0
    ? "GitHub not connected (no tokens)."
    : `GitHub tokens (${tokens.length}):`

const githubAuthError = (message: string): ApiAuthRequiredError =>
  new ApiAuthRequiredError({
    provider: "github",
    message,
    command: githubAuthRequiredCommand
  })

const resolveControllerEnvPath = (
  path: Path.Path,
  envGlobalPath: string
): string =>
  resolvePathFromCwd(path, process.cwd(), envGlobalPath)

const readGithubAuthTokens = (
  envGlobalPath: string
): Effect.Effect<GithubAuthStatus, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedEnvPath = resolveControllerEnvPath(path, envGlobalPath)
    const envText = yield* _(readEnvText(fs, resolvedEnvPath))
    const entries = listGithubTokens(envText)
    const tokens: ReadonlyArray<GithubAuthTokenStatus> = yield* _(
      Effect.forEach(
        entries,
        (entry) =>
          validateGithubToken(entry.token).pipe(
            Effect.map((validation: GithubTokenValidationResult) => toTokenStatus(entry, validation))
          ),
        { concurrency: "unbounded" }
      )
    )
    return {
      summary: buildStatusSummary(tokens),
      tokens
    } satisfies GithubAuthStatus
  })

export const readGithubAuthStatus = (): Effect.Effect<GithubAuthStatus, PlatformError, FileSystem.FileSystem | Path.Path> =>
  readGithubAuthTokens(githubAuthEnvGlobalPath)

export const loginGithubAuth = (request: GithubAuthLoginRequest) =>
  Effect.gen(function*(_) {
    yield* _(
      runGithubLogin({
        _tag: "AuthGithubLogin",
        label: request.label ?? null,
        token: request.token ?? null,
        scopes: request.scopes ?? null,
        envGlobalPath: githubAuthEnvGlobalPath
      })
    )
    return yield* _(readGithubAuthTokens(githubAuthEnvGlobalPath))
  })

export const logoutGithubAuth = (request: GithubAuthLogoutRequest) =>
  Effect.gen(function*(_) {
    yield* _(
      runGithubLogout({
        _tag: "AuthGithubLogout",
        label: request.label ?? null,
        envGlobalPath: githubAuthEnvGlobalPath
      })
    )
    return yield* _(readGithubAuthTokens(githubAuthEnvGlobalPath))
  })

export const ensureGithubAuthForCreate = (config: {
  readonly repoUrl: string
  readonly gitTokenLabel?: string | undefined
  readonly envGlobalPath: string
}): Effect.Effect<void, ApiAuthRequiredError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    if (parseGithubRepoUrl(config.repoUrl) === null) {
      return
    }

    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedEnvPath = resolveControllerEnvPath(path, config.envGlobalPath)
    const envText = yield* _(readEnvText(fs, resolvedEnvPath))
    const token = resolveGithubCloneAuthToken(envText, {
      repoUrl: config.repoUrl,
      gitTokenLabel: config.gitTokenLabel
    })

    if (token === null) {
      return yield* _(Effect.fail(githubAuthError(githubAuthRequiredMessage)))
    }

    const validation: GithubTokenValidationResult = yield* _(validateGithubToken(token))
    return yield* _(
      Match.value(validation.status).pipe(
        Match.when("valid", () => Effect.void),
        Match.when("invalid", () => Effect.fail(githubAuthError(githubInvalidTokenMessage))),
        Match.when("unknown", () => Effect.logWarning("Unable to validate GitHub token before create; continuing.")),
        Match.exhaustive
      )
    )
  })

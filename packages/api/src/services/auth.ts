import * as FileSystem from "@effect/platform/FileSystem"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { defaultTemplateConfig } from "@effect-template/lib/core/template-defaults"
import { parseGithubRepoUrl, parseGitlabRepoUrl } from "@effect-template/lib/core/repo"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { authCodexLogin as runCodexLogin } from "@effect-template/lib/usecases/auth-codex"
import { authGitlabLogin as runGitlabLogin, authGitlabLogout as runGitlabLogout, listGitlabTokens } from "@effect-template/lib/usecases/auth-gitlab"
import { authGithubLogin as runGithubLogin, authGithubLogout as runGithubLogout } from "@effect-template/lib/usecases/auth-github"
import { readEnvText } from "@effect-template/lib/usecases/env-file"
import {
  gitlabRepoAccessMessage,
  gitlabRepoAccessWarning,
  gitlabInvalidTokenMessage,
  probeGitlabRepoAccess,
  resolveGitlabCloneAuthToken
} from "@effect-template/lib/usecases/gitlab-token-preflight"
import { validateGitlabToken, type GitlabTokenValidationResult } from "@effect-template/lib/usecases/gitlab-token-validation"
import {
  githubRepoAccessMessage,
  githubRepoAccessWarning,
  githubInvalidTokenMessage,
  probeGithubRepoAccess,
  resolveGithubCloneAuthToken
} from "@effect-template/lib/usecases/github-token-preflight"
import { validateGithubToken, type GithubTokenValidationResult } from "@effect-template/lib/usecases/github-token-validation"
import { normalizeAccountLabel } from "@effect-template/lib/usecases/auth-helpers"
import { resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { Effect, Logger, Match } from "effect"

import type {
  CodexAuthImportRequest,
  CodexAuthLoginRequest,
  CodexAuthLogoutRequest,
  CodexAuthStatus,
  GitlabAuthLoginRequest,
  GitlabAuthLogoutRequest,
  GitlabAuthStatus,
  GitlabAuthTokenStatus,
  GithubAuthLoginRequest,
  GithubAuthLogoutRequest,
  GithubAuthStatus,
  GithubAuthTokenStatus
} from "../api/contracts.js"
import { ApiAuthRequiredError, ApiBadRequestError, ApiInternalError } from "../api/errors.js"

export const githubAuthRequiredCommand = "docker-git auth github login --web"
export const githubAuthRequiredMessage = [
  "GitHub auth is missing: no GitHub token/key was found for this repository.",
  "If the repository requires access, run: docker-git auth github login --web"
].join("\n")
export const gitlabAuthRequiredCommand = "docker-git auth gitlab login"
export const gitlabAuthRequiredMessage = [
  "GitLab auth is missing: no GitLab token/key was found for this repository.",
  "If the repository requires access, run: docker-git auth gitlab login"
].join("\n")
export const githubAuthEnvGlobalPath = defaultTemplateConfig.envGlobalPath
export const codexAuthPath = defaultTemplateConfig.codexAuthPath

const githubTokenKey = "GITHUB_TOKEN"
const githubTokenPrefix = "GITHUB_TOKEN__"

type GithubTokenEntry = {
  readonly key: string
  readonly label: string
  readonly token: string
}

type JsonRecord = Readonly<Record<string, unknown>>
type CodexRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
type CodexCommandError = CommandFailedError | PlatformError

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

const gitlabAuthError = (message: string): ApiAuthRequiredError =>
  new ApiAuthRequiredError({
    provider: "gitlab",
    message,
    command: gitlabAuthRequiredCommand
  })

const toCodexApiError = (error: CodexCommandError): ApiBadRequestError | ApiInternalError =>
  error._tag === "CommandFailedError"
    ? new ApiBadRequestError({
      message: `${error.command} failed (exit ${error.exitCode}).`
    })
    : new ApiInternalError({
      message: String(error),
      cause: error
    })

const runWithCapturedLogs = <R>(
  effect: Effect.Effect<void, CodexCommandError, R>,
  fallbackOutput: string
): Effect.Effect<string, CodexCommandError, R> =>
  Effect.gen(function*(_) {
    const lines: Array<string> = []
    const logger = Logger.make(({ message }) => {
      lines.push(String(message))
    })

    yield* _(effect.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))))
    return lines.length === 0 ? fallbackOutput : lines.join("\n")
  })

const resolveControllerEnvPath = (
  path: Path.Path,
  envGlobalPath: string
): string =>
  resolvePathFromCwd(path, process.cwd(), envGlobalPath)

const resolveControllerCodexPath = (path: Path.Path, authPath: string): string =>
  resolvePathFromCwd(path, process.cwd(), authPath)

const resolveCodexLabel = (label: string | null | undefined): string =>
  normalizeAccountLabel(label ?? null, "default")

const resolveCodexAccountPath = (
  path: Path.Path,
  authPath: string,
  label: string | null | undefined
): string => {
  const basePath = resolveControllerCodexPath(path, authPath)
  const normalizedLabel = resolveCodexLabel(label)
  return normalizedLabel === "default" ? basePath : path.join(basePath, normalizedLabel)
}

const resolveCodexAuthFilePath = (
  path: Path.Path,
  authPath: string,
  label: string | null | undefined
): string =>
  path.join(resolveCodexAccountPath(path, authPath, label), "auth.json")

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const readString = (record: JsonRecord, key: string): string | null => {
  const value = record[key]
  return typeof value === "string" && value.length > 0 ? value : null
}

const decodeJwtClaims = (jwt: string | null): JsonRecord | null => {
  if (jwt === null) {
    return null
  }
  const parts = jwt.split(".")
  if (parts.length !== 3) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(parts[1] ?? "", "base64url").toString("utf8"))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

const readNestedAccountId = (claims: JsonRecord): string | null => {
  const nested = claims["https://api.openai.com/auth"]
  if (!isRecord(nested)) {
    return null
  }
  return readString(nested, "chatgpt_account_id")
}

const extractCodexAccount = (parsed: JsonRecord): string | null => {
  const tokens = parsed["tokens"]
  const tokenRecord = isRecord(tokens) ? tokens : null
  const claims = decodeJwtClaims(readString(tokenRecord ?? {}, "id_token"))
  if (claims !== null) {
    const email = readString(claims, "email")
    if (email !== null) {
      return email
    }

    const preferredUsername = readString(claims, "preferred_username")
    if (preferredUsername !== null) {
      return preferredUsername
    }

    const name = readString(claims, "name")
    if (name !== null) {
      return name
    }

    const directAccountId = readString(claims, "chatgpt_account_id")
    if (directAccountId !== null) {
      return directAccountId
    }

    const nestedAccountId = readNestedAccountId(claims)
    if (nestedAccountId !== null) {
      return nestedAccountId
    }
  }

  return readString(tokenRecord ?? {}, "account_id")
}

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

const toGitlabTokenStatus = (
  entry: ReturnType<typeof listGitlabTokens>[number],
  validation: GitlabTokenValidationResult
): GitlabAuthTokenStatus => ({
  key: entry.key,
  label: entry.label,
  status: validation.status,
  login: validation.login
})

const buildGitlabStatusSummary = (tokens: ReadonlyArray<GitlabAuthTokenStatus>): string =>
  tokens.length === 0
    ? "GitLab not connected (no tokens)."
    : `GitLab tokens (${tokens.length}):`

const readGitlabAuthTokens = (
  envGlobalPath: string
): Effect.Effect<GitlabAuthStatus, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedEnvPath = resolveControllerEnvPath(path, envGlobalPath)
    const envText = yield* _(readEnvText(fs, resolvedEnvPath))
    const entries = listGitlabTokens(envText)
    const tokens: ReadonlyArray<GitlabAuthTokenStatus> = yield* _(
      Effect.forEach(
        entries,
        (entry) =>
          validateGitlabToken(entry.token).pipe(
            Effect.map((validation: GitlabTokenValidationResult) => toGitlabTokenStatus(entry, validation))
          ),
        { concurrency: "unbounded" }
      )
    )
    return {
      summary: buildGitlabStatusSummary(tokens),
      tokens
    } satisfies GitlabAuthStatus
  })

export const readGitlabAuthStatus = (): Effect.Effect<GitlabAuthStatus, PlatformError, FileSystem.FileSystem | Path.Path> =>
  readGitlabAuthTokens(githubAuthEnvGlobalPath)

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

export const loginGitlabAuth = (request: GitlabAuthLoginRequest) =>
  Effect.gen(function*(_) {
    yield* _(
      runGitlabLogin({
        _tag: "AuthGitlabLogin",
        label: request.label ?? null,
        token: request.token ?? null,
        envGlobalPath: githubAuthEnvGlobalPath
      })
    )
    return yield* _(readGitlabAuthTokens(githubAuthEnvGlobalPath))
  })

export const loginCodexAuth = (
  request: CodexAuthLoginRequest
): Effect.Effect<string, ApiBadRequestError | ApiInternalError, CodexRuntime> =>
  runWithCapturedLogs(
    runCodexLogin({
      _tag: "AuthCodexLogin",
      label: request.label ?? null,
      codexAuthPath
    }),
    "Codex login completed."
  ).pipe(
    Effect.flatMap((output) =>
      readCodexAuthStatus(request.label).pipe(
        Effect.map((status) => `${output}\n${status.message}`.trim())
      )
    ),
    Effect.mapError(toCodexApiError)
  )

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

export const logoutGitlabAuth = (request: GitlabAuthLogoutRequest) =>
  Effect.gen(function*(_) {
    yield* _(
      runGitlabLogout({
        _tag: "AuthGitlabLogout",
        label: request.label ?? null,
        envGlobalPath: githubAuthEnvGlobalPath
      })
    )
    return yield* _(readGitlabAuthTokens(githubAuthEnvGlobalPath))
  })

const codexAuthStatus = (
  present: boolean,
  label: string,
  authPath: string,
  account: string | null
): CodexAuthStatus => ({
  label,
  message: present
    ? account === null
      ? "Codex auth imported into controller state."
      : `Codex auth imported into controller state (account: ${account}).`
    : "Codex auth not found in controller state.",
  present,
  authPath,
  account
})

export const readCodexAuthStatus = (
  label?: string | null | undefined
): Effect.Effect<CodexAuthStatus, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedLabel = resolveCodexLabel(label)
    const resolvedAuthPath = resolveCodexAuthFilePath(path, codexAuthPath, label)
    const exists = yield* _(fs.exists(resolvedAuthPath))
    if (!exists) {
      return codexAuthStatus(false, resolvedLabel, resolvedAuthPath, null)
    }

    const info = yield* _(fs.stat(resolvedAuthPath))
    if (info.type !== "File") {
      return codexAuthStatus(false, resolvedLabel, resolvedAuthPath, null)
    }

    const authText = yield* _(fs.readFileString(resolvedAuthPath))
    const parsed = yield* _(
      Effect.sync(() => {
        try {
          const next: unknown = JSON.parse(authText)
          return next
        } catch {
          return null
        }
      })
    )
    const account = isRecord(parsed) ? extractCodexAccount(parsed) : null

    return codexAuthStatus(true, resolvedLabel, resolvedAuthPath, account)
  })

export const importCodexAuth = (
  request: CodexAuthImportRequest
): Effect.Effect<CodexAuthStatus, ApiBadRequestError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedAuthPath = resolveCodexAuthFilePath(path, codexAuthPath, request.label)
    const parsed = yield* _(
      Effect.try({
        try: () => JSON.parse(request.authText),
        catch: (cause) =>
          new ApiBadRequestError({
            message: "Invalid Codex auth JSON.",
            details: cause
          })
      })
    )

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "Codex auth JSON must be an object."
          })
        )
      )
    }

    yield* _(fs.makeDirectory(path.dirname(resolvedAuthPath), { recursive: true }))
    yield* _(fs.writeFileString(resolvedAuthPath, JSON.stringify(parsed, null, 2)))
    return yield* _(readCodexAuthStatus(request.label))
  })

export const logoutCodexAuth = (
  request: CodexAuthLogoutRequest
): Effect.Effect<CodexAuthStatus, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedAuthPath = resolveCodexAuthFilePath(path, codexAuthPath, request.label)
    const exists = yield* _(fs.exists(resolvedAuthPath))

    if (exists) {
      yield* _(fs.remove(resolvedAuthPath))
    }

    return yield* _(readCodexAuthStatus(request.label))
  })

export const ensureGithubAuthForCreate = (config: {
  readonly repoUrl: string
  readonly gitTokenLabel?: string | undefined
  readonly skipGithubAuth?: boolean | undefined
  readonly envGlobalPath: string
}): Effect.Effect<void, ApiAuthRequiredError | ApiBadRequestError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    if (parseGithubRepoUrl(config.repoUrl) === null) {
      return
    }

    if (config.skipGithubAuth === true) {
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
    yield* _(
      Match.value(validation.status).pipe(
        Match.when("valid", () => Effect.void),
        Match.when("invalid", () => Effect.fail(githubAuthError(githubInvalidTokenMessage))),
        Match.when("unknown", () => Effect.logWarning("Unable to validate GitHub token before create; continuing.")),
        Match.exhaustive
      )
    )

    const access = yield* _(probeGithubRepoAccess(config.repoUrl, token))
    return yield* _(
      Match.value(access).pipe(
        Match.when("accessible", () => Effect.void),
        Match.when("notAccessible", () =>
          Effect.fail(
            new ApiBadRequestError({
              message: githubRepoAccessMessage(config.repoUrl, true)
            })
          )),
        Match.when("unknown", () => Effect.logWarning(githubRepoAccessWarning)),
        Match.exhaustive
      )
    )
  })

export const ensureGitlabAuthForCreate = (config: {
  readonly repoUrl: string
  readonly gitTokenLabel?: string | undefined
  readonly envGlobalPath: string
}): Effect.Effect<void, ApiAuthRequiredError | ApiBadRequestError | PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    if (parseGitlabRepoUrl(config.repoUrl) === null) {
      return
    }

    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedEnvPath = resolveControllerEnvPath(path, config.envGlobalPath)
    const envText = yield* _(readEnvText(fs, resolvedEnvPath))
    const token = resolveGitlabCloneAuthToken(envText, {
      repoUrl: config.repoUrl,
      gitTokenLabel: config.gitTokenLabel
    })

    if (token === null) {
      return yield* _(Effect.fail(gitlabAuthError(gitlabAuthRequiredMessage)))
    }

    const validation: GitlabTokenValidationResult = yield* _(validateGitlabToken(token))
    yield* _(
      Match.value(validation.status).pipe(
        Match.when("valid", () => Effect.void),
        Match.when("invalid", () => Effect.fail(gitlabAuthError(gitlabInvalidTokenMessage))),
        Match.when("unknown", () => Effect.logWarning("Unable to validate GitLab token before create; continuing.")),
        Match.exhaustive
      )
    )

    const access = yield* _(probeGitlabRepoAccess(config.repoUrl, token))
    return yield* _(
      Match.value(access).pipe(
        Match.when("accessible", () => Effect.void),
        Match.when("notAccessible", () =>
          Effect.fail(
            new ApiBadRequestError({
              message: gitlabRepoAccessMessage(config.repoUrl, true)
            })
          )),
        Match.when("unknown", () => Effect.logWarning(gitlabRepoAccessWarning)),
        Match.exhaustive
      )
    )
  })

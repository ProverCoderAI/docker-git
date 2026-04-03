/* jscpd:ignore-start */
import { FetchHttpClient, HttpClient } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import { Effect, Match } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { parseGithubRepoUrl } from "../core/repo.js"
import { normalizeGitTokenLabel } from "../core/token-labels.js"
import { AuthError } from "../shell/errors.js"
import { findEnvValue, readEnvText } from "./env-file.js"
import {
  githubInvalidTokenMessage,
  githubTokenValidationWarning,
  validateGithubToken
} from "./github-token-validation.js"

export { githubInvalidTokenMessage } from "./github-token-validation.js"

export const githubMissingTokenMessage = [
  "GitHub auth is missing: no GitHub token/key was found for this repository.",
  "If the repository requires access, run: docker-git auth github login --web"
].join("\n")
export const githubRepoAccessWarning = "Unable to validate GitHub repository access before start; continuing."

export type GithubRepoAccessStatus = "accessible" | "notAccessible" | "unknown"

const defaultGithubTokenKeys: ReadonlyArray<string> = [
  "GIT_AUTH_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN"
]

export const githubRepoAccessMessage = (repoUrl: string, hasToken: boolean): string =>
  hasToken
    ? [
      `GitHub access denied for repository: ${repoUrl}`,
      "Reason: the repository does not exist, is private, or the selected token has no rights.",
      "If you need access, run: docker-git auth github login --web"
    ].join("\n")
    : [
      `GitHub repository is not accessible without auth: ${repoUrl}`,
      "Reason: the repository does not exist, is private, or a GitHub token/key is required.",
      "If you need access, run: docker-git auth github login --web"
    ].join("\n")

const findFirstEnvValue = (input: string, keys: ReadonlyArray<string>): string | null => {
  for (const key of keys) {
    const value = findEnvValue(input, key)
    if (value !== null) {
      return value
    }
  }
  return null
}

const resolvePreferredGithubTokenLabel = (
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel">
): string | undefined => {
  const explicit = normalizeGitTokenLabel(config.gitTokenLabel)
  if (explicit !== undefined) {
    return explicit
  }

  const repo = parseGithubRepoUrl(config.repoUrl)
  if (repo === null) {
    return undefined
  }

  return normalizeGitTokenLabel(repo.owner)
}

// CHANGE: resolve the GitHub token that clone will actually use for a repo URL
// WHY: preflight must validate the same labeled/default token selection as the entrypoint
// QUOTE(ТЗ): "ПУсть всегда проверяет токен гитхаба перед запуском"
// REF: user-request-2026-03-19-github-token-preflight
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg,env: resolve(cfg, env) = token_clone(cfg, env) ∨ null
// PURITY: CORE
// INVARIANT: labeled token has priority; falls back to default token keys
// COMPLEXITY: O(k) where k = |token keys|
export const resolveGithubCloneAuthToken = (
  envText: string,
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel">
): string | null => {
  if (parseGithubRepoUrl(config.repoUrl) === null) {
    return null
  }

  const preferredLabel = resolvePreferredGithubTokenLabel(config)
  if (preferredLabel !== undefined) {
    const labeledKeys = defaultGithubTokenKeys.map((key) => `${key}__${preferredLabel}`)
    const labeledToken = findFirstEnvValue(envText, labeledKeys)
    if (labeledToken !== null) {
      return labeledToken
    }
  }

  return findFirstEnvValue(envText, defaultGithubTokenKeys)
}

const mapGithubRepoAccessStatus = (status: number): GithubRepoAccessStatus => {
  if (status >= 200 && status < 300) {
    return "accessible"
  }
  if (status === 401 || status === 404) {
    return "notAccessible"
  }
  return "unknown"
}

// CHANGE: probe GitHub repository access the same way clone/auth selection will see it
// WHY: missing/private repos otherwise fail much later inside the container with a generic clone error
// QUOTE(ТЗ): "Всегда завершать верификацией инструментами"
// REF: user-request-2026-04-03-clone-debug
// SOURCE: n/a
// FORMAT THEOREM: ∀repo,token: probe(repo, token) = accessible → repo_visible(repo, token)
// PURITY: SHELL
// EFFECT: Effect<GithubRepoAccessStatus, never, never>
// INVARIANT: transport failures degrade to `unknown`; token is never logged
// COMPLEXITY: O(1) network round-trip
export const probeGithubRepoAccess = (
  repoUrl: string,
  token: string | null
): Effect.Effect<GithubRepoAccessStatus> =>
  Effect.gen(function*(_) {
    const repo = parseGithubRepoUrl(repoUrl)
    if (repo === null) {
      return "unknown" satisfies GithubRepoAccessStatus
    }

    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(
      client.get(`https://api.github.com/repos/${repo.owner}/${repo.repo}`, {
        headers: {
          ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
          Accept: "application/vnd.github+json"
        }
      })
    )

    return mapGithubRepoAccessStatus(response.status)
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.match({
      onFailure: () => "unknown" satisfies GithubRepoAccessStatus,
      onSuccess: (status) => status
    })
  )

// CHANGE: validate GitHub auth token before clone/create starts mutating the project
// WHY: dead tokens make git clone fail later with a misleading branch/auth error inside the container
// QUOTE(ТЗ): "Если токен мёртв то пусть пишет что надо зарегистрировать github используй docker-git auth github login --web"
// REF: user-request-2026-03-19-github-token-preflight
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: invalid_token(cfg) → fail_before_start(cfg)
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | PlatformError, FileSystem>
// INVARIANT: only GitHub repo URLs are gated; missing token is allowed here, invalid token fails unless auth is explicitly skipped
// COMPLEXITY: O(|env|) + O(1) network round-trip
export const validateGithubCloneAuthTokenPreflight = (
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel" | "skipGithubAuth" | "envGlobalPath">
): Effect.Effect<void, AuthError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    if (parseGithubRepoUrl(config.repoUrl) === null) {
      return
    }

    const token = config.skipGithubAuth
      ? null
      : yield* _(
        Effect.gen(function*(__) {
          const fs = yield* __(FileSystem.FileSystem)
          const envText = yield* __(readEnvText(fs, config.envGlobalPath))
          return resolveGithubCloneAuthToken(envText, config)
        })
      )

    if (token !== null) {
      const validation = yield* _(validateGithubToken(token))
      yield* _(
        Match.value(validation.status).pipe(
          Match.when("valid", () => Effect.void),
          Match.when("invalid", () => Effect.fail(new AuthError({ message: githubInvalidTokenMessage }))),
          Match.when("unknown", () => Effect.logWarning(githubTokenValidationWarning)),
          Match.exhaustive
        )
      )
    }

    const access = yield* _(probeGithubRepoAccess(config.repoUrl, token))
    yield* _(
      Match.value(access).pipe(
        Match.when("accessible", () => Effect.void),
        Match.when("notAccessible", () =>
          Effect.fail(new AuthError({ message: githubRepoAccessMessage(config.repoUrl, token !== null) }))),
        Match.when("unknown", () =>
          Effect.logWarning(githubRepoAccessWarning)),
        Match.exhaustive
      )
    )
  })
/* jscpd:ignore-end */

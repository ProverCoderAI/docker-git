import { FetchHttpClient, HttpClient } from "@effect/platform"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import { Effect, Match } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { parseGitlabRepoUrl } from "../core/repo.js"
import { normalizeGitTokenLabel } from "../core/token-labels.js"
import { AuthError } from "../shell/errors.js"
import { findEnvValue, readEnvText } from "./env-file.js"
import { getGitlabApi, gitlabBearerTokenHeaders, gitlabPrivateTokenHeaders } from "./gitlab-api.js"
import {
  gitlabInvalidTokenMessage,
  gitlabTokenValidationWarning,
  validateGitlabToken
} from "./gitlab-token-validation.js"

export { gitlabInvalidTokenMessage } from "./gitlab-token-validation.js"

export const gitlabMissingTokenMessage = [
  "GitLab auth is missing: no GitLab token/key was found for this repository.",
  "If the repository requires access, run: docker-git auth gitlab login"
].join("\n")
export const gitlabRepoAccessWarning = "Unable to validate GitLab repository access before start; continuing."

export type GitlabRepoAccessStatus = "accessible" | "notAccessible" | "unknown"

const defaultGitlabTokenKeys: ReadonlyArray<string> = [
  "GIT_AUTH_TOKEN",
  "GITLAB_TOKEN"
]

export const gitlabRepoAccessMessage = (repoUrl: string, hasToken: boolean): string =>
  hasToken
    ? [
      `GitLab access denied for repository: ${repoUrl}`,
      "Reason: the repository does not exist, is private, or the selected token has no rights.",
      "If you need access, run: docker-git auth gitlab login"
    ].join("\n")
    : [
      `GitLab repository is not accessible without auth: ${repoUrl}`,
      "Reason: the repository does not exist, is private, or a GitLab token/key is required.",
      "If you need access, run: docker-git auth gitlab login"
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

const resolvePreferredGitlabTokenLabel = (
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel">
): string | undefined => {
  const explicit = normalizeGitTokenLabel(config.gitTokenLabel)
  if (explicit !== undefined) {
    return explicit
  }

  const repo = parseGitlabRepoUrl(config.repoUrl)
  if (repo === null) {
    return undefined
  }

  return normalizeGitTokenLabel(repo.namespace.split("/")[0])
}

export const resolveGitlabCloneAuthToken = (
  envText: string,
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel">
): string | null => {
  if (parseGitlabRepoUrl(config.repoUrl) === null) {
    return null
  }

  const preferredLabel = resolvePreferredGitlabTokenLabel(config)
  if (preferredLabel !== undefined) {
    const labeledKeys = defaultGitlabTokenKeys.map((key) => `${key}__${preferredLabel}`)
    const labeledToken = findFirstEnvValue(envText, labeledKeys)
    if (labeledToken !== null) {
      return labeledToken
    }
  }

  return findFirstEnvValue(envText, defaultGitlabTokenKeys)
}

const mapGitlabRepoAccessStatus = (status: number): GitlabRepoAccessStatus => {
  if (status >= 200 && status < 300) {
    return "accessible"
  }
  if ([401, 403, 404].includes(status)) {
    return "notAccessible"
  }
  return "unknown"
}

const probeGitlabRepoAccessWithHeaders = (
  client: HttpClient.HttpClient,
  projectPath: string,
  headers: Record<string, string>
) =>
  getGitlabApi(client, `https://gitlab.com/api/v4/projects/${encodeURIComponent(projectPath)}`, headers).pipe(
    Effect.map((response) => mapGitlabRepoAccessStatus(response.status))
  )

export const probeGitlabRepoAccess = (
  repoUrl: string,
  token: string | null
): Effect.Effect<GitlabRepoAccessStatus> =>
  Effect.gen(function*(_) {
    const repo = parseGitlabRepoUrl(repoUrl)
    if (repo === null) {
      return "unknown" satisfies GitlabRepoAccessStatus
    }

    const client = yield* _(HttpClient.HttpClient)
    if (token === null) {
      return yield* _(probeGitlabRepoAccessWithHeaders(client, repo.projectPath, {}))
    }

    const privateTokenAccess = yield* _(
      probeGitlabRepoAccessWithHeaders(client, repo.projectPath, gitlabPrivateTokenHeaders(token))
    )
    if (privateTokenAccess !== "notAccessible") {
      return privateTokenAccess
    }
    return yield* _(probeGitlabRepoAccessWithHeaders(client, repo.projectPath, gitlabBearerTokenHeaders(token)))
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.match({
      onFailure: () => "unknown" satisfies GitlabRepoAccessStatus,
      onSuccess: (status) => status
    })
  )

export const validateGitlabCloneAuthTokenPreflight = (
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel" | "envGlobalPath">
): Effect.Effect<void, AuthError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    if (parseGitlabRepoUrl(config.repoUrl) === null) {
      return
    }

    const token = yield* _(
      Effect.gen(function*(__) {
        const fs = yield* __(FileSystem.FileSystem)
        const envText = yield* __(readEnvText(fs, config.envGlobalPath))
        return resolveGitlabCloneAuthToken(envText, config)
      })
    )

    if (token !== null) {
      const validation = yield* _(validateGitlabToken(token))
      yield* _(
        Match.value(validation.status).pipe(
          Match.when("valid", () => Effect.void),
          Match.when("invalid", () => Effect.fail(new AuthError({ message: gitlabInvalidTokenMessage }))),
          Match.when("unknown", () => Effect.logWarning(gitlabTokenValidationWarning)),
          Match.exhaustive
        )
      )
    }

    const access = yield* _(probeGitlabRepoAccess(config.repoUrl, token))
    yield* _(
      Match.value(access).pipe(
        Match.when("accessible", () => Effect.void),
        Match.when("notAccessible", () =>
          Effect.fail(new AuthError({ message: gitlabRepoAccessMessage(config.repoUrl, token !== null) }))),
        Match.when("unknown", () =>
          Effect.logWarning(gitlabRepoAccessWarning)),
        Match.exhaustive
      )
    )
  })

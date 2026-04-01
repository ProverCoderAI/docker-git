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

const defaultGithubTokenKeys: ReadonlyArray<string> = [
  "GIT_AUTH_TOKEN",
  "GITHUB_TOKEN",
  "GH_TOKEN"
]

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

// CHANGE: validate GitHub auth token before clone/create starts mutating the project
// WHY: dead tokens make git clone fail later with a misleading branch/auth error inside the container
// QUOTE(ТЗ): "Если токен мёртв то пусть пишет что надо зарегистрировать github используй docker-git auth github login --web"
// REF: user-request-2026-03-19-github-token-preflight
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: invalid_token(cfg) → fail_before_start(cfg)
// PURITY: SHELL
// EFFECT: Effect<void, AuthError | PlatformError, FileSystem>
// INVARIANT: only GitHub repo URLs with a configured token are validated
// COMPLEXITY: O(|env|) + O(1) network round-trip
export const validateGithubCloneAuthTokenPreflight = (
  config: Pick<TemplateConfig, "repoUrl" | "gitTokenLabel" | "envGlobalPath">
): Effect.Effect<void, AuthError | PlatformError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const envText = yield* _(readEnvText(fs, config.envGlobalPath))
    const token = resolveGithubCloneAuthToken(envText, config)

    if (token === null) {
      return
    }

    const validation = yield* _(validateGithubToken(token))
    yield* _(
      Match.value(validation.status).pipe(
        Match.when("valid", () => Effect.void),
        Match.when("invalid", () => Effect.fail(new AuthError({ message: githubInvalidTokenMessage }))),
        Match.when("unknown", () => Effect.logWarning(githubTokenValidationWarning)),
        Match.exhaustive
      )
    )
  })

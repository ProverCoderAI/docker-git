import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import { Effect, Match } from "effect"

import { AuthError } from "@effect-template/lib/shell/errors"
import { normalizeAccountLabel } from "@effect-template/lib/usecases/auth-helpers"
import { findEnvValue, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import type { AppError } from "@effect-template/lib/usecases/errors"

import { buildLabeledEnvKey } from "./menu-labeled-env.js"
import { hasClaudeAccountCredentials } from "./menu-project-auth-claude.js"
import { hasGeminiAccountCredentials } from "./menu-project-auth-gemini.js"
import type { ProjectAuthFlow } from "./menu-types.js"

export type ProjectEnvUpdateSpec = {
  readonly fs: FileSystem.FileSystem
  readonly rawLabel: string
  readonly canonicalLabel: string
  readonly globalEnvPath: string
  readonly globalEnvText: string
  readonly projectEnvText: string
  readonly claudeAuthPath: string
  readonly geminiAuthPath: string
}

const githubTokenBaseKey = "GITHUB_TOKEN"
const gitTokenBaseKey = "GIT_AUTH_TOKEN"
const gitUserBaseKey = "GIT_AUTH_USER"
const projectGithubLabelKey = "GITHUB_AUTH_LABEL"
const projectGitLabelKey = "GIT_AUTH_LABEL"
const projectClaudeLabelKey = "CLAUDE_AUTH_LABEL"
const projectGeminiLabelKey = "GEMINI_AUTH_LABEL"
const defaultGitUser = "x-access-token"

const missingSecret = (provider: string, label: string, envPath: string): AuthError =>
  new AuthError({ message: `${provider} not connected: label '${label}' not found in ${envPath}` })

const clearProjectGitLabels = (envText: string): string => {
  const withoutGhToken = upsertEnvKey(envText, "GH_TOKEN", "")
  const withoutGitLabel = upsertEnvKey(withoutGhToken, projectGitLabelKey, "")
  return upsertEnvKey(withoutGitLabel, projectGithubLabelKey, "")
}

const updateProjectGithubConnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string, AppError> => {
  const key = buildLabeledEnvKey(githubTokenBaseKey, spec.rawLabel)
  const token = findEnvValue(spec.globalEnvText, key)
  if (token === null) {
    return Effect.fail(missingSecret("GitHub token", spec.canonicalLabel, spec.globalEnvPath))
  }
  const withGitToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", token)
  const withGhToken = upsertEnvKey(withGitToken, "GH_TOKEN", token)
  const withoutGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, "")
  return Effect.succeed(upsertEnvKey(withoutGitLabel, projectGithubLabelKey, spec.canonicalLabel))
}

const updateProjectGithubDisconnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string> => {
  const withoutGitToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", "")
  return Effect.succeed(clearProjectGitLabels(withoutGitToken))
}

const updateProjectGitConnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string, AppError> => {
  const tokenKey = buildLabeledEnvKey(gitTokenBaseKey, spec.rawLabel)
  const userKey = buildLabeledEnvKey(gitUserBaseKey, spec.rawLabel)
  const token = findEnvValue(spec.globalEnvText, tokenKey)
  if (token === null) {
    return Effect.fail(missingSecret("Git credentials", spec.canonicalLabel, spec.globalEnvPath))
  }
  const defaultUser = findEnvValue(spec.globalEnvText, gitUserBaseKey) ?? defaultGitUser
  const user = findEnvValue(spec.globalEnvText, userKey) ?? defaultUser
  const withToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", token)
  const withUser = upsertEnvKey(withToken, "GIT_AUTH_USER", user)
  const withGhToken = upsertEnvKey(withUser, "GH_TOKEN", token)
  const withGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, spec.canonicalLabel)
  return Effect.succeed(upsertEnvKey(withGitLabel, projectGithubLabelKey, spec.canonicalLabel))
}

const updateProjectGitDisconnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string> => {
  const withoutToken = upsertEnvKey(spec.projectEnvText, "GIT_AUTH_TOKEN", "")
  const withoutUser = upsertEnvKey(withoutToken, "GIT_AUTH_USER", "")
  return Effect.succeed(clearProjectGitLabels(withoutUser))
}

type CredentialsChecker = (
  fs: FileSystem.FileSystem,
  accountPath: string
) => Effect.Effect<boolean, PlatformError>

const resolveAccountCandidates = (authPath: string, accountLabel: string): ReadonlyArray<string> =>
  accountLabel === "default" ? [`${authPath}/default`, authPath] : [`${authPath}/${accountLabel}`]

const findFirstCredentialsMatch = (
  fs: FileSystem.FileSystem,
  candidates: ReadonlyArray<string>,
  hasCredentials: CredentialsChecker
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    for (const accountPath of candidates) {
      const exists = yield* _(fs.exists(accountPath))
      if (!exists) continue
      const valid = yield* _(hasCredentials(fs, accountPath), Effect.orElseSucceed(() => false))
      if (valid) return accountPath
    }
    return null
  })

const updateProjectClaudeConnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string, AppError> => {
  const accountLabel = normalizeAccountLabel(spec.rawLabel, "default")
  const accountCandidates = resolveAccountCandidates(spec.claudeAuthPath, accountLabel)
  return findFirstCredentialsMatch(spec.fs, accountCandidates, hasClaudeAccountCredentials).pipe(
    Effect.flatMap((matched) =>
      matched === null
        ? Effect.fail(missingSecret("Claude Code login", spec.canonicalLabel, spec.claudeAuthPath))
        : Effect.succeed(upsertEnvKey(spec.projectEnvText, projectClaudeLabelKey, spec.canonicalLabel))
    )
  )
}

const updateProjectClaudeDisconnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string> =>
  Effect.succeed(upsertEnvKey(spec.projectEnvText, projectClaudeLabelKey, ""))

const updateProjectGeminiConnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string, AppError> => {
  const accountLabel = normalizeAccountLabel(spec.rawLabel, "default")
  const accountCandidates = resolveAccountCandidates(spec.geminiAuthPath, accountLabel)
  return findFirstCredentialsMatch(spec.fs, accountCandidates, hasGeminiAccountCredentials).pipe(
    Effect.flatMap((matched) =>
      matched === null
        ? Effect.fail(missingSecret("Gemini CLI API key", spec.canonicalLabel, spec.geminiAuthPath))
        : Effect.succeed(upsertEnvKey(spec.projectEnvText, projectGeminiLabelKey, spec.canonicalLabel))
    )
  )
}

const updateProjectGeminiDisconnect = (spec: ProjectEnvUpdateSpec): Effect.Effect<string> =>
  Effect.succeed(upsertEnvKey(spec.projectEnvText, projectGeminiLabelKey, ""))

export const resolveProjectEnvUpdate = (
  flow: ProjectAuthFlow,
  spec: ProjectEnvUpdateSpec
): Effect.Effect<string, AppError> =>
  Match.value(flow).pipe(
    Match.when("ProjectGithubConnect", () => updateProjectGithubConnect(spec)),
    Match.when("ProjectGithubDisconnect", () => updateProjectGithubDisconnect(spec)),
    Match.when("ProjectGitConnect", () => updateProjectGitConnect(spec)),
    Match.when("ProjectGitDisconnect", () => updateProjectGitDisconnect(spec)),
    Match.when("ProjectClaudeConnect", () => updateProjectClaudeConnect(spec)),
    Match.when("ProjectClaudeDisconnect", () => updateProjectClaudeDisconnect(spec)),
    Match.when("ProjectGeminiConnect", () => updateProjectGeminiConnect(spec)),
    Match.when("ProjectGeminiDisconnect", () => updateProjectGeminiDisconnect(spec)),
    Match.exhaustive
  )

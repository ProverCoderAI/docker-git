import * as FileSystem from "@effect/platform/FileSystem"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { Effect, Match, pipe } from "effect"

import { parseEnvEntries, readEnvText, upsertEnvKey, findEnvValue, ensureEnvFile } from "@effect-template/lib/usecases/env-file"
import { renderError, type AppError } from "@effect-template/lib/usecases/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"
import { normalizeAccountLabel } from "@effect-template/lib/usecases/auth-helpers"

import type { ProjectAuthFlow, ProjectAuthRequest, ProjectAuthSnapshot, ProjectDetails } from "../api/contracts.js"
import { ApiBadRequestError } from "../api/errors.js"

type ProjectAuthRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

const claudeAuthRoot = `${defaultProjectsRoot(process.cwd())}/.orch/auth/claude`
const geminiAuthRoot = `${defaultProjectsRoot(process.cwd())}/.orch/auth/gemini`
const grokAuthRoot = `${defaultProjectsRoot(process.cwd())}/.orch/auth/grok`
const globalEnvPath = `${defaultProjectsRoot(process.cwd())}/.orch/env/global.env`

const githubTokenBaseKey = "GITHUB_TOKEN"
const gitTokenBaseKey = "GIT_AUTH_TOKEN"
const gitUserBaseKey = "GIT_AUTH_USER"
const projectGithubLabelKey = "GITHUB_AUTH_LABEL"
const projectGitLabelKey = "GIT_AUTH_LABEL"
const projectClaudeLabelKey = "CLAUDE_AUTH_LABEL"
const projectGeminiLabelKey = "GEMINI_AUTH_LABEL"
const projectGrokLabelKey = "GROK_AUTH_LABEL"
const defaultGitUser = "x-access-token"
const grokEnvApiKeyNames: ReadonlyArray<string> = ["GROK_DEPLOYMENT_KEY", "GROK_API_KEY", "XAI_API_KEY"]

const normalizeLabel = (value: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return ""
  }

  const normalized = trimmed.toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_")
  let start = 0
  while (start < normalized.length && normalized[start] === "_") {
    start += 1
  }
  let end = normalized.length
  while (end > start && normalized[end - 1] === "_") {
    end -= 1
  }
  return normalized.slice(start, end)
}

const canonicalLabel = (value: string | null | undefined): string => {
  const normalized = normalizeLabel(value ?? "")
  return normalized.length === 0 || normalized === "DEFAULT" ? "default" : normalized
}

const buildLabeledEnvKey = (baseKey: string, label: string): string => {
  const normalized = normalizeLabel(label)
  if (normalized.length === 0 || normalized === "DEFAULT") {
    return baseKey
  }
  return `${baseKey}__${normalized}`
}

const countKeyEntries = (envText: string, baseKey: string): number => {
  const prefix = `${baseKey}__`
  return parseEnvEntries(envText)
    .filter((entry) => entry.value.trim().length > 0 && (entry.key === baseKey || entry.key.startsWith(prefix)))
    .length
}

const hasFileAtPath = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return false
    }
    const info = yield* _(fs.stat(filePath))
    return info.type === "File"
  })

const countAuthAccountDirectories = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    const exists = yield* _(fs.exists(root))
    if (!exists) {
      return 0
    }

    const entries = yield* _(fs.readDirectory(root))
    let count = 0
    for (const entry of entries) {
      if (entry === ".image") {
        continue
      }

      const fullPath = path.join(root, entry)
      const info = yield* _(fs.stat(fullPath))
      if (info.type === "Directory") {
        count += 1
      }
    }

    return count
  })

const hasNonEmptyOauthToken = (
  fs: FileSystem.FileSystem,
  tokenPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, tokenPath))
    if (!hasFile) {
      return false
    }

    const tokenValue = yield* _(fs.readFileString(tokenPath), Effect.orElseSucceed(() => ""))
    return tokenValue.trim().length > 0
  })

const hasLegacyClaudeAuthFile = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const entries = yield* _(fs.readDirectory(accountPath))
    for (const entry of entries) {
      if (!entry.startsWith(".claude") || !entry.endsWith(".json")) {
        continue
      }

      const isFile = yield* _(hasFileAtPath(fs, `${accountPath}/${entry}`))
      if (isFile) {
        return true
      }
    }

    return false
  })

const hasClaudeAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasFileAtPath(fs, `${accountPath}/.credentials.json`).pipe(
    Effect.flatMap((hasCredentialsFile) => {
      if (hasCredentialsFile) {
        return Effect.succeed(true)
      }
      return hasFileAtPath(fs, `${accountPath}/.claude/.credentials.json`)
    }),
    Effect.flatMap((hasNestedCredentialsFile) => {
      if (hasNestedCredentialsFile) {
        return Effect.succeed(true)
      }
      return hasFileAtPath(fs, `${accountPath}/.config.json`)
    }),
    Effect.flatMap((hasConfig) => {
      if (hasConfig) {
        return Effect.succeed(true)
      }
      return hasNonEmptyOauthToken(fs, `${accountPath}/.oauth-token`).pipe(
        Effect.flatMap((hasOauthToken) => hasOauthToken ? Effect.succeed(true) : hasLegacyClaudeAuthFile(fs, accountPath))
      )
    })
  )

const hasApiKeyInEnvFile = (
  fs: FileSystem.FileSystem,
  envFilePath: string,
  key: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, envFilePath))
    if (!hasFile) {
      return false
    }

    const envContent = yield* _(fs.readFileString(envFilePath), Effect.orElseSucceed(() => ""))
    const prefix = `${key}=`
    for (const line of envContent.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed.startsWith(prefix)) {
        continue
      }
      const value = trimmed.slice(prefix.length).replaceAll(/^['"]|['"]$/g, "").trim()
      if (value.length > 0) {
        return true
      }
    }
    return false
  })

const hasNonEmptyApiKeyFile = (
  fs: FileSystem.FileSystem,
  filePath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, filePath))
    if (!hasFile) {
      return false
    }

    const apiKey = yield* _(fs.readFileString(filePath), Effect.orElseSucceed(() => ""))
    return apiKey.trim().length > 0
  })

const checkAnyFileExists = (
  fs: FileSystem.FileSystem,
  basePath: string,
  fileNames: ReadonlyArray<string>
): Effect.Effect<boolean, PlatformError> => {
  const [first, ...rest] = fileNames
  if (first === undefined) {
    return Effect.succeed(false)
  }

  return hasFileAtPath(fs, `${basePath}/${first}`).pipe(
    Effect.flatMap((exists) => exists ? Effect.succeed(true) : checkAnyFileExists(fs, basePath, rest))
  )
}

const hasGeminiAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasFileAtPath(fs, `${accountPath}/.api-key`).pipe(
    Effect.flatMap((hasApiKey) => {
      if (hasApiKey) {
        return Effect.succeed(true)
      }

      return hasApiKeyInEnvFile(fs, `${accountPath}/.env`, "GEMINI_API_KEY").pipe(
        Effect.flatMap((hasEnvApiKey) => {
          if (hasEnvApiKey) {
            return Effect.succeed(true)
          }
          return checkAnyFileExists(fs, `${accountPath}/.gemini`, [
            "oauth-tokens.json",
            "credentials.json",
            "application_default_credentials.json"
          ])
        })
      )
    })
  )

const grokUserSettingsCredentialMarkers: ReadonlyArray<RegExp> = [
  /"apiKey"\s*:\s*"[^"]+"/u,
  /"accessToken"\s*:\s*"[^"]+"/u,
  /"refreshToken"\s*:\s*"[^"]+"/u,
  /"authToken"\s*:\s*"[^"]+"/u,
  /"oauth"\s*:\s*\{[\s\S]*?"(?:apiKey|accessToken|access_token|authToken|refreshToken|refresh_token|token)"\s*:\s*"[^"]+"/u
]

const grokAuthJsonCredentialMarkers: ReadonlyArray<RegExp> = [
  /"key"\s*:\s*"[^"]+"/u,
  /"token"\s*:\s*"[^"]+"/u,
  /"accessToken"\s*:\s*"[^"]+"/u
]

const hasGrokUserSettingsCredentials = (
  fs: FileSystem.FileSystem,
  settingsPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, settingsPath))
    if (!hasFile) {
      return false
    }

    const settingsText = yield* _(fs.readFileString(settingsPath), Effect.orElseSucceed(() => ""))
    return grokUserSettingsCredentialMarkers.some((marker) => marker.test(settingsText))
  })

const hasGrokAuthJsonCredentials = (
  fs: FileSystem.FileSystem,
  authJsonPath: string
): Effect.Effect<boolean, PlatformError> =>
  Effect.gen(function*(_) {
    const hasFile = yield* _(hasFileAtPath(fs, authJsonPath))
    if (!hasFile) {
      return false
    }

    const authJsonText = yield* _(fs.readFileString(authJsonPath), Effect.orElseSucceed(() => ""))
    return grokAuthJsonCredentialMarkers.some((marker) => marker.test(authJsonText))
  })

const hasGrokAccountCredentials = (
  fs: FileSystem.FileSystem,
  accountPath: string
): Effect.Effect<boolean, PlatformError> =>
  hasNonEmptyApiKeyFile(fs, `${accountPath}/.api-key`).pipe(
    Effect.flatMap((hasApiKey) => {
      if (hasApiKey) {
        return Effect.succeed(true)
      }

      return Effect.forEach(grokEnvApiKeyNames, (key) => hasApiKeyInEnvFile(fs, `${accountPath}/.env`, key)).pipe(
        Effect.map((results) => results.some((result) => result)),
        Effect.flatMap((hasEnvApiKey) => {
          if (hasEnvApiKey) {
            return Effect.succeed(true)
          }
          return hasGrokAuthJsonCredentials(fs, `${accountPath}/.grok/auth.json`).pipe(
            Effect.flatMap((hasAuthJson) =>
              hasAuthJson
                ? Effect.succeed(true)
                : hasGrokUserSettingsCredentials(fs, `${accountPath}/.grok/user-settings.json`)
            )
          )
        })
      )
    })
  )

const resolveAccountCandidates = (authPath: string, accountLabel: string): ReadonlyArray<string> =>
  accountLabel === "default" ? [`${authPath}/default`, authPath] : [`${authPath}/${accountLabel}`]

const findFirstCredentialsMatch = (
  fs: FileSystem.FileSystem,
  candidates: ReadonlyArray<string>,
  hasCredentials: (
    fs: FileSystem.FileSystem,
    accountPath: string
  ) => Effect.Effect<boolean, PlatformError>
): Effect.Effect<string | null, PlatformError> =>
  Effect.gen(function*(_) {
    for (const accountPath of candidates) {
      const exists = yield* _(fs.exists(accountPath))
      if (!exists) {
        continue
      }

      const valid = yield* _(hasCredentials(fs, accountPath), Effect.orElseSucceed(() => false))
      if (valid) {
        return accountPath
      }
    }

    return null
  })

const missingSecret = (provider: string, label: string, envPath: string): ApiBadRequestError =>
  new ApiBadRequestError({ message: `${provider} not connected: label '${label}' not found in ${envPath}` })

const clearProjectGitLabels = (envText: string): string => {
  const withoutGhToken = upsertEnvKey(envText, "GH_TOKEN", "")
  const withoutGitLabel = upsertEnvKey(withoutGhToken, projectGitLabelKey, "")
  return upsertEnvKey(withoutGitLabel, projectGithubLabelKey, "")
}

const loadProjectAuthEnvText = (
  project: ProjectDetails
): Effect.Effect<
  {
    readonly fs: FileSystem.FileSystem
    readonly path: Path.Path
    readonly globalEnvText: string
    readonly projectEnvText: string
  },
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    yield* _(ensureEnvFile(fs, path, globalEnvPath))
    yield* _(ensureEnvFile(fs, path, project.envProjectPath))
    const globalEnvText = yield* _(readEnvText(fs, globalEnvPath))
    const projectEnvText = yield* _(readEnvText(fs, project.envProjectPath))
    return { fs, path, globalEnvText, projectEnvText }
  })

export const readProjectAuthSnapshot = (
  project: ProjectDetails
): Effect.Effect<ProjectAuthSnapshot, PlatformError, FileSystem.FileSystem | Path.Path> =>
  pipe(
    loadProjectAuthEnvText(project),
    Effect.flatMap(({ fs, path, globalEnvText, projectEnvText }) =>
      Effect.all({
        claudeAuthEntries: countAuthAccountDirectories(fs, path, claudeAuthRoot),
        geminiAuthEntries: countAuthAccountDirectories(fs, path, geminiAuthRoot),
        grokAuthEntries: countAuthAccountDirectories(fs, path, grokAuthRoot)
      }).pipe(
        Effect.map(({ claudeAuthEntries, geminiAuthEntries, grokAuthEntries }) => ({
          projectDir: project.projectDir,
          projectName: project.displayName,
          envGlobalPath: globalEnvPath,
          envProjectPath: project.envProjectPath,
          claudeAuthPath: claudeAuthRoot,
          geminiAuthPath: geminiAuthRoot,
          grokAuthPath: grokAuthRoot,
          githubTokenEntries: countKeyEntries(globalEnvText, githubTokenBaseKey),
          gitTokenEntries: countKeyEntries(globalEnvText, gitTokenBaseKey),
          claudeAuthEntries,
          geminiAuthEntries,
          grokAuthEntries,
          activeGithubLabel: findEnvValue(projectEnvText, projectGithubLabelKey),
          activeGitLabel: findEnvValue(projectEnvText, projectGitLabelKey),
          activeClaudeLabel: findEnvValue(projectEnvText, projectClaudeLabelKey),
          activeGeminiLabel: findEnvValue(projectEnvText, projectGeminiLabelKey),
          activeGrokLabel: findEnvValue(projectEnvText, projectGrokLabelKey)
        }))
      )
    )
  )

const resolveSyncMessage = (flow: ProjectAuthFlow, label: string, displayName: string): string =>
  Match.value(flow).pipe(
    Match.when("ProjectGithubConnect", () => `chore(state): project auth gh ${label} ${displayName}`),
    Match.when("ProjectGithubDisconnect", () => `chore(state): project auth gh logout ${displayName}`),
    Match.when("ProjectGitConnect", () => `chore(state): project auth git ${label} ${displayName}`),
    Match.when("ProjectGitDisconnect", () => `chore(state): project auth git logout ${displayName}`),
    Match.when("ProjectClaudeConnect", () => `chore(state): project auth claude ${label} ${displayName}`),
    Match.when("ProjectClaudeDisconnect", () => `chore(state): project auth claude logout ${displayName}`),
    Match.when("ProjectGeminiConnect", () => `chore(state): project auth gemini ${label} ${displayName}`),
    Match.when("ProjectGeminiDisconnect", () => `chore(state): project auth gemini logout ${displayName}`),
    Match.when("ProjectGrokConnect", () => `chore(state): project auth grok ${label} ${displayName}`),
    Match.when("ProjectGrokDisconnect", () => `chore(state): project auth grok logout ${displayName}`),
    Match.exhaustive
  )

const resolveProjectEnvUpdate = (
  project: ProjectDetails,
  request: ProjectAuthRequest
): Effect.Effect<string, ApiBadRequestError, FileSystem.FileSystem | Path.Path> =>
  pipe(
    loadProjectAuthEnvText(project),
    Effect.flatMap(({ fs, globalEnvText, projectEnvText }) => {
      const rawLabel = request.label ?? ""
      const normalizedLabel = canonicalLabel(rawLabel)
      return Match.value(request.flow).pipe(
        Match.when("ProjectGithubConnect", () => {
          const token = findEnvValue(globalEnvText, buildLabeledEnvKey(githubTokenBaseKey, rawLabel))
          if (token === null) {
            return Effect.fail(missingSecret("GitHub token", normalizedLabel, globalEnvPath))
          }
          const withGitToken = upsertEnvKey(projectEnvText, "GIT_AUTH_TOKEN", token)
          const withGhToken = upsertEnvKey(withGitToken, "GH_TOKEN", token)
          const withoutGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, "")
          return Effect.succeed(upsertEnvKey(withoutGitLabel, projectGithubLabelKey, normalizedLabel))
        }),
        Match.when("ProjectGithubDisconnect", () => {
          const withoutGitToken = upsertEnvKey(projectEnvText, "GIT_AUTH_TOKEN", "")
          return Effect.succeed(clearProjectGitLabels(withoutGitToken))
        }),
        Match.when("ProjectGitConnect", () => {
          const token = findEnvValue(globalEnvText, buildLabeledEnvKey(gitTokenBaseKey, rawLabel))
          if (token === null) {
            return Effect.fail(missingSecret("Git credentials", normalizedLabel, globalEnvPath))
          }
          const user = findEnvValue(globalEnvText, buildLabeledEnvKey(gitUserBaseKey, rawLabel)) ??
            findEnvValue(globalEnvText, gitUserBaseKey) ?? defaultGitUser
          const withToken = upsertEnvKey(projectEnvText, "GIT_AUTH_TOKEN", token)
          const withUser = upsertEnvKey(withToken, "GIT_AUTH_USER", user)
          const withGhToken = upsertEnvKey(withUser, "GH_TOKEN", token)
          const withGitLabel = upsertEnvKey(withGhToken, projectGitLabelKey, normalizedLabel)
          return Effect.succeed(upsertEnvKey(withGitLabel, projectGithubLabelKey, normalizedLabel))
        }),
        Match.when("ProjectGitDisconnect", () => {
          const withoutToken = upsertEnvKey(projectEnvText, "GIT_AUTH_TOKEN", "")
          const withoutUser = upsertEnvKey(withoutToken, "GIT_AUTH_USER", "")
          return Effect.succeed(clearProjectGitLabels(withoutUser))
        }),
        Match.when("ProjectClaudeConnect", () =>
          findFirstCredentialsMatch(
            fs,
            resolveAccountCandidates(claudeAuthRoot, normalizeAccountLabel(request.label ?? null, "default")),
            hasClaudeAccountCredentials
          ).pipe(
            Effect.flatMap((matched) =>
              matched === null
                ? Effect.fail(missingSecret("Claude Code login", normalizedLabel, claudeAuthRoot))
                : Effect.succeed(upsertEnvKey(projectEnvText, projectClaudeLabelKey, normalizedLabel))
            )
          )),
        Match.when("ProjectClaudeDisconnect", () =>
          Effect.succeed(upsertEnvKey(projectEnvText, projectClaudeLabelKey, ""))
        ),
        Match.when("ProjectGeminiConnect", () =>
          findFirstCredentialsMatch(
            fs,
            resolveAccountCandidates(geminiAuthRoot, normalizeAccountLabel(request.label ?? null, "default")),
            hasGeminiAccountCredentials
          ).pipe(
            Effect.flatMap((matched) =>
              matched === null
                ? Effect.fail(missingSecret("Gemini CLI API key", normalizedLabel, geminiAuthRoot))
                : Effect.succeed(upsertEnvKey(projectEnvText, projectGeminiLabelKey, normalizedLabel))
            )
          )),
        Match.when("ProjectGeminiDisconnect", () =>
          Effect.succeed(upsertEnvKey(projectEnvText, projectGeminiLabelKey, ""))
        ),
        Match.when("ProjectGrokConnect", () =>
          findFirstCredentialsMatch(
            fs,
            resolveAccountCandidates(grokAuthRoot, normalizeAccountLabel(request.label ?? null, "default")),
            hasGrokAccountCredentials
          ).pipe(
            Effect.flatMap((matched) =>
              matched === null
                ? Effect.fail(missingSecret("Grok CLI login", normalizedLabel, grokAuthRoot))
                : Effect.succeed(upsertEnvKey(projectEnvText, projectGrokLabelKey, normalizedLabel))
            )
          )),
        Match.when("ProjectGrokDisconnect", () =>
          Effect.succeed(upsertEnvKey(projectEnvText, projectGrokLabelKey, ""))
        ),
        Match.exhaustive
      )
    }),
    Effect.mapError((error) =>
      error instanceof ApiBadRequestError ? error : new ApiBadRequestError({ message: String(error) })
    )
  )

const toBadRequestError = (error: AppError | ApiBadRequestError | PlatformError): ApiBadRequestError =>
  error instanceof ApiBadRequestError
    ? error
    : new ApiBadRequestError({ message: "_tag" in error ? renderError(error as AppError) : String(error) })

export const runProjectAuthFlow = (
  project: ProjectDetails,
  request: ProjectAuthRequest
): Effect.Effect<ProjectAuthSnapshot, ApiBadRequestError, ProjectAuthRuntime> =>
  pipe(
    resolveProjectEnvUpdate(project, request),
    Effect.flatMap((nextText) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        yield* _(fs.writeFileString(project.envProjectPath, nextText))
      })
    ),
    Effect.zipRight(autoSyncState(resolveSyncMessage(request.flow, canonicalLabel(request.label), project.displayName))),
    Effect.mapError(toBadRequestError),
    Effect.zipRight(readProjectAuthSnapshot(project)),
    Effect.mapError((error) =>
      toBadRequestError(error as AppError | ApiBadRequestError | PlatformError)
    )
  )

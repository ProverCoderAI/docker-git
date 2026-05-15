import * as FileSystem from "@effect/platform/FileSystem"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as Path from "@effect/platform/Path"
import { authClaudeLogout, authGeminiLogin, authGeminiLogout, authGrokLogin, authGrokLogout } from "@effect-template/lib/usecases/auth"
import { ensureEnvFile, parseEnvEntries, readEnvText, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import { renderError, type AppError } from "@effect-template/lib/usecases/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"
import { Effect, pipe } from "effect"

import type { AuthMenuRequest, AuthSnapshot } from "../api/contracts.js"
import { ApiBadRequestError } from "../api/errors.js"

type MenuAuthRuntime = FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor

const claudeAuthRoot = `${defaultProjectsRoot(process.cwd())}/.orch/auth/claude`
const geminiAuthRoot = `${defaultProjectsRoot(process.cwd())}/.orch/auth/gemini`
const grokAuthRoot = `${defaultProjectsRoot(process.cwd())}/.orch/auth/grok`
const globalEnvPath = `${defaultProjectsRoot(process.cwd())}/.orch/env/global.env`

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

const loadAuthEnvText = (): Effect.Effect<
  {
    readonly fs: FileSystem.FileSystem
    readonly path: Path.Path
    readonly envText: string
  },
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    yield* _(ensureEnvFile(fs, path, globalEnvPath))
    const envText = yield* _(readEnvText(fs, globalEnvPath))
    return { fs, path, envText }
  })

export const readAuthMenuSnapshot = (): Effect.Effect<AuthSnapshot, PlatformError, FileSystem.FileSystem | Path.Path> =>
  pipe(
    loadAuthEnvText(),
    Effect.flatMap(({ envText, fs, path }) =>
      Effect.all({
        claudeAuthEntries: countAuthAccountDirectories(fs, path, claudeAuthRoot),
        geminiAuthEntries: countAuthAccountDirectories(fs, path, geminiAuthRoot),
        grokAuthEntries: countAuthAccountDirectories(fs, path, grokAuthRoot)
      }).pipe(
        Effect.map(({ claudeAuthEntries, geminiAuthEntries, grokAuthEntries }) => ({
          globalEnvPath,
          claudeAuthPath: claudeAuthRoot,
          geminiAuthPath: geminiAuthRoot,
          grokAuthPath: grokAuthRoot,
          totalEntries: parseEnvEntries(envText).filter((entry) => entry.value.trim().length > 0).length,
          githubTokenEntries: countKeyEntries(envText, "GITHUB_TOKEN"),
          gitTokenEntries: countKeyEntries(envText, "GIT_AUTH_TOKEN"),
          gitUserEntries: countKeyEntries(envText, "GIT_AUTH_USER"),
          claudeAuthEntries,
          geminiAuthEntries,
          grokAuthEntries
        }))
      )
    )
  )

const canonicalLabel = (value: string | null | undefined): string => {
  const normalized = normalizeLabel(value ?? "")
  return normalized.length === 0 || normalized === "DEFAULT" ? "default" : normalized
}

const syncMessage = (request: AuthMenuRequest): string =>
  request.flow === "GithubRemove"
    ? `chore(state): auth gh logout ${canonicalLabel(request.label)}`
    : request.flow === "GitSet"
      ? `chore(state): auth git ${canonicalLabel(request.label)}`
      : request.flow === "GitRemove"
        ? `chore(state): auth git logout ${canonicalLabel(request.label)}`
        : request.flow === "ClaudeLogout"
          ? `chore(state): auth claude logout ${canonicalLabel(request.label)}`
          : request.flow === "GeminiApiKey"
            ? `chore(state): auth gemini ${canonicalLabel(request.label)}`
            : request.flow === "GeminiLogout"
              ? `chore(state): auth gemini logout ${canonicalLabel(request.label)}`
              : request.flow === "GrokApiKey"
                ? `chore(state): auth grok ${canonicalLabel(request.label)}`
                : `chore(state): auth grok logout ${canonicalLabel(request.label)}`

const writeEnvBackedAuthFlow = (
  request: AuthMenuRequest
): Effect.Effect<void, PlatformError, MenuAuthRuntime> =>
  pipe(
    loadAuthEnvText(),
    Effect.flatMap(({ envText, fs }) => {
      const label = request.label ?? ""
      const token = (request.token ?? "").trim()
      const user = (request.user ?? "").trim()
      const nextText = request.flow === "GithubRemove"
        ? upsertEnvKey(envText, buildLabeledEnvKey("GITHUB_TOKEN", label), "")
        : request.flow === "GitSet"
          ? upsertEnvKey(
            upsertEnvKey(envText, buildLabeledEnvKey("GIT_AUTH_TOKEN", label), token),
            buildLabeledEnvKey("GIT_AUTH_USER", label),
            user.length > 0 ? user : "x-access-token"
          )
          : upsertEnvKey(
            upsertEnvKey(envText, buildLabeledEnvKey("GIT_AUTH_TOKEN", label), ""),
            buildLabeledEnvKey("GIT_AUTH_USER", label),
            ""
          )

      return pipe(
        fs.writeFileString(globalEnvPath, nextText),
        Effect.zipRight(autoSyncState(syncMessage(request)))
      )
    }),
    Effect.asVoid
  )

const mapMenuAuthError = (error: AppError): ApiBadRequestError =>
  new ApiBadRequestError({ message: renderError(error) })

export const runAuthMenuFlow = (
  request: AuthMenuRequest
): Effect.Effect<AuthSnapshot, ApiBadRequestError, MenuAuthRuntime> =>
  request.flow === "GithubRemove" || request.flow === "GitSet" || request.flow === "GitRemove"
    ? pipe(
      writeEnvBackedAuthFlow(request),
      Effect.mapError((error) => new ApiBadRequestError({ message: String(error) })),
      Effect.zipRight(readAuthMenuSnapshot()),
      Effect.mapError((error) =>
        error instanceof ApiBadRequestError ? error : new ApiBadRequestError({ message: String(error) })
      )
    )
    : request.flow === "ClaudeLogout"
      ? pipe(
        authClaudeLogout({
          _tag: "AuthClaudeLogout",
          label: request.label ?? null,
          claudeAuthPath: claudeAuthRoot
        }),
        Effect.mapError(mapMenuAuthError),
        Effect.zipRight(readAuthMenuSnapshot()),
        Effect.mapError((error) =>
          error instanceof ApiBadRequestError ? error : new ApiBadRequestError({ message: String(error) })
        )
      )
      : request.flow === "GeminiApiKey"
        ? pipe(
          authGeminiLogin(
            {
              _tag: "AuthGeminiLogin",
              label: request.label ?? null,
              geminiAuthPath: geminiAuthRoot,
              isWeb: true
            },
            request.apiKey ?? ""
          ),
          Effect.mapError(mapMenuAuthError),
          Effect.zipRight(readAuthMenuSnapshot()),
          Effect.mapError((error) =>
            error instanceof ApiBadRequestError ? error : new ApiBadRequestError({ message: String(error) })
          )
        )
        : request.flow === "GeminiLogout"
          ? pipe(
            authGeminiLogout({
              _tag: "AuthGeminiLogout",
              label: request.label ?? null,
              geminiAuthPath: geminiAuthRoot
            }),
            Effect.mapError(mapMenuAuthError),
            Effect.zipRight(readAuthMenuSnapshot()),
            Effect.mapError((error) =>
              error instanceof ApiBadRequestError ? error : new ApiBadRequestError({ message: String(error) })
            )
          )
          : request.flow === "GrokApiKey"
            ? pipe(
              authGrokLogin(
                {
                  _tag: "AuthGrokLogin",
                  label: request.label ?? null,
                  grokAuthPath: grokAuthRoot,
                  isWeb: true
                },
                request.apiKey ?? ""
              ),
              Effect.mapError(mapMenuAuthError),
              Effect.zipRight(readAuthMenuSnapshot()),
              Effect.mapError((error) =>
                error instanceof ApiBadRequestError ? error : new ApiBadRequestError({ message: String(error) })
              )
            )
            : pipe(
              authGrokLogout({
                _tag: "AuthGrokLogout",
                label: request.label ?? null,
                grokAuthPath: grokAuthRoot
              }),
              Effect.mapError(mapMenuAuthError),
              Effect.zipRight(readAuthMenuSnapshot()),
              Effect.mapError((error) =>
                error instanceof ApiBadRequestError ? error : new ApiBadRequestError({ message: String(error) })
              )
            )

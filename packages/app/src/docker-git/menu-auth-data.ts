import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Match, pipe } from "effect"

import { ensureEnvFile, parseEnvEntries, readEnvText, upsertEnvKey } from "@lib/usecases/env-file"
import { type AppError } from "@lib/usecases/errors"
import { defaultProjectsRoot } from "@lib/usecases/menu-helpers"
import { autoSyncState } from "@lib/usecases/state-repo"
import type { AuthEnvFlow } from "./menu-auth-shared.js"
import { countAuthAccountEntries } from "./menu-auth-snapshot-builder.js"
import { buildLabeledEnvKey, countKeyEntries, normalizeLabel } from "./menu-labeled-env.js"
import type { AuthSnapshot, MenuEnv } from "./menu-types.js"

export {
  authMenuActionByIndex,
  authMenuLabels,
  authMenuSize,
  authViewSteps,
  authViewTitle,
  successMessage
} from "./menu-auth-shared.js"
export type { AuthEnvFlow, AuthMenuAction, AuthPromptStep } from "./menu-auth-shared.js"

const buildGlobalEnvPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/env/global.env`
const buildClaudeAuthPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/auth/claude`
const buildGeminiAuthPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/auth/gemini`

type AuthEnvText = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly globalEnvPath: string
  readonly claudeAuthPath: string
  readonly geminiAuthPath: string
  readonly envText: string
}

const loadAuthEnvText = (
  cwd: string
): Effect.Effect<AuthEnvText, AppError, MenuEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const globalEnvPath = buildGlobalEnvPath(cwd)
    const claudeAuthPath = buildClaudeAuthPath(cwd)
    const geminiAuthPath = buildGeminiAuthPath(cwd)
    yield* _(ensureEnvFile(fs, path, globalEnvPath))
    const envText = yield* _(readEnvText(fs, globalEnvPath))
    return { fs, path, globalEnvPath, claudeAuthPath, geminiAuthPath, envText }
  })

export const readAuthSnapshot = (
  cwd: string
): Effect.Effect<AuthSnapshot, AppError, MenuEnv> =>
  pipe(
    loadAuthEnvText(cwd),
    Effect.flatMap(({ claudeAuthPath, envText, fs, geminiAuthPath, globalEnvPath, path }) =>
      countAuthAccountEntries(fs, path, claudeAuthPath, geminiAuthPath).pipe(
        Effect.map(({ claudeAuthEntries, geminiAuthEntries }) => ({
          globalEnvPath,
          claudeAuthPath,
          geminiAuthPath,
          totalEntries: parseEnvEntries(envText).filter((entry) => entry.value.trim().length > 0).length,
          githubTokenEntries: countKeyEntries(envText, "GITHUB_TOKEN"),
          gitTokenEntries: countKeyEntries(envText, "GIT_AUTH_TOKEN"),
          gitUserEntries: countKeyEntries(envText, "GIT_AUTH_USER"),
          claudeAuthEntries,
          geminiAuthEntries
        }))
      )
    )
  )

export const writeAuthFlow = (
  cwd: string,
  flow: AuthEnvFlow,
  values: Readonly<Record<string, string>>
): Effect.Effect<void, AppError, MenuEnv> =>
  pipe(
    loadAuthEnvText(cwd),
    Effect.flatMap(({ envText, fs, globalEnvPath }) => {
      const label = values["label"] ?? ""
      const canonicalLabel = (() => {
        const normalized = normalizeLabel(label)
        return normalized.length === 0 || normalized === "DEFAULT" ? "default" : normalized
      })()
      const token = (values["token"] ?? "").trim()
      const user = (values["user"] ?? "").trim()
      const nextText = Match.value(flow).pipe(
        Match.when("GithubRemove", () => upsertEnvKey(envText, buildLabeledEnvKey("GITHUB_TOKEN", label), "")),
        Match.when("GitSet", () => {
          const withToken = upsertEnvKey(envText, buildLabeledEnvKey("GIT_AUTH_TOKEN", label), token)
          const resolvedUser = user.length > 0 ? user : "x-access-token"
          return upsertEnvKey(withToken, buildLabeledEnvKey("GIT_AUTH_USER", label), resolvedUser)
        }),
        Match.when("GitRemove", () => {
          const withoutToken = upsertEnvKey(envText, buildLabeledEnvKey("GIT_AUTH_TOKEN", label), "")
          return upsertEnvKey(withoutToken, buildLabeledEnvKey("GIT_AUTH_USER", label), "")
        }),
        Match.exhaustive
      )
      const syncMessage = Match.value(flow).pipe(
        Match.when("GithubRemove", () => `chore(state): auth gh logout ${canonicalLabel}`),
        Match.when("GitSet", () => `chore(state): auth git ${canonicalLabel}`),
        Match.when("GitRemove", () => `chore(state): auth git logout ${canonicalLabel}`),
        Match.exhaustive
      )
      return pipe(
        fs.writeFileString(globalEnvPath, nextText),
        Effect.zipRight(autoSyncState(syncMessage))
      )
    }),
    Effect.asVoid
  )

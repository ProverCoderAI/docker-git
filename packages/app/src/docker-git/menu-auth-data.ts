import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Match, pipe } from "effect"

import { ensureEnvFile, parseEnvEntries, readEnvText, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import { type AppError } from "@effect-template/lib/usecases/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"

import { countAuthAccountDirectories } from "./menu-auth-helpers.js"
import { buildLabeledEnvKey, countKeyEntries, normalizeLabel } from "./menu-labeled-env.js"
import type { AuthFlow, AuthSnapshot, MenuEnv } from "./menu-types.js"

export type AuthMenuAction = AuthFlow | "Refresh" | "Back"

type AuthMenuItem = {
  readonly action: AuthMenuAction
  readonly label: string
}

export type AuthEnvFlow = Extract<AuthFlow, "GithubRemove" | "GitSet" | "GitRemove">

export type AuthPromptStep = {
  readonly key: "label" | "token" | "user"
  readonly label: string
  readonly required: boolean
  readonly secret: boolean
}

const authMenuItems: ReadonlyArray<AuthMenuItem> = [
  { action: "GithubOauth", label: "GitHub: login via OAuth (web)" },
  { action: "GithubRemove", label: "GitHub: remove token" },
  { action: "GitSet", label: "Git: add/update credentials" },
  { action: "GitRemove", label: "Git: remove credentials" },
  { action: "ClaudeOauth", label: "Claude Code: login via OAuth (web)" },
  { action: "ClaudeLogout", label: "Claude Code: logout (clear cache)" },
  { action: "Refresh", label: "Refresh snapshot" },
  { action: "Back", label: "Back to main menu" }
]

const flowSteps: Readonly<Record<AuthFlow, ReadonlyArray<AuthPromptStep>>> = {
  GithubOauth: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  GithubRemove: [
    { key: "label", label: "Label to remove (empty = default)", required: false, secret: false }
  ],
  GitSet: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false },
    { key: "token", label: "Git auth token", required: true, secret: true },
    { key: "user", label: "Git auth user (empty = x-access-token)", required: false, secret: false }
  ],
  GitRemove: [
    { key: "label", label: "Label to remove (empty = default)", required: false, secret: false }
  ],
  ClaudeOauth: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  ClaudeLogout: [
    { key: "label", label: "Label to logout (empty = default)", required: false, secret: false }
  ]
}

const flowTitle = (flow: AuthFlow): string =>
  Match.value(flow).pipe(
    Match.when("GithubOauth", () => "GitHub OAuth"),
    Match.when("GithubRemove", () => "GitHub remove"),
    Match.when("GitSet", () => "Git credentials"),
    Match.when("GitRemove", () => "Git remove"),
    Match.when("ClaudeOauth", () => "Claude Code OAuth"),
    Match.when("ClaudeLogout", () => "Claude Code logout"),
    Match.exhaustive
  )

export const successMessage = (flow: AuthFlow, label: string): string =>
  Match.value(flow).pipe(
    Match.when("GithubOauth", () => `Saved GitHub token (${label}).`),
    Match.when("GithubRemove", () => `Removed GitHub token (${label}).`),
    Match.when("GitSet", () => `Saved Git credentials (${label}).`),
    Match.when("GitRemove", () => `Removed Git credentials (${label}).`),
    Match.when("ClaudeOauth", () => `Saved Claude Code login (${label}).`),
    Match.when("ClaudeLogout", () => `Logged out Claude Code (${label}).`),
    Match.exhaustive
  )

const buildGlobalEnvPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/env/global.env`
const buildClaudeAuthPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/auth/claude`

type AuthEnvText = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly globalEnvPath: string
  readonly claudeAuthPath: string
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
    yield* _(ensureEnvFile(fs, path, globalEnvPath))
    const envText = yield* _(readEnvText(fs, globalEnvPath))
    return { fs, path, globalEnvPath, claudeAuthPath, envText }
  })

export const readAuthSnapshot = (
  cwd: string
): Effect.Effect<AuthSnapshot, AppError, MenuEnv> =>
  pipe(
    loadAuthEnvText(cwd),
    Effect.flatMap(({ claudeAuthPath, envText, fs, globalEnvPath, path }) =>
      pipe(
        countAuthAccountDirectories(fs, path, claudeAuthPath),
        Effect.map((claudeAuthEntries) => ({
          globalEnvPath,
          claudeAuthPath,
          totalEntries: parseEnvEntries(envText).filter((entry) => entry.value.trim().length > 0).length,
          githubTokenEntries: countKeyEntries(envText, "GITHUB_TOKEN"),
          gitTokenEntries: countKeyEntries(envText, "GIT_AUTH_TOKEN"),
          gitUserEntries: countKeyEntries(envText, "GIT_AUTH_USER"),
          claudeAuthEntries
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

export const authViewTitle = (flow: AuthFlow): string => flowTitle(flow)

export const authViewSteps = (flow: AuthFlow): ReadonlyArray<AuthPromptStep> => flowSteps[flow]

export const authMenuLabels = (): ReadonlyArray<string> => authMenuItems.map((item) => item.label)

export const authMenuActionByIndex = (index: number): AuthMenuAction | null => {
  const item = authMenuItems[index]
  return item ? item.action : null
}

export const authMenuSize = (): number => authMenuItems.length

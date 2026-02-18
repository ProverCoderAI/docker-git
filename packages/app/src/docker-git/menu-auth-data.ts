import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, Match, pipe } from "effect"

import { ensureEnvFile, parseEnvEntries, readEnvText, upsertEnvKey } from "@effect-template/lib/usecases/env-file"
import { type AppError } from "@effect-template/lib/usecases/errors"
import { defaultProjectsRoot } from "@effect-template/lib/usecases/menu-helpers"
import { autoSyncState } from "@effect-template/lib/usecases/state-repo"

import { buildLabeledEnvKey, countKeyEntries, normalizeLabel } from "./menu-labeled-env.js"
import type { AuthFlow, AuthSnapshot, MenuEnv } from "./menu-types.js"

export type AuthMenuAction = AuthFlow | "Refresh" | "Back"

type AuthMenuItem = {
  readonly action: AuthMenuAction
  readonly label: string
}

export type AuthPromptStep = {
  readonly key: "label" | "token" | "user" | "apiKey"
  readonly label: string
  readonly required: boolean
  readonly secret: boolean
}

const authMenuItems: ReadonlyArray<AuthMenuItem> = [
  { action: "GithubOauth", label: "GitHub: login via OAuth (web)" },
  { action: "GithubRemove", label: "GitHub: remove token" },
  { action: "GitSet", label: "Git: add/update credentials" },
  { action: "GitRemove", label: "Git: remove credentials" },
  { action: "ClaudeSet", label: "Claude: add/update API key" },
  { action: "ClaudeRemove", label: "Claude: remove API key" },
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
  ClaudeSet: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false },
    { key: "apiKey", label: "Claude API key", required: true, secret: true }
  ],
  ClaudeRemove: [
    { key: "label", label: "Label to remove (empty = default)", required: false, secret: false }
  ]
}

const flowTitle = (flow: AuthFlow): string =>
  Match.value(flow).pipe(
    Match.when("GithubOauth", () => "GitHub OAuth"),
    Match.when("GithubRemove", () => "GitHub remove"),
    Match.when("GitSet", () => "Git credentials"),
    Match.when("GitRemove", () => "Git remove"),
    Match.when("ClaudeSet", () => "Claude API key"),
    Match.when("ClaudeRemove", () => "Claude remove"),
    Match.exhaustive
  )

export const successMessage = (flow: AuthFlow, label: string): string =>
  Match.value(flow).pipe(
    Match.when("GithubOauth", () => `Saved GitHub token (${label}).`),
    Match.when("GithubRemove", () => `Removed GitHub token (${label}).`),
    Match.when("GitSet", () => `Saved Git credentials (${label}).`),
    Match.when("GitRemove", () => `Removed Git credentials (${label}).`),
    Match.when("ClaudeSet", () => `Saved Claude key (${label}).`),
    Match.when("ClaudeRemove", () => `Removed Claude key (${label}).`),
    Match.exhaustive
  )

const buildGlobalEnvPath = (cwd: string): string => `${defaultProjectsRoot(cwd)}/.orch/env/global.env`

type AuthEnvText = {
  readonly fs: FileSystem.FileSystem
  readonly globalEnvPath: string
  readonly envText: string
}

const loadAuthEnvText = (
  cwd: string
): Effect.Effect<AuthEnvText, AppError, MenuEnv> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const globalEnvPath = buildGlobalEnvPath(cwd)
    yield* _(ensureEnvFile(fs, path, globalEnvPath))
    const envText = yield* _(readEnvText(fs, globalEnvPath))
    return { fs, globalEnvPath, envText }
  })

export const readAuthSnapshot = (
  cwd: string
): Effect.Effect<AuthSnapshot, AppError, MenuEnv> =>
  pipe(
    loadAuthEnvText(cwd),
    Effect.map(({ envText, globalEnvPath }) => ({
      globalEnvPath,
      totalEntries: parseEnvEntries(envText).filter((entry) => entry.value.trim().length > 0).length,
      githubTokenEntries: countKeyEntries(envText, "GITHUB_TOKEN"),
      gitTokenEntries: countKeyEntries(envText, "GIT_AUTH_TOKEN"),
      gitUserEntries: countKeyEntries(envText, "GIT_AUTH_USER"),
      claudeKeyEntries: countKeyEntries(envText, "ANTHROPIC_API_KEY")
    }))
  )

export const writeAuthFlow = (
  cwd: string,
  flow: AuthFlow,
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
      const apiKey = (values["apiKey"] ?? "").trim()
      const nextText = Match.value(flow).pipe(
        Match.when("GithubOauth", () => envText),
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
        Match.when("ClaudeSet", () => upsertEnvKey(envText, buildLabeledEnvKey("ANTHROPIC_API_KEY", label), apiKey)),
        Match.when("ClaudeRemove", () => upsertEnvKey(envText, buildLabeledEnvKey("ANTHROPIC_API_KEY", label), "")),
        Match.exhaustive
      )
      const syncMessage = Match.value(flow).pipe(
        Match.when("GithubOauth", () => `chore(state): auth gh ${canonicalLabel}`),
        Match.when("GithubRemove", () => `chore(state): auth gh logout ${canonicalLabel}`),
        Match.when("GitSet", () => `chore(state): auth git ${canonicalLabel}`),
        Match.when("GitRemove", () => `chore(state): auth git logout ${canonicalLabel}`),
        Match.when("ClaudeSet", () => `chore(state): auth claude ${canonicalLabel}`),
        Match.when("ClaudeRemove", () => `chore(state): auth claude logout ${canonicalLabel}`),
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

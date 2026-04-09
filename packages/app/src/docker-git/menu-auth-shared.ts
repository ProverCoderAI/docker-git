import { Match } from "effect"

import type { AuthFlow } from "./menu-types.js"

export type AuthMenuAction = AuthFlow | "Refresh" | "Back"

export type AuthEnvFlow = Extract<AuthFlow, "GithubRemove" | "GitSet" | "GitRemove">

export type AuthPromptStep = {
  readonly key: "label" | "token" | "user" | "apiKey"
  readonly label: string
  readonly required: boolean
  readonly secret: boolean
}

type AuthMenuItem = {
  readonly action: AuthMenuAction
  readonly label: string
}

const authMenuItems: ReadonlyArray<AuthMenuItem> = [
  { action: "GithubOauth", label: "GitHub: login via OAuth (web)" },
  { action: "GithubRemove", label: "GitHub: remove token" },
  { action: "GitSet", label: "Git: add/update credentials" },
  { action: "GitRemove", label: "Git: remove credentials" },
  { action: "ClaudeOauth", label: "Claude Code: login via OAuth (web)" },
  { action: "ClaudeLogout", label: "Claude Code: logout (clear cache)" },
  { action: "GeminiOauth", label: "Gemini CLI: login via OAuth (Google account)" },
  { action: "GeminiApiKey", label: "Gemini CLI: set API key" },
  { action: "GeminiLogout", label: "Gemini CLI: logout (clear credentials)" },
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
  ],
  GeminiOauth: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false }
  ],
  GeminiApiKey: [
    { key: "label", label: "Label (empty = default)", required: false, secret: false },
    { key: "apiKey", label: "Gemini API key (from ai.google.dev)", required: true, secret: true }
  ],
  GeminiLogout: [
    { key: "label", label: "Label to logout (empty = default)", required: false, secret: false }
  ]
}

export const successMessage = (flow: AuthFlow, label: string): string =>
  Match.value(flow).pipe(
    Match.when("GithubOauth", () => `Saved GitHub token (${label}).`),
    Match.when("GithubRemove", () => `Removed GitHub token (${label}).`),
    Match.when("GitSet", () => `Saved Git credentials (${label}).`),
    Match.when("GitRemove", () => `Removed Git credentials (${label}).`),
    Match.when("ClaudeOauth", () => `Saved Claude Code login (${label}).`),
    Match.when("ClaudeLogout", () => `Logged out Claude Code (${label}).`),
    Match.when("GeminiOauth", () => `Saved Gemini CLI OAuth login (${label}).`),
    Match.when("GeminiApiKey", () => `Saved Gemini API key (${label}).`),
    Match.when("GeminiLogout", () => `Logged out Gemini CLI (${label}).`),
    Match.exhaustive
  )

export const authViewTitle = (flow: AuthFlow): string =>
  Match.value(flow).pipe(
    Match.when("GithubOauth", () => "GitHub OAuth"),
    Match.when("GithubRemove", () => "GitHub remove"),
    Match.when("GitSet", () => "Git credentials"),
    Match.when("GitRemove", () => "Git remove"),
    Match.when("ClaudeOauth", () => "Claude Code OAuth"),
    Match.when("ClaudeLogout", () => "Claude Code logout"),
    Match.when("GeminiOauth", () => "Gemini CLI OAuth"),
    Match.when("GeminiApiKey", () => "Gemini CLI API key"),
    Match.when("GeminiLogout", () => "Gemini CLI logout"),
    Match.exhaustive
  )

export const authViewSteps = (flow: AuthFlow): ReadonlyArray<AuthPromptStep> => flowSteps[flow]

export const authMenuLabels = (): ReadonlyArray<string> => authMenuItems.map((item) => item.label)

export const authMenuActionByIndex = (index: number): AuthMenuAction | null => {
  const item = authMenuItems[index]
  return item ? item.action : null
}

export const authMenuSize = (): number => authMenuItems.length

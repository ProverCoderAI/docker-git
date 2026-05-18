import { authMenuActionByIndex } from "../docker-git/menu-auth-shared.js"

import type { ActionPromptState } from "./action-prompt.js"
import type { GithubAuthStatus } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"

const usableGithubTokenStatuses: ReadonlySet<GithubAuthStatus["tokens"][number]["status"]> = new Set([
  "valid",
  "unknown"
])

export const isGithubAuthConfigured = (githubStatus: GithubAuthStatus): boolean =>
  githubStatus.tokens.some((token) => usableGithubTokenStatuses.has(token.status))

export const shouldRequireGithubAuth = (githubStatus: GithubAuthStatus | null): githubStatus is GithubAuthStatus =>
  githubStatus !== null && !isGithubAuthConfigured(githubStatus)

export const githubAuthGateMessage = (githubStatus: GithubAuthStatus): string =>
  githubStatus.tokens.length === 0
    ? "Сначала подключи GitHub: без GitHub token docker-git не сможет клонировать репозитории."
    : "GitHub token не прошёл проверку. Подключи GitHub заново перед работой с docker-git."

export const isGithubOauthPrompt = (actionPrompt: ActionPromptState | null): boolean =>
  actionPrompt?.kind === "Auth" && actionPrompt.action === "GithubOauth"

export const shouldBlockMenuForGithubAuth = (
  githubStatus: GithubAuthStatus | null,
  currentMenu: BrowserMenuTag
): boolean =>
  currentMenu !== "Auth" &&
  currentMenu !== "Quit" &&
  currentMenu !== "Share" &&
  (githubStatus === null || shouldRequireGithubAuth(githubStatus))

export const isGithubOauthAuthMenuIndex = (index: number): boolean => authMenuActionByIndex(index) === "GithubOauth"

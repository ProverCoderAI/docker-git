import { describe, expect, it } from "vitest"

import type { GithubAuthStatus } from "../../src/web/api.js"
import {
  githubAuthGateMessage,
  isGithubAuthConfigured,
  isGithubOauthAuthMenuIndex,
  shouldBlockMenuForGithubAuth,
  shouldRequireGithubAuth
} from "../../src/web/github-auth-gate.js"

type GithubTokenStatus = GithubAuthStatus["tokens"][number]["status"]

const makeStatus = (
  tokens: ReadonlyArray<GithubAuthStatus["tokens"][number]>
): GithubAuthStatus => ({
  summary: `tokens: ${tokens.length}`,
  tokens
})

const makeToken = (status: GithubTokenStatus): GithubAuthStatus["tokens"][number] => ({
  key: `GITHUB_TOKEN_${status}`,
  label: "default",
  login: status === "valid" ? "octocat" : null,
  status
})

describe("github-auth-gate", () => {
  it("requires GitHub auth when no token is configured", () => {
    const status = makeStatus([])

    expect(isGithubAuthConfigured(status)).toBe(false)
    expect(shouldRequireGithubAuth(status)).toBe(true)
    expect(githubAuthGateMessage(status)).toContain("Сначала подключи GitHub")
  })

  it("requires reconnect when all configured tokens are invalid", () => {
    const status = makeStatus([makeToken("invalid")])

    expect(isGithubAuthConfigured(status)).toBe(false)
    expect(shouldRequireGithubAuth(status)).toBe(true)
    expect(githubAuthGateMessage(status)).toContain("не прошёл проверку")
  })

  it("accepts valid or unknown tokens as configured", () => {
    expect(isGithubAuthConfigured(makeStatus([makeToken("valid")]))).toBe(true)
    expect(isGithubAuthConfigured(makeStatus([makeToken("unknown")]))).toBe(true)
  })

  it("blocks non-auth browser actions while GitHub auth is required", () => {
    const status = makeStatus([])

    expect(shouldBlockMenuForGithubAuth(null, "Create")).toBe(true)
    expect(shouldBlockMenuForGithubAuth(status, "Create")).toBe(true)
    expect(shouldBlockMenuForGithubAuth(status, "Auth")).toBe(false)
    expect(shouldBlockMenuForGithubAuth(status, "Quit")).toBe(false)
    expect(shouldBlockMenuForGithubAuth(status, "Share")).toBe(false)
  })

  it("keeps the first auth menu action mapped to GitHub OAuth", () => {
    expect(isGithubOauthAuthMenuIndex(0)).toBe(true)
  })
})

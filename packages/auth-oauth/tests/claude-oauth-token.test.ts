import { describe, expect, it } from "vitest"

import {
  claudeCodeOauthTokenEnvKey,
  claudeOauthTokenFileMode,
  claudeOauthTokenFileName,
  claudeOauthTokenPath,
  classifyClaudeSetupTokenResult,
  dockerGitClaudeOauthTokenEnvKey,
  extractClaudeOauthToken,
  formatClaudeOauthTokenFile,
  normalizeClaudeOauthToken,
  readClaudeOauthTokenFromEnv
} from "../src/claude-oauth-token.js"

const oauthToken = "sk-ant-oat01-OAUTH0123456789abcdef"

const setupTokenOutput = (token: string): string =>
  [
    "Welcome to Claude Code",
    "",
    " ✓ Long-lived authentication token created successfully!",
    "",
    " Your OAuth token (valid for 1 year):",
    "",
    ` ${token}`,
    "",
    " Store this token securely. You won't be able to see it again."
  ].join("\n")

describe("Claude OAuth token helpers", () => {
  it("extracts the OAuth token from setup-token output", () => {
    expect(extractClaudeOauthToken(setupTokenOutput(oauthToken))).toBe(oauthToken)
  })

  it("extracts hard-wrapped OAuth tokens from setup-token output", () => {
    const wrapped = `${oauthToken.slice(0, 18)}\n${oauthToken.slice(18)}`
    expect(extractClaudeOauthToken(setupTokenOutput(wrapped))).toBe(oauthToken)
  })

  it("strips ANSI before extracting the token", () => {
    expect(extractClaudeOauthToken(`\u001B[32m${setupTokenOutput(oauthToken)}\u001B[0m`)).toBe(oauthToken)
  })

  it("returns null when setup-token output does not contain the OAuth marker", () => {
    expect(extractClaudeOauthToken("Long-lived authentication token created successfully")).toBeNull()
  })

  it("normalizes token whitespace", () => {
    expect(normalizeClaudeOauthToken(`\n${oauthToken}\n`)).toBe(oauthToken)
    expect(normalizeClaudeOauthToken(" \n ")).toBeNull()
  })

  it("reads env tokens by explicit key priority", () => {
    const env = {
      [claudeCodeOauthTokenEnvKey]: "sk-ant-oat01-LOWERPRIORITY0123456789",
      [dockerGitClaudeOauthTokenEnvKey]: ` ${oauthToken} `
    }

    expect(readClaudeOauthTokenFromEnv(env, [dockerGitClaudeOauthTokenEnvKey, claudeCodeOauthTokenEnvKey])).toBe(
      oauthToken
    )
    expect(readClaudeOauthTokenFromEnv(env, [claudeCodeOauthTokenEnvKey, dockerGitClaudeOauthTokenEnvKey])).toBe(
      "sk-ant-oat01-LOWERPRIORITY0123456789"
    )
  })

  it("classifies setup-token outcomes without throwing package-specific errors", () => {
    expect(classifyClaudeSetupTokenResult(oauthToken, 1)).toEqual({
      _tag: "ClaudeSetupTokenCaptured",
      token: oauthToken,
      exitCode: 1,
      exitedNonZero: true
    })
    expect(classifyClaudeSetupTokenResult(null, 1)).toEqual({
      _tag: "ClaudeSetupTokenCommandFailed",
      exitCode: 1
    })
    expect(classifyClaudeSetupTokenResult(null, 0)).toEqual({
      _tag: "ClaudeSetupTokenMissing",
      exitCode: 0
    })
  })

  it("describes Claude OAuth token storage", () => {
    expect(claudeOauthTokenFileName).toBe(".oauth-token")
    expect(claudeOauthTokenFileMode).toBe(0o600)
    expect(claudeOauthTokenPath("/tmp/account")).toBe("/tmp/account/.oauth-token")
    expect(formatClaudeOauthTokenFile(oauthToken)).toBe(`${oauthToken}\n`)
  })
})

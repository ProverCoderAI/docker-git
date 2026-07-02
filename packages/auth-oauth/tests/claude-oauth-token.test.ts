import { describe, expect, it } from "@effect/vitest"
import fc from "fast-check"

import {
  claudeCodeOauthTokenEnvKey,
  claudeOauthTokenFileMode,
  claudeOauthTokenFileName,
  claudeOauthTokenPath,
  claudeOauthTokenRedactionText,
  classifyClaudeSetupTokenResult,
  dockerGitClaudeOauthTokenEnvKey,
  extractClaudeOauthToken,
  flushClaudeOauthTokenRedactionState,
  formatClaudeOauthTokenFile,
  initialClaudeOauthTokenRedactionState,
  normalizeClaudeOauthToken,
  redactClaudeOauthTokenChunk,
  readClaudeOauthTokenFromEnv
} from "../src/claude-oauth-token.js"

const oauthTokenPrefix = ["sk", "ant", ""].join("-")
const oauthTokenChars = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
  "Q",
  "R",
  "S",
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
  "_",
  "-"
] as const

const makeOauthToken = (suffix: string): string => `${oauthTokenPrefix}oat01-${suffix}`
const oauthToken = makeOauthToken("OAUTH0123456789abcdef")
const lowerPriorityToken = makeOauthToken("LOWERPRIORITY0123456789")
const oauthTokenArbitrary = fc.array(fc.constantFrom(...oauthTokenChars), {
  minLength: 24,
  maxLength: 72
}).map((chars) => `${oauthTokenPrefix}${chars.join("")}`)
const nonBlankStringArbitrary = fc.string({ maxLength: 80 }).filter((value) => value.trim().length > 0)

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

const chunkText = (text: string, size: number): ReadonlyArray<string> => {
  const chunks: Array<string> = []
  let offset = 0
  while (offset < text.length) {
    chunks.push(text.slice(offset, offset + size))
    offset += size
  }
  return chunks
}

const redactChunks = (chunks: ReadonlyArray<string>): string => {
  let state = initialClaudeOauthTokenRedactionState
  const output: Array<string> = []
  for (const chunk of chunks) {
    const step = redactClaudeOauthTokenChunk(state, chunk)
    state = step.state
    output.push(step.output)
  }
  output.push(flushClaudeOauthTokenRedactionState(state))
  return output.join("")
}

describe("Claude OAuth token helpers", () => {
  it("normalizes non-blank token text as trim(raw)", () => {
    fc.assert(
      fc.property(nonBlankStringArbitrary, (raw) => {
        expect(normalizeClaudeOauthToken(`\n ${raw}\t `)).toBe(raw.trim())
      })
    )
  })

  it("extracts arbitrary OAuth tokens from setup-token output", () => {
    fc.assert(
      fc.property(oauthTokenArbitrary, (token) => {
        expect(extractClaudeOauthToken(setupTokenOutput(token))).toBe(token)
      })
    )
  })

  it("redacts OAuth tokens split across live-output chunks", () => {
    fc.assert(
      fc.property(
        oauthTokenArbitrary,
        fc.integer({ min: 1, max: 9 }),
        (token, chunkSize) => {
          const output = redactChunks(["prefix:", ...chunkText(`${token}\n`, chunkSize), "suffix"])
          expect(output).toBe(`prefix:${claudeOauthTokenRedactionText}\nsuffix`)
          expect(output).not.toContain(token)
          expect(output).not.toContain(oauthTokenPrefix)
        }
      )
    )
  })

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
      [claudeCodeOauthTokenEnvKey]: lowerPriorityToken,
      [dockerGitClaudeOauthTokenEnvKey]: ` ${oauthToken} `
    }

    expect(readClaudeOauthTokenFromEnv(env, [dockerGitClaudeOauthTokenEnvKey, claudeCodeOauthTokenEnvKey])).toBe(
      oauthToken
    )
    expect(readClaudeOauthTokenFromEnv(env, [claudeCodeOauthTokenEnvKey, dockerGitClaudeOauthTokenEnvKey])).toBe(
      lowerPriorityToken
    )
  })

  it("reads env tokens by priority for arbitrary token pairs", () => {
    fc.assert(
      fc.property(oauthTokenArbitrary, oauthTokenArbitrary, (first, second) => {
        const env = {
          [dockerGitClaudeOauthTokenEnvKey]: ` ${first} `,
          [claudeCodeOauthTokenEnvKey]: ` ${second} `
        }
        expect(readClaudeOauthTokenFromEnv(env, [dockerGitClaudeOauthTokenEnvKey, claudeCodeOauthTokenEnvKey])).toBe(
          first
        )
        expect(readClaudeOauthTokenFromEnv(env, [claudeCodeOauthTokenEnvKey, dockerGitClaudeOauthTokenEnvKey])).toBe(
          second
        )
      })
    )
  })

  it("classifies setup-token results from normalized token presence and exit code", () => {
    fc.assert(
      fc.property(oauthTokenArbitrary, fc.integer({ min: 0, max: 255 }), (token, exitCode) => {
        expect(classifyClaudeSetupTokenResult(` ${token} `, exitCode)).toEqual({
          _tag: "ClaudeSetupTokenCaptured",
          token,
          exitCode,
          exitedNonZero: exitCode !== 0
        })
      })
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

import { describe, expect, it } from "@effect/vitest"

import { decodeAuthSnapshot } from "../../src/docker-git/api-auth-codec.js"
import type { JsonValue } from "../../src/docker-git/api-json.js"

const fullAuthSnapshot = {
  claudeAuthEntries: 1,
  claudeAuthPath: "/auth/claude",
  codexAuthEntries: 2,
  codexAuthPath: "/auth/codex",
  geminiAuthEntries: 3,
  geminiAuthPath: "/auth/gemini",
  gitTokenEntries: 4,
  gitUserEntries: 5,
  githubTokenEntries: 6,
  globalEnvPath: "/env/global.env",
  grokAuthEntries: 7,
  grokAuthPath: "/auth/grok",
  totalEntries: 8
} satisfies JsonValue

describe("api auth codec", () => {
  it("requires Codex fields in auth snapshots", () => {
    const missingPath = { ...fullAuthSnapshot, codexAuthPath: null } satisfies JsonValue
    const missingEntries = { ...fullAuthSnapshot, codexAuthEntries: null } satisfies JsonValue

    expect(decodeAuthSnapshot({ snapshot: missingPath })).toBe(null)
    expect(decodeAuthSnapshot({ snapshot: missingEntries })).toBe(null)
  })

  it("decodes complete auth snapshots", () => {
    expect(decodeAuthSnapshot({ snapshot: fullAuthSnapshot })).toEqual(fullAuthSnapshot)
  })
})

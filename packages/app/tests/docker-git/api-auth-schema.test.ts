import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { describe, expect, it } from "@effect/vitest"
import { Either } from "effect"

import { AuthSnapshotResponseSchema } from "../../src/web/api-auth-schema.js"

type LegacyAuthSnapshotResponse = {
  readonly snapshot: {
    readonly claudeAuthEntries: number
    readonly claudeAuthPath: string
    readonly geminiAuthEntries: number
    readonly geminiAuthPath: string
    readonly gitTokenEntries: number
    readonly gitUserEntries: number
    readonly githubTokenEntries: number
    readonly globalEnvPath: string
    readonly totalEntries: number
  }
}

const decodeAuthSnapshotResponse = (payload: LegacyAuthSnapshotResponse) =>
  ParseResult.decodeUnknownEither(Schema.parseJson(AuthSnapshotResponseSchema))(JSON.stringify(payload))

describe("web auth api schema", () => {
  it("accepts auth snapshots from controllers without Codex and Grok fields", () => {
    const decoded = decodeAuthSnapshotResponse({
      snapshot: {
        claudeAuthEntries: 3,
        claudeAuthPath: "/home/dev/.docker-git/.orch/auth/claude",
        geminiAuthEntries: 2,
        geminiAuthPath: "/home/dev/.docker-git/.orch/auth/gemini",
        gitTokenEntries: 0,
        gitUserEntries: 0,
        githubTokenEntries: 1,
        globalEnvPath: "/home/dev/.docker-git/.orch/env/global.env",
        totalEntries: 1
      }
    })

    expect(Either.isRight(decoded)).toBe(true)
    if (Either.isRight(decoded)) {
      expect(decoded.right.snapshot.codexAuthEntries).toBe(0)
      expect(decoded.right.snapshot.codexAuthPath).toBe("")
      expect(decoded.right.snapshot.grokAuthEntries).toBe(0)
      expect(decoded.right.snapshot.grokAuthPath).toBe("")
    }
  })
})

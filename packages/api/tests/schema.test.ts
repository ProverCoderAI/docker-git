import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, ParseResult, Schema } from "effect"

import { CreateAgentRequestSchema, CreateProjectRequestSchema } from "../src/api/schema.js"

describe("api schemas", () => {
  it.effect("decodes create project payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CreateProjectRequestSchema)({
        repoUrl: "https://github.com/ProverCoderAI/docker-git",
        repoRef: "main",
        up: true,
        force: false
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.repoRef).toBe("main")
          expect(value.up).toBe(true)
        }
      })
    }))

  it.effect("rejects invalid agent provider", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CreateAgentRequestSchema)({
        provider: "wrong",
        command: "codex"
      })

      Either.match(result, {
        onLeft: (error) => {
          expect(ParseResult.TreeFormatter.formatIssueSync(error.issue)).toContain("Expected \"codex\"")
        },
        onRight: () => {
          throw new Error("Expected schema decode failure")
        }
      })
    }))
})

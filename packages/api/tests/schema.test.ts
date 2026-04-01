import { describe, expect, it } from "@effect/vitest"
import { Effect, Either, ParseResult, Schema } from "effect"

import {
  ApplyAllRequestSchema,
  CreateAgentRequestSchema,
  CreateFollowRequestSchema,
  CreateProjectRequestSchema,
  GithubAuthLoginRequestSchema,
  GithubAuthLogoutRequestSchema
} from "../src/api/schema.js"

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

  it.effect("decodes follow payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(CreateFollowRequestSchema)({
        domain: "social.my-domain.tld",
        object: "/issues/followers",
        to: ["https://www.w3.org/ns/activitystreams#Public"]
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.actor).toBeUndefined()
          expect(value.domain).toBe("social.my-domain.tld")
          expect(value.object).toBe("/issues/followers")
          expect(value.to).toHaveLength(1)
        }
      })
    }))

  it.effect("decodes auth login payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(GithubAuthLoginRequestSchema)({
        label: "default",
        token: "token",
        scopes: "repo,workflow"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.label).toBe("default")
          expect(value.token).toBe("token")
          expect(value.scopes).toBe("repo,workflow")
        }
      })
    }))

  it.effect("decodes auth logout payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(GithubAuthLogoutRequestSchema)({
        label: "default"
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.label).toBe("default")
        }
      })
    }))

  it.effect("decodes apply-all payload", () =>
    Effect.sync(() => {
      const result = Schema.decodeUnknownEither(ApplyAllRequestSchema)({
        activeOnly: true
      })

      Either.match(result, {
        onLeft: (error) => {
          throw new Error(ParseResult.TreeFormatter.formatIssueSync(error.issue))
        },
        onRight: (value) => {
          expect(value.activeOnly).toBe(true)
        }
      })
    }))
})

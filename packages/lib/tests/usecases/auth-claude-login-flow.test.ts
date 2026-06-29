import { normalizeClaudeOauthToken } from "@prover-coder-ai/docker-git-auth-oauth/claude-oauth-token"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { runClaudeLoginFlow } from "../../src/usecases/auth-claude-login-flow.js"

const oauthToken = "sk-ant-oat01-FLOW0123456789abcdef"

describe("runClaudeLoginFlow", () => {
  it.effect("persists and normalizes a captured token before interpreting a failed probe", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      const result = yield* _(
        runClaudeLoginFlow({
          accountLabel: "work",
          captureToken: Effect.succeed(oauthToken),
          persistToken: (token) => Effect.sync(() => {
            events.push(`persist:${token}`)
          }),
          normalizeStoredCredentials: Effect.sync(() => {
            events.push("normalize")
          }),
          probeToken: (token) => Effect.sync(() => {
            events.push(`probe:${token}`)
            return 7
          }),
          syncState: Effect.sync(() => {
            events.push("sync")
          })
        })
      )

      expect(result).toEqual({
        accountLabel: "work",
        probeStatus: { _tag: "ClaudeLoginProbeFailed", exitCode: 7 }
      })
      expect(events).toEqual([
        `persist:${oauthToken}`,
        "normalize",
        `probe:${oauthToken}`,
        "sync"
      ])
    }))

  it.effect("reports a successful probe without changing the persistence invariant", () =>
    Effect.gen(function*(_) {
      let persisted: string | null = null
      const result = yield* _(
        runClaudeLoginFlow({
          accountLabel: "default",
          captureToken: Effect.succeed(oauthToken),
          persistToken: (token) => Effect.sync(() => {
            persisted = token
          }),
          normalizeStoredCredentials: Effect.void,
          probeToken: () => Effect.succeed(0),
          syncState: Effect.void
        })
      )

      expect(persisted).toBe(oauthToken)
      expect(result.probeStatus).toEqual({ _tag: "ClaudeLoginProbeSucceeded", exitCode: 0 })
    }))

  it.effect("does not persist, normalize, probe, or sync an empty token", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      const error = yield* _(
        runClaudeLoginFlow({
          accountLabel: "default",
          captureToken: Effect.succeed(" \n "),
          persistToken: () => Effect.sync(() => {
            events.push("persist")
          }),
          normalizeStoredCredentials: Effect.sync(() => {
            events.push("normalize")
          }),
          probeToken: () => Effect.sync(() => {
            events.push("probe")
            return 0
          }),
          syncState: Effect.sync(() => {
            events.push("sync")
          })
        }).pipe(Effect.flip)
      )

      expect(error._tag).toBe("AuthError")
      expect(events).toEqual([])
    }))

  it.effect("normalizes token whitespace at the flow boundary", () =>
    Effect.sync(() => {
      expect(normalizeClaudeOauthToken(`\n${oauthToken}\n`)).toBe(oauthToken)
    }))
})

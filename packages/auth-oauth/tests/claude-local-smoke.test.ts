import { readFile } from "node:fs/promises"

import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"

import {
  buildClaudeLocalOauthEnv,
  claudeLocalOauthSmokeEnvKeys,
  persistClaudeLocalOauthToken,
  renderClaudeLocalOauthSmokeResult,
  runClaudeLocalOauthSmoke,
  type ClaudeLocalOauthSmokeResult
} from "../src/claude-local-smoke.js"
import {
  claudeCodeOauthTokenEnvKey,
  claudeOauthTokenPath,
  dockerGitClaudeOauthTokenEnvKey
} from "../src/claude-oauth-token.js"

const oauthTokenPrefix = ["sk", "ant", ""].join("-")
const makeOauthToken = (suffix: string): string => `${oauthTokenPrefix}oat01-${suffix}`
const oauthToken = makeOauthToken("SMOKE0123456789abcdef")
const oauthTokenArbitrary = fc.array(fc.constantFrom("A", "B", "C", "D", "E", "F", "0", "1", "2", "3"), {
  minLength: 24,
  maxLength: 64
}).map((chars) => `${oauthTokenPrefix}${chars.join("")}`)
const envArbitrary = fc.dictionary(
  fc.constantFrom(
    "PATH",
    "LANG",
    "SHELL",
    "CLAUDE_CONFIG_DIR",
    claudeCodeOauthTokenEnvKey,
    dockerGitClaudeOauthTokenEnvKey,
    "HOME"
  ),
  fc.string({ maxLength: 40 })
)
const accountPathArbitrary = fc.array(fc.constantFrom("a", "b", "c", "d", "e", "f", "0", "1", "2", "/", "-", "_"), {
  minLength: 1,
  maxLength: 40
}).map((chars) => chars.join(""))
const smokeResultArbitrary: fc.Arbitrary<ClaudeLocalOauthSmokeResult> = fc.oneof(
  fc.record({
    _tag: fc.constant("ClaudeLocalOauthSmokeMissingToken"),
    envKeys: fc.constant(claudeLocalOauthSmokeEnvKeys)
  }),
  fc.record({
    _tag: fc.constant("ClaudeLocalOauthSmokeSucceeded"),
    accountPath: accountPathArbitrary
  }),
  fc.record({
    _tag: fc.constant("ClaudeLocalOauthSmokeProbeFailed"),
    accountPath: accountPathArbitrary,
    exitCode: fc.integer({ min: 1, max: 255 })
  }),
  fc.record({
    _tag: fc.constant("ClaudeLocalOauthSmokeSetupTokenFailed"),
    accountPath: accountPathArbitrary,
    exitCode: fc.integer({ min: 1, max: 255 })
  }),
  fc.record({
    _tag: fc.constant("ClaudeLocalOauthSmokeSetupTokenMissingToken"),
    accountPath: accountPathArbitrary,
    exitCode: fc.constant(0)
  })
)

describe("Claude local OAuth smoke runner", () => {
  it.effect("builds isolated Claude env overrides for arbitrary base envs", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          envArbitrary,
          fc.string({ minLength: 1, maxLength: 40 }),
          oauthTokenArbitrary,
          (base, accountPath, token) => {
            const {
              [claudeCodeOauthTokenEnvKey]: _staleClaudeToken,
              [dockerGitClaudeOauthTokenEnvKey]: _staleDockerGitToken,
              ...expectedBase
            } = base
            expect(buildClaudeLocalOauthEnv(base, accountPath, token)).toEqual({
              ...expectedBase,
              CLAUDE_CONFIG_DIR: accountPath,
              CLAUDE_CODE_OAUTH_TOKEN: token,
              HOME: accountPath
            })
          }
        )
      )
    }))

  it.effect("renders every local smoke result as a stable tagged summary", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(smokeResultArbitrary, (result) => {
          const rendered = renderClaudeLocalOauthSmokeResult(result)
          expect(rendered).toContain(result._tag)
          expect(rendered).not.toContain(oauthTokenPrefix)
        })
      )
    }))

  it.effect("builds an isolated Claude env for the local probe", () =>
    Effect.sync(() => {
      expect(
        buildClaudeLocalOauthEnv(
          {
            PATH: "/bin",
            [claudeCodeOauthTokenEnvKey]: "STALE_CLAUDE_TOKEN",
            [dockerGitClaudeOauthTokenEnvKey]: "STALE_DOCKER_GIT_TOKEN"
          },
          "/tmp/claude",
          oauthToken
        )
      ).toEqual({
        PATH: "/bin",
        CLAUDE_CONFIG_DIR: "/tmp/claude",
        CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
        HOME: "/tmp/claude"
      })
    }))

  it.effect("persists the OAuth token in Claude's expected file", () =>
    Effect.gen(function*(_) {
      const root = yield* _(
        Effect.promise(() =>
          import("node:fs/promises").then((fs) =>
            fs.mkdtemp(`${process.env.TMPDIR ?? "/tmp"}/docker-git-auth-oauth-test-`)
          )
        )
      )
      yield* _(Effect.promise(() => persistClaudeLocalOauthToken(root, oauthToken)))
      const tokenFile = yield* _(Effect.promise(() => readFile(claudeOauthTokenPath(root), "utf8")))
      expect(tokenFile).toBe(`${oauthToken}\n`)
    }))

  it.effect("returns a missing-token result without invoking the probe", () =>
    Effect.gen(function*(_) {
      const result = yield* _(
        Effect.promise(() =>
          runClaudeLocalOauthSmoke({
            env: {},
            runProbe: () => {
              throw new Error("probe must not run")
            }
          })
        )
      )

      expect(result).toEqual({
        _tag: "ClaudeLocalOauthSmokeMissingToken",
        envKeys: claudeLocalOauthSmokeEnvKeys
      })
    }))

  it.effect("persists the token before running the probe", () =>
    Effect.gen(function*(_) {
      const seen = yield* _(
        Effect.promise(() =>
          runClaudeLocalOauthSmoke({
            mode: "env-token",
            env: { [dockerGitClaudeOauthTokenEnvKey]: oauthToken },
            runProbe: async (spec) => {
              await expect(readFile(claudeOauthTokenPath(spec.env.CLAUDE_CONFIG_DIR!), "utf8")).resolves.toBe(
                `${oauthToken}\n`
              )
              expect(spec.env.CLAUDE_CODE_OAUTH_TOKEN).toBe(oauthToken)
              return 0
            }
          })
        )
      )

      expect(seen._tag).toBe("ClaudeLocalOauthSmokeSucceeded")
    }))

  it.effect("captures setup-token output before running the probe", () =>
    Effect.gen(function*(_) {
      const events: Array<string> = []
      const result = yield* _(
        Effect.promise(() =>
          runClaudeLocalOauthSmoke({
            mode: "setup-token",
            env: {},
            runSetupToken: async (spec) => {
              events.push(`setup:${spec.args.join(" ")}`)
              return { exitCode: 0, token: ` ${oauthToken} ` }
            },
            runProbe: async (spec) => {
              events.push("probe")
              await expect(readFile(claudeOauthTokenPath(spec.env.CLAUDE_CONFIG_DIR!), "utf8")).resolves.toBe(
                `${oauthToken}\n`
              )
              return 0
            }
          })
        )
      )

      expect(result._tag).toBe("ClaudeLocalOauthSmokeSucceeded")
      expect(events).toEqual(["setup:setup-token", "probe"])
    }))

  it.effect("reports setup-token failures before probing", () =>
    Effect.gen(function*(_) {
      const result = yield* _(
        Effect.promise(() =>
          runClaudeLocalOauthSmoke({
            mode: "setup-token",
            env: {},
            runSetupToken: () => Promise.resolve({ exitCode: 23, token: null }),
            runProbe: () => {
              throw new Error("probe must not run")
            }
          })
        )
      )

      expect(renderClaudeLocalOauthSmokeResult(result)).toBe("smoke=ClaudeLocalOauthSmokeSetupTokenFailed exit=23")
    }))

  it.effect("reports failed local probes with the exit code", () =>
    Effect.gen(function*(_) {
      const result = yield* _(
        Effect.promise(() =>
          runClaudeLocalOauthSmoke({
            env: { [claudeCodeOauthTokenEnvKey]: oauthToken },
            runProbe: () => Promise.resolve(7)
          })
        )
      )

      expect(renderClaudeLocalOauthSmokeResult(result)).toBe("smoke=ClaudeLocalOauthSmokeProbeFailed exit=7")
    }))
})

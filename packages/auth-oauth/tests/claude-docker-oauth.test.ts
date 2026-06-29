import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fc from "fast-check"

import {
  renderClaudeDockerOauthDockerfile,
  renderClaudeDockerOauthResult,
  runClaudeDockerOauth,
  type ClaudeDockerBuildSpec,
  type ClaudeDockerProbeSpec,
  type ClaudeDockerSetupTokenSpec
} from "../src/claude-docker-oauth.js"
import { claudeOauthTokenFileMode, claudeOauthTokenPath } from "../src/claude-oauth-token.js"

const oauthTokenPrefix = ["sk", "ant", ""].join("-")
const makeOauthToken = (suffix: string): string => `${oauthTokenPrefix}oat01-${suffix}`
const oauthToken = makeOauthToken("DOCKER0123456789abcdef")
const oauthTokenArbitrary = fc.array(fc.constantFrom(
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "0",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9"
), {
  minLength: 24,
  maxLength: 64
}).map((chars) => `${oauthTokenPrefix}${chars.join("")}`)

const temporaryAccountPath = (prefix: string) =>
  Effect.acquireRelease(
    Effect.tryPromise(() => mkdtemp(join(tmpdir(), prefix))),
    (accountPath) => Effect.promise(() => rm(accountPath, { recursive: true, force: true }))
  )

describe("Claude Docker OAuth runner", () => {
  it.effect("runs Docker setup-token, persists token, then probes through the mounted token file", () =>
    Effect.scoped(Effect.gen(function*(_) {
      const accountPath = yield* _(temporaryAccountPath("docker-git-auth-oauth-docker-test-"))
      const builds: Array<ClaudeDockerBuildSpec> = []
      const setupRuns: Array<ClaudeDockerSetupTokenSpec> = []
      const probeRuns: Array<ClaudeDockerProbeSpec> = []

      const result = yield* _(
        Effect.tryPromise(() =>
          runClaudeDockerOauth({
            cwd: "/workspace",
            accountPath,
            image: "claude-test:latest",
            runBuild: (spec) => {
              builds.push(spec)
              return Effect.runPromise(Effect.succeed(0))
            },
            runSetupToken: (spec) => {
              setupRuns.push(spec)
              return Effect.runPromise(Effect.succeed({ exitCode: 1, token: oauthToken }))
            },
            runProbe: (spec) => {
              probeRuns.push(spec)
              return Effect.runPromise(
                Effect.gen(function*(_) {
                  const tokenFile = yield* _(Effect.tryPromise(() => readFile(claudeOauthTokenPath(accountPath), "utf8")))
                  expect(tokenFile).toBe(`${oauthToken}\n`)
                  return 0
                })
              )
            }
          })
        )
      )

      expect(result).toEqual({
        _tag: "ClaudeDockerOauthTokenCaptured",
        token: oauthToken,
        accountPath,
        image: "claude-test:latest",
        exitCode: 1,
        probeStatus: { _tag: "ClaudeDockerProbeSucceeded", exitCode: 0 }
      })
      expect(builds).toHaveLength(1)
      expect(builds[0]?.args.slice(0, 3)).toEqual(["build", "-t", "claude-test:latest"])
      expect(setupRuns).toHaveLength(1)
      expect(setupRuns[0]?.args).toContain("setup-token")
      expect(setupRuns[0]?.args.join(" ")).toContain(accountPath)
      expect(probeRuns).toHaveLength(1)
      expect(probeRuns[0]?.args.slice(-3)).toEqual(["claude-test:latest", "-p", "ping"])
      const tokenMode = yield* _(Effect.tryPromise(() => stat(claudeOauthTokenPath(accountPath))))
      expect(tokenMode.mode & 0o777).toBe(claudeOauthTokenFileMode)
    })))

  it.effect("keeps the captured token and file mode when Docker probe fails", () =>
    Effect.scoped(Effect.gen(function*(_) {
      const accountPath = yield* _(temporaryAccountPath("docker-git-auth-oauth-docker-probe-test-"))
      const result = yield* _(
        Effect.tryPromise(() =>
          runClaudeDockerOauth({
            accountPath,
            skipBuild: true,
            runSetupToken: () => Effect.runPromise(Effect.succeed({ exitCode: 0, token: oauthToken })),
            runProbe: () => Effect.runPromise(Effect.succeed(7))
          })
        )
      )

      expect(renderClaudeDockerOauthResult(result, false)).toBe(
        "status=ClaudeDockerOauthTokenCaptured probe=failed exit=7"
      )
      expect(renderClaudeDockerOauthResult(result, true)).toBe(
        `status=ClaudeDockerOauthTokenCaptured probe=failed exit=7 token=${oauthToken}`
      )
      const tokenFile = yield* _(Effect.tryPromise(() => readFile(claudeOauthTokenPath(accountPath), "utf8")))
      const tokenMode = yield* _(Effect.tryPromise(() => stat(claudeOauthTokenPath(accountPath))))
      expect(tokenFile).toBe(`${oauthToken}\n`)
      expect(tokenMode.mode & 0o777).toBe(claudeOauthTokenFileMode)
    })))

  it.effect("returns command failure when setup-token exits non-zero without token", () =>
    Effect.gen(function*(_) {
      const result = yield* _(
        Effect.tryPromise(() =>
          runClaudeDockerOauth({
            skipBuild: true,
            runSetupToken: () => Effect.runPromise(Effect.succeed({ exitCode: 23, token: null })),
            runProbe: () => Effect.runPromise(Effect.dieMessage("probe must not run"))
          })
        )
      )

      expect(renderClaudeDockerOauthResult(result, true)).toBe("status=ClaudeDockerOauthCommandFailed exit=23")
    }))

  it("renders the Claude OAuth Dockerfile from pinned inputs", () => {
    const dockerfile = renderClaudeDockerOauthDockerfile()
    expect(dockerfile).toContain("FROM node:24-bookworm-slim@sha256:")
    expect(dockerfile).toContain("@anthropic-ai/claude-code@2.1.195")
    expect(dockerfile).not.toContain("@latest")
    expect(dockerfile).not.toContain("curl -fsSL https://deb.nodesource.com")
  })

  it("renders tagged results without exposing tokens unless explicitly requested", () => {
    fc.assert(
      fc.property(oauthTokenArbitrary, fc.integer({ min: 1, max: 255 }), (token, exitCode) => {
        const result = {
          _tag: "ClaudeDockerOauthTokenCaptured",
          token,
          accountPath: "/tmp/claude",
          image: "claude-test:latest",
          exitCode: 0,
          probeStatus: { _tag: "ClaudeDockerProbeFailed", exitCode }
        } satisfies Awaited<ReturnType<typeof runClaudeDockerOauth>>

        expect(renderClaudeDockerOauthResult(result, false)).toBe(
          `status=ClaudeDockerOauthTokenCaptured probe=failed exit=${exitCode}`
        )
        expect(renderClaudeDockerOauthResult(result, true)).toBe(
          `status=ClaudeDockerOauthTokenCaptured probe=failed exit=${exitCode} token=${token}`
        )
      })
    )
  })
})

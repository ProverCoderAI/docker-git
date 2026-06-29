import { readFile } from "node:fs/promises"

import { describe, expect, it } from "vitest"

import {
  buildClaudeLocalOauthEnv,
  claudeLocalOauthSmokeEnvKeys,
  persistClaudeLocalOauthToken,
  renderClaudeLocalOauthSmokeResult,
  runClaudeLocalOauthSmoke
} from "../src/claude-local-smoke.js"
import {
  claudeCodeOauthTokenEnvKey,
  claudeOauthTokenPath,
  dockerGitClaudeOauthTokenEnvKey
} from "../src/claude-oauth-token.js"

const oauthToken = "sk-ant-oat01-SMOKE0123456789abcdef"

describe("Claude local OAuth smoke runner", () => {
  it("builds an isolated Claude env for the local probe", () => {
    expect(buildClaudeLocalOauthEnv({ PATH: "/bin" }, "/tmp/claude", oauthToken)).toEqual({
      PATH: "/bin",
      CLAUDE_CONFIG_DIR: "/tmp/claude",
      CLAUDE_CODE_OAUTH_TOKEN: oauthToken,
      HOME: "/tmp/claude"
    })
  })

  it("persists the OAuth token in Claude's expected file", async () => {
    const root = await import("node:fs/promises").then((fs) =>
      fs.mkdtemp(`${process.env.TMPDIR ?? "/tmp"}/docker-git-auth-oauth-test-`)
    )
    await persistClaudeLocalOauthToken(root, oauthToken)
    await expect(readFile(claudeOauthTokenPath(root), "utf8")).resolves.toBe(`${oauthToken}\n`)
  })

  it("returns a missing-token result without invoking the probe", async () => {
    const result = await runClaudeLocalOauthSmoke({
      env: {},
      runProbe: () => {
        throw new Error("probe must not run")
      }
    })

    expect(result).toEqual({
      _tag: "ClaudeLocalOauthSmokeMissingToken",
      envKeys: claudeLocalOauthSmokeEnvKeys
    })
  })

  it("persists the token before running the probe", async () => {
    const seen = await runClaudeLocalOauthSmoke({
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

    expect(seen._tag).toBe("ClaudeLocalOauthSmokeSucceeded")
  })

  it("captures setup-token output before running the probe", async () => {
    const events: Array<string> = []
    const result = await runClaudeLocalOauthSmoke({
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

    expect(result._tag).toBe("ClaudeLocalOauthSmokeSucceeded")
    expect(events).toEqual(["setup:setup-token", "probe"])
  })

  it("reports setup-token failures before probing", async () => {
    const result = await runClaudeLocalOauthSmoke({
      mode: "setup-token",
      env: {},
      runSetupToken: () => Promise.resolve({ exitCode: 23, token: null }),
      runProbe: () => {
        throw new Error("probe must not run")
      }
    })

    expect(renderClaudeLocalOauthSmokeResult(result)).toBe("smoke=ClaudeLocalOauthSmokeSetupTokenFailed exit=23")
  })

  it("reports failed local probes with the exit code", async () => {
    const result = await runClaudeLocalOauthSmoke({
      env: { [claudeCodeOauthTokenEnvKey]: oauthToken },
      runProbe: () => Promise.resolve(7)
    })

    expect(renderClaudeLocalOauthSmokeResult(result)).toBe("smoke=ClaudeLocalOauthSmokeProbeFailed exit=7")
  })
})

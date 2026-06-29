import { mkdtemp, readFile, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  renderClaudeDockerOauthResult,
  runClaudeDockerOauth,
  type ClaudeDockerBuildSpec,
  type ClaudeDockerProbeSpec,
  type ClaudeDockerSetupTokenSpec
} from "../src/claude-docker-oauth.js"
import { claudeOauthTokenPath } from "../src/claude-oauth-token.js"

const oauthToken = "sk-ant-oat01-DOCKER0123456789abcdef"

describe("Claude Docker OAuth runner", () => {
  it("runs Docker setup-token, persists token, then probes through the mounted token file", async () => {
    const accountPath = await mkdtemp(join(tmpdir(), "docker-git-auth-oauth-docker-test-"))
    const builds: Array<ClaudeDockerBuildSpec> = []
    const setupRuns: Array<ClaudeDockerSetupTokenSpec> = []
    const probeRuns: Array<ClaudeDockerProbeSpec> = []

    const result = await runClaudeDockerOauth({
      cwd: "/workspace",
      accountPath,
      image: "claude-test:latest",
      runBuild: (spec) => {
        builds.push(spec)
        return Promise.resolve(0)
      },
      runSetupToken: (spec) => {
        setupRuns.push(spec)
        return Promise.resolve({ exitCode: 1, token: oauthToken })
      },
      runProbe: async (spec) => {
        probeRuns.push(spec)
        await expect(readFile(claudeOauthTokenPath(accountPath), "utf8")).resolves.toBe(`${oauthToken}\n`)
        return 0
      }
    })

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
    expect((await stat(claudeOauthTokenPath(accountPath))).mode & 0o777).toBe(0o600)
  })

  it("keeps the captured token when Docker probe fails", async () => {
    const accountPath = await mkdtemp(join(tmpdir(), "docker-git-auth-oauth-docker-probe-test-"))
    const result = await runClaudeDockerOauth({
      accountPath,
      skipBuild: true,
      runSetupToken: () => Promise.resolve({ exitCode: 0, token: oauthToken }),
      runProbe: () => Promise.resolve(7)
    })

    expect(renderClaudeDockerOauthResult(result, false)).toBe(
      "status=ClaudeDockerOauthTokenCaptured probe=failed exit=7"
    )
    expect(renderClaudeDockerOauthResult(result, true)).toBe(
      `status=ClaudeDockerOauthTokenCaptured probe=failed exit=7 token=${oauthToken}`
    )
  })

  it("returns command failure when setup-token exits non-zero without token", async () => {
    const result = await runClaudeDockerOauth({
      skipBuild: true,
      runSetupToken: () => Promise.resolve({ exitCode: 23, token: null }),
      runProbe: () => {
        throw new Error("probe must not run")
      }
    })

    expect(renderClaudeDockerOauthResult(result, true)).toBe("status=ClaudeDockerOauthCommandFailed exit=23")
  })
})

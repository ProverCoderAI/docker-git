import { Effect } from "effect"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildAgentDockerExecArgs,
  buildAgentScript,
  buildCommand,
  clearAgentRuntimeForTest,
  initializeAgentState,
  listAgents
} from "../src/services/agents.js"

const writeAgentSnapshot = (projectsRoot: string, content: string): void => {
  const stateDir = path.join(projectsRoot, ".orch", "state")
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(path.join(stateDir, "api-agents.json"), content, "utf8")
}

let projectsRoot = ""
let previousProjectsRoot: string | undefined

beforeEach(() => {
  previousProjectsRoot = process.env["DOCKER_GIT_PROJECTS_ROOT"]
  projectsRoot = mkdtempSync(path.join(os.tmpdir(), "docker-git-agents-"))
  process.env["DOCKER_GIT_PROJECTS_ROOT"] = projectsRoot
  clearAgentRuntimeForTest()
})

afterEach(() => {
  clearAgentRuntimeForTest()
  if (previousProjectsRoot === undefined) {
    delete process.env["DOCKER_GIT_PROJECTS_ROOT"]
  } else {
    process.env["DOCKER_GIT_PROJECTS_ROOT"] = previousProjectsRoot
  }
  rmSync(projectsRoot, { recursive: true, force: true })
})

describe("agent service", () => {
  it("starts default Codex agents with isolated Playwright MCP", () => {
    expect(buildCommand({ provider: "codex" })).toBe("MCP_PLAYWRIGHT_ISOLATED=1 codex")
    expect(buildCommand({ provider: "codex", args: ["exec", "hello world"] })).toBe(
      "MCP_PLAYWRIGHT_ISOLATED=1 codex 'exec' 'hello world'"
    )
  })

  it("starts default Claude agents with isolated Playwright MCP", () => {
    expect(buildCommand({ provider: "claude" })).toBe("MCP_PLAYWRIGHT_ISOLATED=1 claude")
    expect(buildCommand({ provider: "claude", args: ["-p", "hello world"] })).toBe(
      "MCP_PLAYWRIGHT_ISOLATED=1 claude '-p' 'hello world'"
    )
  })

  it("starts default Grok agents with isolated Playwright MCP and unrestricted sandbox", () => {
    expect(buildCommand({ provider: "grok" })).toBe("MCP_PLAYWRIGHT_ISOLATED=1 grok --no-sandbox")
    expect(buildCommand({ provider: "grok", args: ["-p", "hello world"] })).toBe(
      "MCP_PLAYWRIGHT_ISOLATED=1 grok --no-sandbox '-p' 'hello world'"
    )
  })

  it("starts default OpenCode agents without extra env assignments", () => {
    expect(buildCommand({ provider: "opencode" })).toBe("opencode")
  })

  it("does not rewrite custom agent commands", () => {
    expect(buildCommand({ provider: "codex", command: "codex --help" })).toBe("codex --help")
  })

  it("runs agent scripts in the project SSH user's RTK-ready environment", () => {
    const script = buildAgentScript(
      "session-1",
      "/home/dev/app",
      "dev",
      "/home/dev/.codex",
      [
        { key: "DOCKER_GIT_RTK_ENABLE", value: "0" },
        { key: "QUOTED", value: "can't fail" }
      ],
      "MCP_PLAYWRIGHT_ISOLATED=1 codex 'exec' 'hello world'"
    )

    expect(script).toContain("echo $$ > \"$PID_FILE\"")
    expect(script).toContain("export HOME='/home/dev'")
    expect(script).toContain("export USER='dev'")
    expect(script).toContain("export LOGNAME='dev'")
    expect(script).toContain("export CODEX_HOME='/home/dev/.codex'")
    expect(script).toContain("if [ -f /etc/profile ]; then . /etc/profile >/dev/null 2>&1 || true; fi")
    expect(script).toContain("if [ -f '/home/dev/.ssh/environment' ]; then")
    expect(script).toContain(
      "if [ -f /run/docker-git/agent-env.sh ]; then . /run/docker-git/agent-env.sh >/dev/null 2>&1 || true; fi"
    )
    expect(script).toContain("export DOCKER_GIT_RTK_ENABLE='0'")
    expect(script).toContain("export QUOTED='can'\\''t fail'")
    expect(script).toContain("cd '/home/dev/app'")
    expect(script).toContain("exec env MCP_PLAYWRIGHT_ISOLATED=1 codex 'exec' 'hello world'")
    expect(script.indexOf("if [ -f /run/docker-git/agent-env.sh ]")).toBeLessThan(
      script.indexOf("export DOCKER_GIT_RTK_ENABLE='0'")
    )
  })

  it("rejects invalid agent env keys before rendering shell exports", () => {
    expect(() =>
      buildAgentScript(
        "session-1",
        "/home/dev/app",
        "dev",
        "/home/dev/.codex",
        [{ key: "BAD;echo hacked", value: "1" }],
        "opencode"
      )
    ).toThrow("Invalid agent env key: BAD;echo hacked")
  })

  it("uses docker exec as the project SSH user with the user home env", () => {
    const args = buildAgentDockerExecArgs(
      { containerName: "dev-ssh", sshUser: "dev", codexHome: "/home/dev/.codex" },
      "echo ok"
    )

    expect(args).toEqual([
      "exec",
      "-i",
      "-u",
      "dev",
      "-e",
      "HOME=/home/dev",
      "-e",
      "USER=dev",
      "-e",
      "LOGNAME=dev",
      "-e",
      "CODEX_HOME=/home/dev/.codex",
      "dev-ssh",
      "bash",
      "-lc",
      "echo ok"
    ])
  })

  it("hydrates persisted agent sessions through typed snapshot decoding", () =>
    Effect.runPromise(
      Effect.sync(() => {
        writeAgentSnapshot(projectsRoot, JSON.stringify({
          sessions: [
            {
              id: "agent-1",
              projectId: "project-1",
              provider: "codex",
              label: "Codex",
              command: "codex",
              containerName: "project-container",
              status: "running",
              source: "provider:codex",
              pidFile: "/tmp/docker-git-agent-agent-1.pid",
              hostPid: 1234,
              startedAt: "2026-06-17T00:00:00.000Z",
              updatedAt: "2026-06-17T00:00:00.000Z"
            }
          ]
        }))
      }).pipe(
        Effect.zipRight(initializeAgentState()),
        Effect.tap(() =>
          Effect.sync(() => {
            expect(listAgents("project-1")).toMatchObject([
              {
                id: "agent-1",
                hostPid: null,
                status: "exited",
                stoppedAt: expect.any(String)
              }
            ])
          })
        )
      )
    ))

  it("treats invalid persisted agent snapshots as empty best-effort state", () =>
    Effect.runPromise(
      Effect.sync(() => {
        writeAgentSnapshot(projectsRoot, "{ invalid json")
      }).pipe(
        Effect.zipRight(initializeAgentState()),
        Effect.tap(() =>
          Effect.sync(() => {
            expect(listAgents("project-1")).toEqual([])
          })
        )
      )
    ))
})

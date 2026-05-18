import { describe, expect, it } from "vitest"

import { buildAgentDockerExecArgs, buildAgentScript, buildCommand } from "../src/services/agents.js"

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
})

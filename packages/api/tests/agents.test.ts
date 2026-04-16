import { describe, expect, it } from "vitest"

import { buildCommand } from "../src/services/agents.js"

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

  it("does not rewrite custom agent commands", () => {
    expect(buildCommand({ provider: "codex", command: "codex --help" })).toBe("codex --help")
  })
})

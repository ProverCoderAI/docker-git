import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { expectProjectDirRunUpCommand, parseOrThrow } from "./parser-helpers.js"

describe("parseArgs project actions", () => {
  it.effect("parses mcp-playwright command in current directory", () =>
    expectProjectDirRunUpCommand(["mcp-playwright"], "McpPlaywrightUp", ".", true))

  it.effect("parses mcp-playwright command with --no-up", () =>
    expectProjectDirRunUpCommand(["mcp-playwright", "--no-up"], "McpPlaywrightUp", ".", false))

  it.effect("parses mcp-playwright with positional repo url into project dir", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["mcp-playwright", "https://github.com/org/repo.git"])
      if (command._tag !== "McpPlaywrightUp") {
        throw new Error("expected McpPlaywrightUp command")
      }
      expect(command.projectDir).toBe(".docker-git/org/repo")
    }))

  it.effect("parses apply command in current directory", () =>
    expectProjectDirRunUpCommand(["apply"], "Apply", ".", true))

  it.effect("parses apply command with --no-up", () =>
    expectProjectDirRunUpCommand(["apply", "--no-up"], "Apply", ".", false))

  it.effect("parses apply with positional repo url into project dir", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["apply", "https://github.com/org/repo.git"])
      if (command._tag !== "Apply") {
        throw new Error("expected Apply command")
      }
      expect(command.projectDir).toBe(".docker-git/org/repo")
    }))

  it.effect("parses apply token and mcp overrides", () =>
    Effect.sync(() => {
      const command = parseOrThrow([
        "apply",
        "--git-token=agien_main",
        "--codex-token=Team A",
        "--claude-token=Team B",
        "--cpu=2",
        "--ram=4g",
        "--gpu=all",
        "--mcp-playwright",
        "--no-up"
      ])
      if (command._tag !== "Apply") {
        throw new Error("expected Apply command")
      }
      expect(command.runUp).toBe(false)
      expect(command.gitTokenLabel).toBe("agien_main")
      expect(command.codexTokenLabel).toBe("Team A")
      expect(command.claudeTokenLabel).toBe("Team B")
      expect(command.cpuLimit).toBe("2")
      expect(command.ramLimit).toBe("4g")
      expect(command.gpu).toBe("all")
      expect(command.enableMcpPlaywright).toBe(true)
    }))

  it.effect("parses apply-all and update-all commands", () =>
    Effect.sync(() => {
      expect(parseOrThrow(["apply-all"])._tag).toBe("ApplyAll")
      expect(parseOrThrow(["update-all"])._tag).toBe("ApplyAll")
    }))

  it.effect("parses down-all command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["down-all"])
      expect(command._tag).toBe("DownAll")
    }))

  it.effect("parses state path command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "path"])
      expect(command._tag).toBe("StatePath")
    }))

  it.effect("parses state init command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "init", "--repo-url", "https://github.com/org/state.git"])
      if (command._tag !== "StateInit") {
        throw new Error("expected StateInit command")
      }
      expect(command.repoUrl).toBe("https://github.com/org/state.git")
      expect(command.repoRef).toBe("main")
    }))

  it.effect("parses state commit command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "commit", "-m", "sync state"])
      if (command._tag !== "StateCommit") {
        throw new Error("expected StateCommit command")
      }
      expect(command.message).toBe("sync state")
    }))

  it.effect("parses state sync command", () =>
    Effect.sync(() => {
      const command = parseOrThrow(["state", "sync", "-m", "sync state"])
      if (command._tag !== "StateSync") {
        throw new Error("expected StateSync command")
      }
      expect(command.message).toBe("sync state")
    }))
})

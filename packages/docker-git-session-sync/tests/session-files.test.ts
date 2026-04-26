import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { shouldIgnoreSessionPath } from "../src/core.js"
import { collectSessionFiles, type Output } from "../src/backup.js"
import { parseArgs } from "../src/cli.js"

const output: Output = {
  out: () => undefined,
  err: () => undefined
}

let tmpDir = ""

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "docker-git-session-sync-test-"))
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe("session path filtering", () => {
  it("ignores tmp directories while keeping persistent session files", () => {
    const codexDir = path.join(tmpDir, ".codex")
    const claudeDir = path.join(tmpDir, ".claude")
    fs.mkdirSync(path.join(codexDir, "tmp"), { recursive: true })
    fs.mkdirSync(path.join(codexDir, "memory"), { recursive: true })
    fs.mkdirSync(path.join(claudeDir, "profiles"), { recursive: true })
    fs.writeFileSync(path.join(codexDir, "history.jsonl"), "{}\n")
    fs.writeFileSync(path.join(codexDir, "tmp", "session.lock"), "lock")
    fs.writeFileSync(path.join(codexDir, "memory", "notes.md"), "# notes\n")
    fs.writeFileSync(path.join(claudeDir, "profiles", "default.json"), "{}")

    const logicalNames = [
      ...collectSessionFiles(codexDir, ".codex", false, output),
      ...collectSessionFiles(claudeDir, ".claude", false, output)
    ].map((file) => file.logicalName)

    expect(logicalNames).toContain(".codex/history.jsonl")
    expect(logicalNames).toContain(".codex/memory/notes.md")
    expect(logicalNames).toContain(".claude/profiles/default.json")
    expect(logicalNames).not.toContain(".codex/tmp/session.lock")
  })

  it("treats nested tmp segments as ignored paths", () => {
    expect(shouldIgnoreSessionPath("tmp")).toBe(true)
    expect(shouldIgnoreSessionPath("tmp/session.lock")).toBe(true)
    expect(shouldIgnoreSessionPath("memory/tmp/session.lock")).toBe(true)
    expect(shouldIgnoreSessionPath("memory/notes.md")).toBe(false)
  })
})

describe("CLI parser", () => {
  it("parses backup options for PR comments", () => {
    expect(parseArgs(["backup", "--repo", "org/repo", "--pr-number", "42", "--no-comment"])).toEqual({
      _tag: "Ok",
      command: {
        _tag: "Backup",
        sessionDir: null,
        prNumber: 42,
        repo: "org/repo",
        postComment: false,
        dryRun: false,
        verbose: false
      }
    })
  })

  it("rejects missing snapshot refs", () => {
    expect(parseArgs(["view"])).toEqual({ _tag: "Error", message: "view requires <snapshot-ref>" })
    expect(parseArgs(["download"])).toEqual({ _tag: "Error", message: "download requires <snapshot-ref>" })
  })
})

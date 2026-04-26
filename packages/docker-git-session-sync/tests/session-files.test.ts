import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { buildSnapshotRef, isChatTranscriptPath, shouldIgnoreSessionPath } from "../src/core.js"
import { collectSessionFiles, type Output } from "../src/backup.js"
import { parseArgs } from "../src/cli.js"
import { removeSnapshotTreeEntries } from "../src/shell.js"
import type { TreeEntry } from "../src/types.js"

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
  it("keeps only known agent chat transcripts", () => {
    const codexDir = path.join(tmpDir, ".codex")
    const claudeDir = path.join(tmpDir, ".claude")
    const geminiDir = path.join(tmpDir, ".gemini")
    fs.mkdirSync(path.join(codexDir, "tmp"), { recursive: true })
    fs.mkdirSync(path.join(codexDir, "sessions", "2026", "04", "26"), { recursive: true })
    fs.mkdirSync(path.join(claudeDir, "projects", "-workspace"), { recursive: true })
    fs.mkdirSync(geminiDir, { recursive: true })
    fs.writeFileSync(path.join(codexDir, "history.jsonl"), "{}\n")
    fs.writeFileSync(path.join(codexDir, "config.toml"), "[tools]\n")
    fs.writeFileSync(path.join(codexDir, "sessions", "2026", "04", "26", "rollout.jsonl"), "{}\n")
    fs.writeFileSync(path.join(codexDir, "tmp", "session.lock"), "lock")
    fs.writeFileSync(path.join(claudeDir, "CLAUDE.md"), "# notes\n")
    fs.writeFileSync(path.join(claudeDir, "projects", "-workspace", "chat.jsonl"), "{}\n")
    fs.writeFileSync(path.join(geminiDir, "settings.json"), "{}")

    const logicalNames = [
      ...collectSessionFiles(codexDir, ".codex", false, output),
      ...collectSessionFiles(claudeDir, ".claude", false, output),
      ...collectSessionFiles(geminiDir, ".gemini", false, output)
    ].map((file) => file.logicalName).sort()

    expect(logicalNames).toEqual([
      ".claude/projects/-workspace/chat.jsonl",
      ".codex/sessions/2026/04/26/rollout.jsonl"
    ])
    expect(logicalNames).not.toContain(".codex/history.jsonl")
    expect(logicalNames).not.toContain(".codex/config.toml")
    expect(logicalNames).not.toContain(".codex/tmp/session.lock")
    expect(logicalNames).not.toContain(".claude/CLAUDE.md")
    expect(logicalNames).not.toContain(".gemini/settings.json")
  })

  it("treats nested tmp segments as ignored paths", () => {
    expect(shouldIgnoreSessionPath("tmp")).toBe(true)
    expect(shouldIgnoreSessionPath("tmp/session.lock")).toBe(true)
    expect(shouldIgnoreSessionPath("memory/tmp/session.lock")).toBe(true)
    expect(shouldIgnoreSessionPath("memory/notes.md")).toBe(false)
  })

  it("recognizes only Codex and Claude transcript paths", () => {
    expect(isChatTranscriptPath(".codex/sessions/2026/04/26/rollout.jsonl")).toBe(true)
    expect(isChatTranscriptPath(".claude/projects/-workspace/chat.jsonl")).toBe(true)
    expect(isChatTranscriptPath(".codex/history.jsonl")).toBe(false)
    expect(isChatTranscriptPath(".claude/projects/-workspace/settings.json")).toBe(false)
    expect(isChatTranscriptPath(".gemini/sessions/chat.jsonl")).toBe(false)
  })
})

describe("snapshot refs", () => {
  it("uses stable current refs for PR and branch snapshots", () => {
    expect(buildSnapshotRef("org/repo", 230, "issue-230")).toBe("org/repo/pr-230/current")
    expect(buildSnapshotRef("org/repo", null, "feature/session sync")).toBe("org/repo/branch-feature-session-sync/current")
  })
})

describe("snapshot tree replacement", () => {
  it("removes only files under the exact current snapshot prefix", () => {
    const entries: ReadonlyArray<TreeEntry> = [
      {
        path: "org/repo/pr-230/current/.codex/sessions/old.jsonl",
        mode: "100644",
        type: "blob",
        sha: "old"
      },
      {
        path: "org/repo/pr-230/current-old/.codex/sessions/keep.jsonl",
        mode: "100644",
        type: "blob",
        sha: "keep-neighbor"
      },
      {
        path: "org/repo/pr-230/2026-04-26/manifest.json",
        mode: "100644",
        type: "blob",
        sha: "keep-legacy"
      },
      {
        path: "org/repo/pr-231/current/.codex/sessions/keep.jsonl",
        mode: "100644",
        type: "blob",
        sha: "keep-other-pr"
      }
    ]

    expect(removeSnapshotTreeEntries(entries, "org/repo/pr-230/current").map((entry) => entry.path)).toEqual([
      "org/repo/pr-230/current-old/.codex/sessions/keep.jsonl",
      "org/repo/pr-230/2026-04-26/manifest.json",
      "org/repo/pr-231/current/.codex/sessions/keep.jsonl"
    ])
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

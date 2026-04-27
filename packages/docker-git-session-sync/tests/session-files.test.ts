import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  buildCommentBody,
  buildSnapshotRef,
  isChatTranscriptPath,
  maxRepoFileSize,
  shouldIgnoreSessionPath
} from "../src/core.js"
import { collectSessionFiles, parseUploadContext, uploadFromContext, type Output } from "../src/backup.js"
import { parseArgs } from "../src/cli.js"
import {
  buildUploadTreeChanges,
  gitBlobShaForBuffer,
  hasChangedUploadEntries,
  prepareUploadArtifacts
} from "../src/shell.js"
import type { TreeEntry, UploadEntry } from "../src/types.js"

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

describe("upload artifacts", () => {
  it("keeps GitHub API blob payloads below the repository file limit", () => {
    expect(maxRepoFileSize).toBeLessThanOrEqual(20 * 1000 * 1000)
  })

  it("stages session contents before hashing and upload", () => {
    const codexDir = path.join(tmpDir, ".codex")
    const sessionPath = path.join(codexDir, "sessions", "2026", "04", "27", "rollout.jsonl")
    fs.mkdirSync(path.dirname(sessionPath), { recursive: true })
    fs.writeFileSync(sessionPath, "before\n")

    const sessionFiles = collectSessionFiles(codexDir, ".codex", false, output)
    const prepared = prepareUploadArtifacts(
      sessionFiles,
      "org/repo/pr-230/current",
      "backup-owner/docker-git-sessions",
      "main",
      tmpDir,
      () => undefined
    )
    fs.writeFileSync(sessionPath, "after\n")

    const entry = prepared.uploadEntries[0]
    expect(entry?.repoPath).toBe("org/repo/pr-230/current/.codex/sessions/2026/04/27/rollout.jsonl")
    expect(entry === undefined ? "" : fs.readFileSync(entry.sourcePath, "utf8")).toBe("before\n")
    expect(entry?.blobSha).toBe(gitBlobShaForBuffer(Buffer.from("before\n")))
  })
})

describe("snapshot tree updates", () => {
  it("keeps stale remote session files untouched", () => {
    const entries: ReadonlyArray<TreeEntry> = [
      {
        path: "org/repo/pr-230/current/.codex/sessions/old.jsonl",
        mode: "100644",
        type: "blob",
        sha: "old"
      },
      {
        path: "org/repo/pr-230/current/.codex/sessions/keep.jsonl",
        mode: "100644",
        type: "blob",
        sha: "keep"
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
    const desiredEntries: ReadonlyArray<UploadEntry> = [
      {
        repoPath: "org/repo/pr-230/current/.codex/sessions/keep.jsonl",
        sourcePath: path.join(tmpDir, "unused.jsonl"),
        type: "file",
        size: 4,
        blobSha: "keep"
      }
    ]

    expect(hasChangedUploadEntries(entries, desiredEntries)).toBe(false)
    expect(buildUploadTreeChanges("backup-owner/docker-git-sessions", entries, desiredEntries, {})).toEqual([])
  })
})

describe("PR comment body", () => {
  const source = {
    repo: "org/repo",
    branch: "issue-230",
    prNumber: 230,
    commitSha: "0123456789abcdef",
    createdAt: "2026-04-27T00:00:00.000Z"
  }

  it("keeps git status in queued, success, and failure states", () => {
    const gitStatus = "On branch issue-230\nChanges not staged for commit:\n  modified: src/app.ts"
    const gitStatusBlock = ["`git status`", "```", gitStatus, "```"].join("\n")

    const queuedBody = buildCommentBody({ source, upload: { state: "queued" }, gitStatus })
    const successBody = buildCommentBody({
      source,
      upload: {
        state: "success",
        manifestUrl: "https://example.test/manifest",
        readmeUrl: "https://example.test/readme",
        summary: { fileCount: 2, totalBytes: 1234 }
      },
      gitStatus
    })
    const failureBody = buildCommentBody({
      source,
      upload: { state: "failed", message: "upload failed" },
      gitStatus
    })

    expect(queuedBody).toContain("Status: queued")
    expect(queuedBody).toContain(gitStatusBlock)
    expect(successBody).toContain("Status: success")
    expect(successBody).toContain("Links: [README](https://example.test/readme) | [Manifest](https://example.test/manifest)")
    expect(successBody).toContain(gitStatusBlock)
    expect(failureBody).toContain("Status: failure")
    expect(failureBody).toContain("Error: upload failed")
    expect(failureBody).toContain(gitStatusBlock)
  })

  it("marks unavailable git status explicitly", () => {
    expect(buildCommentBody({ source, upload: { state: "queued" }, gitStatus: null })).toContain(
      ["`git status`", "```", "(unavailable)", "```"].join("\n")
    )
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
        verbose: false,
        background: false,
        requireComment: false
      }
    })
  })

  it("parses background backup options", () => {
    expect(parseArgs(["backup", "--verbose", "--background", "--require-comment"])).toEqual({
      _tag: "Ok",
      command: {
        _tag: "Backup",
        sessionDir: null,
        prNumber: null,
        repo: null,
        postComment: true,
        dryRun: false,
        verbose: true,
        background: true,
        requireComment: true
      }
    })
  })

  it("parses internal upload options", () => {
    expect(parseArgs(["upload", "--context", "/tmp/session-upload.json", "--verbose"])).toEqual({
      _tag: "Ok",
      command: {
        _tag: "Upload",
        contextPath: "/tmp/session-upload.json",
        readyFilePath: null,
        verbose: true
      }
    })
  })

  it("parses internal upload readiness handshakes", () => {
    expect(parseArgs(["upload", "--context", "/tmp/session-upload.json", "--ready-file", "/tmp/ready.json", "--verbose"])).toEqual({
      _tag: "Ok",
      command: {
        _tag: "Upload",
        contextPath: "/tmp/session-upload.json",
        readyFilePath: "/tmp/ready.json",
        verbose: true
      }
    })
  })

  it("parses background upload contexts with nested PR comment metadata", () => {
    const parsed = parseUploadContext({
      version: 1,
      cwd: "/workspace",
      sessionDir: null,
      source: {
        repo: "org/repo",
        branch: "issue-230",
        prNumber: 230,
        commitSha: "0123456789abcdef",
        createdAt: "2026-04-27T00:00:00.000Z"
      },
      snapshotRef: "org/repo/pr-230/current",
      gitStatus: "dirty",
      prComment: {
        repo: "org/repo",
        comment: {
          id: 1001,
          url: "https://example.test/comment"
        }
      },
      verbose: true
    })

    expect(parsed?.prComment?.comment.id).toBe(1001)
  })

  it("rejects missing snapshot refs", () => {
    expect(parseArgs(["view"])).toEqual({ _tag: "Error", message: "view requires <snapshot-ref>" })
    expect(parseArgs(["download"])).toEqual({ _tag: "Error", message: "download requires <snapshot-ref>" })
  })
})

describe("background upload handshakes", () => {
  it("reports invalid upload contexts to the parent process", () => {
    const contextPath = path.join(tmpDir, "bad-context.json")
    const readyFilePath = path.join(tmpDir, "ready.json")
    const errors: Array<string> = []
    fs.writeFileSync(contextPath, "{}\n", "utf8")

    expect(uploadFromContext({
      contextPath,
      readyFilePath,
      verbose: false
    }, tmpDir, {
      out: () => undefined,
      err: (message) => errors.push(message)
    })).toBe(1)

    expect(JSON.parse(fs.readFileSync(readyFilePath, "utf8"))).toEqual({
      state: "failed",
      message: "Invalid upload context"
    })
    expect(errors).toContain("[session-backup] Invalid upload context")
  })
})

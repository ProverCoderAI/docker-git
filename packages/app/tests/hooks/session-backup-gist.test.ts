// CHANGE: add regression coverage for session backup tmp filtering
// WHY: session snapshots must ignore transient tmp directories while preserving persistent files
// REF: issue-198
// PURITY: SHELL (tests filesystem traversal against committed backup script)

import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fs from "node:fs"
import path from "node:path"

import sessionBackupGist from "../../../../scripts/session-backup-gist.js"

const { collectSessionFiles, shouldIgnoreSessionPath } = sessionBackupGist
const tmpDirPrefix = path.join(process.cwd(), ".tmp-session-backup-gist-")

const withTempDir = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(tmpDirPrefix)),
  (tmpDir) =>
    Effect.sync(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
)

describe("session-backup-gist tmp filtering", () => {
  it.effect("ignores tmp directories while keeping persistent session files", () =>
    Effect.scoped(
      Effect.gen(function*(_) {
        const tmpDir = yield* _(withTempDir)
        const codexDir = path.join(tmpDir, ".codex")
        const claudeDir = path.join(tmpDir, ".claude")

        yield* _(
          Effect.sync(() => {
            fs.mkdirSync(path.join(codexDir, "tmp", "run"), { recursive: true })
            fs.mkdirSync(path.join(codexDir, "memory"), { recursive: true })
            fs.mkdirSync(path.join(claudeDir, "tmp"), { recursive: true })
            fs.mkdirSync(path.join(claudeDir, "profiles"), { recursive: true })

            fs.writeFileSync(path.join(codexDir, "tmp", "run", ".lock"), "lock")
            fs.writeFileSync(path.join(codexDir, "history.jsonl"), "{\"event\":1}\n")
            fs.writeFileSync(path.join(codexDir, "memory", "notes.md"), "# notes\n")
            fs.writeFileSync(path.join(claudeDir, "tmp", "session.lock"), "lock")
            fs.writeFileSync(path.join(claudeDir, "profiles", "default.json"), "{}\n")
          })
        )

        const files = [
          ...collectSessionFiles(codexDir, ".codex", false),
          ...collectSessionFiles(claudeDir, ".claude", false)
        ]
        const logicalNames = files
          .map((file) => file.logicalName)
          .toSorted((left, right) => left.localeCompare(right))

        yield* _(
          Effect.sync(() => {
            expect(logicalNames).toContain(".codex/history.jsonl")
            expect(logicalNames).toContain(".codex/memory/notes.md")
            expect(logicalNames).toContain(".claude/profiles/default.json")
            expect(logicalNames.some((name) => name.split("/").includes("tmp"))).toBe(false)
          })
        )
      })
    ))

  it.effect("marks tmp paths for exclusion", () =>
    Effect.sync(() => {
      expect(shouldIgnoreSessionPath("tmp")).toBe(true)
      expect(shouldIgnoreSessionPath("tmp/run/.lock")).toBe(true)
      expect(shouldIgnoreSessionPath("memory/tmp/run/.lock")).toBe(true)
      expect(shouldIgnoreSessionPath("history.jsonl")).toBe(false)
      expect(shouldIgnoreSessionPath("memory/notes.md")).toBe(false)
    }))
})

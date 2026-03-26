// CHANGE: add regression coverage for transient session backup paths
// WHY: `.codex/tmp` contains ephemeral runtime files that should not break snapshot creation
// REF: transient-session-backup-tmp
// PURITY: SHELL (tests filesystem traversal against committed backup script)

import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import sessionBackupGist from "../../../../scripts/session-backup-gist.js"

const { collectSessionFiles, shouldIgnoreSessionPath } = sessionBackupGist

const withTempDir = Effect.acquireRelease(
  Effect.sync(() => fs.mkdtempSync(path.join(os.tmpdir(), "session-backup-gist-"))),
  (tmpDir) =>
    Effect.sync(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    })
)

describe("session-backup-gist transient path filtering", () => {
  it.effect("ignores .codex/tmp while keeping persistent session files", () =>
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

            fs.writeFileSync(path.join(codexDir, "tmp", "run", ".lock"), "lock")
            fs.writeFileSync(path.join(codexDir, "history.jsonl"), "{\"event\":1}\n")
            fs.writeFileSync(path.join(codexDir, "memory", "notes.md"), "# notes\n")
            fs.writeFileSync(path.join(claudeDir, "tmp", "should-stay.txt"), "keep")
          })
        )

        const codexFiles = collectSessionFiles(codexDir, ".codex", false)
        const claudeFiles = collectSessionFiles(claudeDir, ".claude", false)
        const logicalNames = [...codexFiles, ...claudeFiles]
          .map((file) => file.logicalName)
          .toSorted((left, right) => left.localeCompare(right))

        yield* _(
          Effect.sync(() => {
            expect(logicalNames).toContain(".codex/history.jsonl")
            expect(logicalNames).toContain(".codex/memory/notes.md")
            expect(logicalNames).toContain(".claude/tmp/should-stay.txt")
            expect(logicalNames.some((name) => name.startsWith(".codex/tmp/"))).toBe(false)
          })
        )
      })
    ))

  it.effect("marks only targeted transient .codex tmp paths for exclusion", () =>
    Effect.sync(() => {
      expect(shouldIgnoreSessionPath(".codex", "tmp")).toBe(true)
      expect(shouldIgnoreSessionPath(".codex", "tmp/run/.lock")).toBe(true)
      expect(shouldIgnoreSessionPath(".codex", "history.jsonl")).toBe(false)
      expect(shouldIgnoreSessionPath(".claude", "tmp/run/.lock")).toBe(false)
    }))
})

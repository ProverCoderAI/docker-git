import { Effect } from "effect"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"

import { normalizeEnvText } from "./core/env.js"

const ensureEnvFilePath = (
  fs: FileSystem.FileSystem,
  resolved: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function* (_) {
    const exists = yield* _(fs.exists(resolved))
    if (!exists) {
      return
    }

    const info = yield* _(fs.stat(resolved))
    if (info.type === "Directory") {
      const backupPath = `${resolved}.bak-${Date.now()}`
      yield* _(fs.rename(resolved, backupPath))
    }
  })

// CHANGE: read an env file from disk
// WHY: supply the env editor with persisted secrets
// QUOTE(ТЗ): "удобную настройку ENV"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall p: exists(p) -> read(p) = text(p)
// PURITY: SHELL
// EFFECT: Effect<string, PlatformError, FileSystem | Path>
// INVARIANT: missing file yields empty string
// COMPLEXITY: O(n) where n = |file|
export const readEnvFile = (
  filePath: string
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const exists = yield* _(fs.exists(filePath))
    if (!exists) {
      return ""
    }
    return yield* _(fs.readFileString(filePath))
  })

// CHANGE: persist env contents to disk
// WHY: allow UI edits to flow into docker compose env_file
// QUOTE(ТЗ): "удобную настройку ENV"
// REF: user-request-2026-01-09
// SOURCE: n/a
// FORMAT THEOREM: forall s: write(s) -> file(s)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: file ends with newline
// COMPLEXITY: O(n) where n = |env|
export const writeEnvFile = (
  filePath: string,
  contents: string
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* (_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    yield* _(ensureEnvFilePath(fs, filePath))
    yield* _(fs.makeDirectory(path.dirname(filePath), { recursive: true }))
    yield* _(fs.writeFileString(filePath, normalizeEnvText(contents)))
  })

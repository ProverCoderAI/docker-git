import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type { TemplateConfig } from "../core/domain.js"
import { resolvePathFromBase } from "./auth-sync-helpers.js"
import { sanitizeComposeEnvFile } from "./env-file.js"

const formatInvalidLineNumbers = (lineNumbers: ReadonlyArray<number>): string => lineNumbers.join(", ")

const sanitizeTemplateEnvPath = (
  fs: FileSystem.FileSystem,
  envPath: string
): Effect.Effect<void, PlatformError> =>
  sanitizeComposeEnvFile(fs, envPath).pipe(
    Effect.flatMap((invalidLines) =>
      invalidLines.length === 0
        ? Effect.void
        : Effect.logWarning(
          `Sanitized ${envPath} for docker compose by removing invalid lines: ${
            formatInvalidLineNumbers(invalidLines.map((entry) => entry.lineNumber))
          }.`
        )
    )
  )

// CHANGE: sanitize project env files before docker compose consumes them
// WHY: docker compose rejects merge markers and shell-only syntax in env_file inputs
// QUOTE(ТЗ): n/a
// REF: user-request-2026-02-26-invalid-project-env
// SOURCE: n/a
// FORMAT THEOREM: ∀cfg: sanitize(cfg) → compose_safe(env_global(cfg)) ∧ compose_safe(env_project(cfg))
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: only project env files are rewritten; missing files are ignored
// COMPLEXITY: O(n) where n = |env_global| + |env_project|
export const sanitizeTemplateComposeEnvFiles = (
  baseDir: string,
  template: Pick<TemplateConfig, "envGlobalPath" | "envProjectPath">
): Effect.Effect<void, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const globalEnvPath = resolvePathFromBase(path, baseDir, template.envGlobalPath)
    const projectEnvPath = resolvePathFromBase(path, baseDir, template.envProjectPath)

    yield* _(sanitizeTemplateEnvPath(fs, globalEnvPath))
    yield* _(sanitizeTemplateEnvPath(fs, projectEnvPath))
  })

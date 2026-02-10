import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

const stateGitignoreMarker = "# docker-git state repository"

const legacySecretIgnorePatterns: ReadonlyArray<string> = [
  "**/.orch/env/",
  "**/.orch/auth/"
]

const volatileCodexIgnorePatterns: ReadonlyArray<string> = [
  "**/.orch/auth/codex/log/",
  "**/.orch/auth/codex/tmp/",
  "**/.orch/auth/codex/sessions/",
  "**/.orch/auth/codex/models_cache.json"
]

const defaultStateGitignore = [
  stateGitignoreMarker,
  "# NOTE: this repo intentionally tracks EVERYTHING under the state dir, including .orch/env and .orch/auth.",
  "# Keep the remote private; treat it as sensitive infrastructure state.",
  "",
  "# Volatile Codex artifacts (do not commit)",
  ...volatileCodexIgnorePatterns,
  ""
].join("\n")

const normalizeGitignoreText = (text: string): string =>
  text
    .replaceAll("\r\n", "\n")
    .trim()

export const ensureStateGitignore = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  root: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const gitignorePath = path.join(root, ".gitignore")
    const exists = yield* _(fs.exists(gitignorePath))
    if (!exists) {
      yield* _(fs.writeFileString(gitignorePath, defaultStateGitignore))
      return
    }

    const stat = yield* _(fs.stat(gitignorePath))
    if (stat.type !== "File") {
      yield* _(Effect.logWarning(`${gitignorePath} exists but is not a file; skipping`))
      return
    }

    const prev = yield* _(fs.readFileString(gitignorePath))
    const normalized = normalizeGitignoreText(prev)
    if (!normalized.startsWith(stateGitignoreMarker)) {
      return
    }

    // If the file is docker-git managed but still ignores secrets (legacy default), rewrite it.
    const prevLines = new Set(prev.replaceAll("\r", "").split("\n").map((l) => l.trimEnd()))
    const hasLegacySecretIgnores = legacySecretIgnorePatterns.some((p) => prevLines.has(p))
    if (hasLegacySecretIgnores) {
      yield* _(fs.writeFileString(gitignorePath, defaultStateGitignore))
      return
    }

    // Ensure volatile Codex artifacts are ignored; append if missing.
    const missingVolatile = volatileCodexIgnorePatterns.filter((p) => !prevLines.has(p))
    if (missingVolatile.length === 0) {
      return
    }
    const next = `${prev.trimEnd()}\n\n# Volatile Codex artifacts (do not commit)\n${missingVolatile.join("\n")}\n`
    yield* _(fs.writeFileString(gitignorePath, next))
  })

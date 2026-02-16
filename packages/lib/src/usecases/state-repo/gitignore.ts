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

const repositoryCacheIgnorePatterns: ReadonlyArray<string> = [
  ".cache/git-mirrors/"
]

const defaultStateGitignore = [
  stateGitignoreMarker,
  "# NOTE: this repo intentionally tracks EVERYTHING under the state dir, including .orch/env and .orch/auth.",
  "# Keep the remote private; treat it as sensitive infrastructure state.",
  "",
  "# Shared git mirrors cache (do not commit)",
  ...repositoryCacheIgnorePatterns,
  "",
  "# Volatile Codex artifacts (do not commit)",
  ...volatileCodexIgnorePatterns,
  ""
].join("\n")

const normalizeGitignoreText = (text: string): string =>
  text
    .replaceAll("\r\n", "\n")
    .trim()

type MissingManagedPatterns = {
  readonly repositoryCache: ReadonlyArray<string>
  readonly volatileCodex: ReadonlyArray<string>
}

const collectMissingManagedPatterns = (prevLines: ReadonlySet<string>): MissingManagedPatterns => ({
  repositoryCache: repositoryCacheIgnorePatterns.filter((p) => !prevLines.has(p)),
  volatileCodex: volatileCodexIgnorePatterns.filter((p) => !prevLines.has(p))
})

const hasMissingManagedPatterns = (missing: MissingManagedPatterns): boolean =>
  missing.repositoryCache.length > 0 || missing.volatileCodex.length > 0

const appendManagedBlocks = (
  prev: string,
  missing: MissingManagedPatterns
): string => {
  const blocks = [
    missing.repositoryCache.length > 0
      ? `# Shared git mirrors cache (do not commit)\n${missing.repositoryCache.join("\n")}`
      : "",
    missing.volatileCodex.length > 0
      ? `# Volatile Codex artifacts (do not commit)\n${missing.volatileCodex.join("\n")}`
      : ""
  ].filter((block) => block.length > 0)
  return `${[prev.trimEnd(), ...blocks].join("\n\n")}\n`
}

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

    // Ensure managed ignore patterns exist; append any missing entries.
    const missing = collectMissingManagedPatterns(prevLines)
    if (!hasMissingManagedPatterns(missing)) {
      return
    }
    yield* _(fs.writeFileString(gitignorePath, appendManagedBlocks(prev, missing)))
  })

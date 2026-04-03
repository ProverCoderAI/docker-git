import { createHash } from "node:crypto"

import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

export const controllerRevisionEnvKey = "DOCKER_GIT_CONTROLLER_REV"

const controllerRevisionInputs: ReadonlyArray<string> = [
  "docker-compose.yml",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
  "tsconfig.json",
  "patches",
  "scripts",
  "packages/api",
  "packages/lib"
]

const skippedDirectoryNames = new Set([".git", "node_modules", "dist", "dist-test", ".turbo"])
const skippedFileNames = new Set([".DS_Store"])

const hashMissingPath = (hash: ReturnType<typeof createHash>, relativePath: string): void => {
  hash.update(`missing:${relativePath}\n`)
}

const hashDirectoryMarker = (hash: ReturnType<typeof createHash>, relativePath: string): void => {
  hash.update(`dir:${relativePath}\n`)
}

const hashFileContents = (
  hash: ReturnType<typeof createHash>,
  relativePath: string,
  contents: string
): void => {
  hash.update(`file:${relativePath}\n`)
  hash.update(contents)
  hash.update("\n")
}

const hashTree = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  rootDir: string,
  relativePath: string,
  hash: ReturnType<typeof createHash>
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const absolutePath = path.join(rootDir, relativePath)
    const exists = yield* _(fs.exists(absolutePath))
    if (!exists) {
      hashMissingPath(hash, relativePath)
      return
    }

    const info = yield* _(fs.stat(absolutePath))
    if (info.type === "Directory") {
      hashDirectoryMarker(hash, relativePath)
      const entries = (yield* _(fs.readDirectory(absolutePath))).sort((left, right) => left.localeCompare(right))
      for (const entry of entries) {
        if (skippedDirectoryNames.has(entry) || skippedFileNames.has(entry)) {
          continue
        }
        yield* _(hashTree(fs, path, rootDir, path.join(relativePath, entry), hash))
      }
      return
    }

    if (info.type === "File") {
      const contents = yield* _(fs.readFileString(absolutePath))
      hashFileContents(hash, relativePath, contents)
      return
    }

    hash.update(`other:${relativePath}:${info.type}\n`)
  })

export const parseControllerRevisionEnvOutput = (output: string): string | null => {
  const prefix = `${controllerRevisionEnvKey}=`
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith(prefix)) {
      continue
    }
    const revision = trimmed.slice(prefix.length).trim()
    return revision.length > 0 ? revision : null
  }
  return null
}

export const shouldForceRecreateController = (
  controllerExists: boolean,
  localRevision: string,
  currentRevision: string | null
): boolean => controllerExists && currentRevision !== localRevision

// CHANGE: compute a deterministic revision fingerprint for the local controller source
// WHY: host CLI must rebuild the controller when local API/lib sources changed, even if /health still responds
// QUOTE(ТЗ): "я не хочу работать со старой версией"
// REF: user-request-2026-04-03-controller-auto-rebuild
// SOURCE: n/a
// FORMAT THEOREM: ∀s: same_inputs(s) → same_revision(s)
// PURITY: SHELL
// EFFECT: Effect<string, PlatformError, FileSystem | Path>
// INVARIANT: revision changes whenever any tracked controller input changes
// COMPLEXITY: O(total_bytes(inputs))
export const computeLocalControllerRevision = (
  composePath: string
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const repoRoot = path.dirname(composePath)
    const hash = createHash("sha256")

    for (const relativePath of controllerRevisionInputs) {
      yield* _(hashTree(fs, path, repoRoot, relativePath, hash))
    }

    return hash.digest("hex").slice(0, 16)
  })

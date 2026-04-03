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

const appendChunk = (chunks: Array<string>, value: string): void => {
  chunks.push(value)
}

const hashMissingPath = (chunks: Array<string>, relativePath: string): void => {
  appendChunk(chunks, `missing:${relativePath}\n`)
}

const hashDirectoryMarker = (chunks: Array<string>, relativePath: string): void => {
  appendChunk(chunks, `dir:${relativePath}\n`)
}

const hashFileContents = (
  chunks: Array<string>,
  relativePath: string,
  contents: string
): void => {
  appendChunk(chunks, `file:${relativePath}\n`)
  appendChunk(chunks, contents)
  appendChunk(chunks, "\n")
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")

const digestRevision = (chunks: ReadonlyArray<string>): Effect.Effect<string> =>
  Effect.promise(() => crypto.subtle.digest("SHA-256", new TextEncoder().encode(chunks.join("")))).pipe(
    Effect.map((buffer) => bytesToHex(new Uint8Array(buffer)).slice(0, 16))
  )

const hashTree = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  rootDir: string,
  relativePath: string,
  chunks: Array<string>
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const absolutePath = path.join(rootDir, relativePath)
    const exists = yield* _(fs.exists(absolutePath))
    if (!exists) {
      hashMissingPath(chunks, relativePath)
      return
    }

    const info = yield* _(fs.stat(absolutePath))
    if (info.type === "Directory") {
      hashDirectoryMarker(chunks, relativePath)
      const entries = (yield* _(fs.readDirectory(absolutePath))).toSorted((left, right) => left.localeCompare(right))
      for (const entry of entries) {
        if (skippedDirectoryNames.has(entry) || skippedFileNames.has(entry)) {
          continue
        }
        yield* _(hashTree(fs, path, rootDir, path.join(relativePath, entry), chunks))
      }
      return
    }

    if (info.type === "File") {
      const contents = yield* _(fs.readFileString(absolutePath))
      hashFileContents(chunks, relativePath, contents)
      return
    }

    appendChunk(chunks, `other:${relativePath}:${info.type}\n`)
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
    const chunks: Array<string> = []

    for (const relativePath of controllerRevisionInputs) {
      yield* _(hashTree(fs, path, repoRoot, relativePath, chunks))
    }

    return yield* _(digestRevision(chunks))
  })

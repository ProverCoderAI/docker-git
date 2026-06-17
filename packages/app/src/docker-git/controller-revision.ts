import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

export const controllerRevisionEnvKey = "DOCKER_GIT_CONTROLLER_REV"

const controllerRevisionInputs: ReadonlyArray<string> = [
  "docker-compose.yml",
  "docker-compose.api.yml",
  "docker-compose.gpu.yml",
  "docker-compose.isolated.yml",
  "docker-compose.api.isolated.yml",
  ".gitmodules",
  "package.json",
  "bun.lock",
  "bunfig.toml",
  "tsconfig.base.json",
  "tsconfig.json",
  "patches",
  "scripts",
  "packages/api",
  "packages/docker-git-session-sync",
  "packages/lib",
  "third_party/skiller-desktop-skills-manager"
]

const skippedDirectoryNames = new Set([
  ".git",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "dist-test",
  "dist-web",
  "node_modules",
  "out"
])
const skippedFileNames = new Set([".DS_Store", ".git"])

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
    const isExists = yield* _(fs.exists(absolutePath))
    if (!isExists) {
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

// CHANGE: parse the controller image revision label from Docker inspect output
// WHY: bootstrap can skip rebuilding when an existing image already proves the required revision
// QUOTE(ТЗ): "хочу сузить время билда докер контейнера"
// REF: user-request-2026-05-22-controller-build-speed
// SOURCE: n/a
// FORMAT THEOREM: forall output: blank(output) or missing_label(output) -> null
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: non-empty label text is preserved after trimming
// COMPLEXITY: O(n) where n = |output|
/**
 * Parses the docker-git controller revision label emitted by `docker image inspect`.
 *
 * @param output - Raw Go-template output from Docker.
 * @returns Trimmed revision string, or null when the label is absent.
 *
 * @pure true
 * @effect n/a
 * @invariant Blank and Docker `<no value>` outputs are treated as missing labels.
 * @precondition `output` is a finite string.
 * @postcondition Non-empty revision text is returned without surrounding whitespace.
 * @complexity O(n) time and O(n) space where n = |output|.
 * @throws Never
 */
export const parseControllerRevisionLabelOutput = (output: string): string | null => {
  const revision = output.trim()
  return revision.length === 0 || revision === "<no value>" ? null : revision
}

export const shouldForceRecreateController = (
  hasController: boolean,
  localRevision: string,
  currentRevision: string | null
): boolean => hasController && currentRevision !== localRevision

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
// CHANGE: share deterministic source fingerprinting between controller and browser runtimes
// WHY: selective restarts require comparable revision proofs for independent runtime parts
// QUOTE(ТЗ): "Надо перезапускать только те контейнеры у которых изменился код"
// REF: user-message-2026-04-21-browser-selective-restart
// SOURCE: n/a
// FORMAT THEOREM: forall inputs: same_tree(root, inputs) -> same_revision(root, inputs)
// PURITY: SHELL
// EFFECT: Effect<string, PlatformError, FileSystem | Path>
// INVARIANT: tracked missing paths, file bytes, directory markers and sorted entries fully determine the revision
// COMPLEXITY: O(total_bytes(inputs))
export const computeRevisionFromInputs = (
  rootDir: string,
  inputs: ReadonlyArray<string>
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const chunks: Array<string> = []

    for (const relativePath of inputs) {
      yield* _(hashTree(fs, path, rootDir, relativePath, chunks))
    }

    return yield* _(digestRevision(chunks))
  })

export const computeLocalControllerRevision = (
  composePath: string
): Effect.Effect<string, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    return yield* _(computeRevisionFromInputs(path.dirname(composePath), controllerRevisionInputs))
  })

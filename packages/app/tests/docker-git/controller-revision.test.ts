import { SystemError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { describe, expect, it } from "@effect/vitest"
import { Effect, Option } from "effect"
import * as fc from "fast-check"

import { computeRevisionFromInputs } from "../../src/docker-git/controller-revision.js"

const ignoredControllerRevisionEntries: ReadonlyArray<string> = [
  ".git",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "dist-test",
  "dist-web",
  "node_modules",
  "out"
]
const ignoredControllerRevisionEntrySubsetArbitrary = fc.uniqueArray(
  fc.constantFrom(...ignoredControllerRevisionEntries),
  { maxLength: ignoredControllerRevisionEntries.length, minLength: 1 }
)
const revisionFileContentsArbitrary = fc.string({ maxLength: 256 })
const changedTrackedFileContentsArbitrary = fc
  .tuple(revisionFileContentsArbitrary, revisionFileContentsArbitrary)
  .filter(([left, right]) => left !== right)
const memoryRootDir = "/memory"
const memoryRevisionInput = "src"
const memoryTrackedFileName = "tracked.ts"

type MemoryFileEntry =
  | { readonly _tag: "Directory" }
  | { readonly _tag: "File"; readonly contents: string }

const normalizeMemoryPath = (value: string): string => {
  const normalized = value.replaceAll(/\/+/gu, "/").replace(/\/$/u, "")
  return normalized.length === 0 ? "/" : normalized
}

const memoryFileInfo = (entry: MemoryFileEntry): FileSystem.File.Info => ({
  atime: Option.none(),
  birthtime: Option.none(),
  blksize: Option.none(),
  blocks: Option.none(),
  dev: 0,
  gid: Option.none(),
  ino: Option.none(),
  mode: 0,
  mtime: Option.none(),
  nlink: Option.none(),
  rdev: Option.none(),
  size: FileSystem.Size(entry._tag === "File" ? entry.contents.length : 0),
  type: entry._tag === "Directory" ? "Directory" : "File",
  uid: Option.none()
})

/**
 * Builds a typed FileSystem error for the in-memory test filesystem.
 *
 * @param method - FileSystem method name that observed the invalid path.
 * @param requestedPath - Normalized memory path associated with the failure.
 * @param reason - Platform filesystem reason reported by the mock.
 * @param description - Human-readable failure description.
 * @returns Platform SystemError compatible with FileSystem effects.
 * @pure true
 * @effect none
 * @invariant The produced error is always scoped to the FileSystem module.
 * @precondition `method`, `requestedPath`, and `description` are finite strings.
 * @postcondition The returned error preserves the failing path in `pathOrDescriptor`.
 * @complexity O(1) time and space.
 * @throws Never
 */
const memoryFileSystemError = (
  method: string,
  requestedPath: string,
  reason: "BadResource" | "NotFound",
  description: string
): SystemError =>
  new SystemError({
    description,
    method,
    module: "FileSystem",
    pathOrDescriptor: requestedPath,
    reason
  })

/**
 * Looks up an in-memory file entry with real FileSystem missing-path semantics.
 *
 * @param entries - Current memory filesystem entries.
 * @param requestedPath - Path requested by the FileSystem operation.
 * @param method - FileSystem method name for typed error reporting.
 * @returns Effect that succeeds with the entry or fails when the path is absent.
 * @pure true
 * @effect Effect.fail or Effect.succeed
 * @invariant Missing paths are represented as typed NotFound failures.
 * @precondition `requestedPath` is a finite path string.
 * @postcondition Success implies the normalized path exists in `entries`.
 * @complexity O(p) time and O(p) space where p = |requestedPath|.
 * @throws Never
 */
const requireMemoryEntry = (
  entries: ReadonlyMap<string, MemoryFileEntry>,
  requestedPath: string,
  method: string
): Effect.Effect<MemoryFileEntry, SystemError> => {
  const normalized = normalizeMemoryPath(requestedPath)
  const entry = entries.get(normalized)
  return entry === undefined
    ? Effect.fail(memoryFileSystemError(method, normalized, "NotFound", "Missing memory filesystem entry."))
    : Effect.succeed(entry)
}

const createMemoryFileSystemLayer = () => {
  let entries = new Map<string, MemoryFileEntry>([
    ["/memory", { _tag: "Directory" }]
  ])

  return FileSystem.layerNoop({
    exists: (path) => Effect.sync(() => entries.has(normalizeMemoryPath(path))),
    makeDirectory: (path) =>
      Effect.sync(() => {
        entries = new Map(entries).set(normalizeMemoryPath(path), { _tag: "Directory" })
      }),
    readDirectory: (path) =>
      Effect.gen(function*(_) {
        const directory = normalizeMemoryPath(path)
        const entry = yield* _(requireMemoryEntry(entries, directory, "readDirectory"))
        if (entry._tag !== "Directory") {
          return yield* _(
            Effect.fail(
              memoryFileSystemError("readDirectory", directory, "BadResource", "Memory entry is not a directory.")
            )
          )
        }
        const prefix = directory === "/" ? "/" : `${directory}/`
        const names = new Set<string>()
        for (const candidate of entries.keys()) {
          if (candidate === directory || !candidate.startsWith(prefix)) {
            continue
          }
          const name = candidate.slice(prefix.length).split("/", 1)[0]
          if (name !== undefined && name.length > 0) {
            names.add(name)
          }
        }
        return [...names]
      }),
    readFileString: (path) =>
      Effect.gen(function*(_) {
        const normalized = normalizeMemoryPath(path)
        const entry = yield* _(requireMemoryEntry(entries, normalized, "readFileString"))
        return entry._tag === "File"
          ? entry.contents
          : yield* _(
            Effect.fail(
              memoryFileSystemError("readFileString", normalized, "BadResource", "Memory entry is not a file.")
            )
          )
      }),
    stat: (path) => requireMemoryEntry(entries, path, "stat").pipe(Effect.map((entry) => memoryFileInfo(entry))),
    writeFileString: (path, contents) =>
      Effect.sync(() => {
        entries = new Map(entries).set(normalizeMemoryPath(path), { _tag: "File", contents })
      })
  })
}

/**
 * Runs an asynchronous fast-check property inside Effect-based tests.
 *
 * @param property - Async property whose cases return Promises from Effect programs.
 * @returns Effect that fails if fast-check finds a counterexample.
 * @pure false
 * @effect Effect.tryPromise, fc.assert
 * @invariant A returned success proves every sampled property case passed.
 * @precondition The property is finite and does not share mutable memory filesystem state across cases.
 * @postcondition Counterexamples are surfaced as typed Effect failures.
 * @complexity O(r * c) time where r is numRuns and c is property case cost.
 * @throws Never
 */
const assertControllerRevisionProperty = <PropertyArgs>(property: fc.IAsyncProperty<PropertyArgs>) =>
  Effect.tryPromise({
    catch: (cause) => cause,
    try: () => fc.assert(property, { numRuns: 50 })
  })

/**
 * Writes the tracked memory source tree shared by controller revision properties.
 *
 * @param trackedContents - Contents written to the tracked source file.
 * @returns Effect producing the root and source directory paths.
 * @pure false
 * @effect FileSystem.FileSystem, Path.Path
 * @invariant The same tracked file path is created for every property case.
 * @precondition `trackedContents` is a finite string.
 * @postcondition `src/tracked.ts` exists in the fresh memory filesystem.
 * @complexity O(n) time and space where n = trackedContents.length.
 * @throws Never
 */
const writeTrackedMemoryRevisionSource = (trackedContents: string) =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const sourceDir = path.join(memoryRootDir, memoryRevisionInput)
    yield* _(fs.makeDirectory(sourceDir, { recursive: true }))
    yield* _(fs.writeFileString(path.join(sourceDir, memoryTrackedFileName), trackedContents))
    return { rootDir: memoryRootDir, sourceDir }
  })

/**
 * Computes a controller revision for a memory-backed source tree with one tracked file.
 *
 * @param trackedContents - Contents written to `src/tracked.ts`.
 * @returns Effect producing the revision for the generated in-memory tree.
 * @pure false
 * @effect FileSystem.FileSystem, Path.Path, WebCrypto digest through computeRevisionFromInputs.
 * @invariant Equal tracked contents produce equal revisions for the fixed tree.
 * @precondition `trackedContents` is a finite string.
 * @postcondition The in-memory filesystem layer is fresh for the call.
 * @complexity O(n) time and space where n = trackedContents.length.
 * @throws Never
 */
const computeMemoryRevisionForTrackedContents = (trackedContents: string) =>
  Effect.gen(function*(_) {
    const { rootDir } = yield* _(writeTrackedMemoryRevisionSource(trackedContents))
    return yield* _(computeRevisionFromInputs(rootDir, [memoryRevisionInput]))
  }).pipe(
    Effect.provide(createMemoryFileSystemLayer()),
    Effect.provide(Path.layer)
  )

describe("controller revisions", () => {
  it.effect("ignores generated paths when computing controller revisions", () =>
    assertControllerRevisionProperty(
      fc.asyncProperty(
        revisionFileContentsArbitrary,
        ignoredControllerRevisionEntrySubsetArbitrary,
        revisionFileContentsArbitrary,
        (trackedContents, ignoredEntries, generatedContents) => {
          const memoryFileSystemLayer = createMemoryFileSystemLayer()
          return Effect.runPromise(
            Effect.gen(function*(_) {
              const fs = yield* _(FileSystem.FileSystem)
              const path = yield* _(Path.Path)
              const { rootDir, sourceDir } = yield* _(writeTrackedMemoryRevisionSource(trackedContents))

              const before = yield* _(computeRevisionFromInputs(rootDir, [memoryRevisionInput]))

              for (const entry of ignoredEntries) {
                yield* _(fs.makeDirectory(path.join(sourceDir, entry), { recursive: true }))
                yield* _(fs.writeFileString(path.join(sourceDir, entry, "generated.txt"), generatedContents))
              }

              const after = yield* _(computeRevisionFromInputs(rootDir, [memoryRevisionInput]))
              expect(after).toBe(before)
            }).pipe(
              Effect.provide(memoryFileSystemLayer),
              Effect.provide(Path.layer)
            )
          )
        }
      )
    ))

  it.effect("changes controller revisions when tracked source changes", () =>
    assertControllerRevisionProperty(
      fc.asyncProperty(changedTrackedFileContentsArbitrary, ([initialContents, changedContents]) =>
        Effect.runPromise(
          Effect.gen(function*(_) {
            const initialRevision = yield* _(computeMemoryRevisionForTrackedContents(initialContents))
            const changedRevision = yield* _(computeMemoryRevisionForTrackedContents(changedContents))

            expect(changedRevision).not.toBe(initialRevision)
          })
        ))
    ))
})

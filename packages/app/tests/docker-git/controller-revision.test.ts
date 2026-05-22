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
      Effect.sync(() => {
        const directory = normalizeMemoryPath(path)
        const prefix = directory === "/" ? "/" : `${directory}/`
        const names = new Set<string>()
        for (const candidate of entries.keys()) {
          if (candidate === directory || !candidate.startsWith(prefix)) {
            continue
          }
          const name = candidate.slice(prefix.length).split("/")[0]
          if (name !== undefined && name.length > 0) {
            names.add(name)
          }
        }
        return [...names]
      }),
    readFileString: (path) =>
      Effect.sync(() => {
        const entry = entries.get(normalizeMemoryPath(path))
        return entry?._tag === "File" ? entry.contents : ""
      }),
    stat: (path) => Effect.sync(() => memoryFileInfo(entries.get(normalizeMemoryPath(path)) ?? { _tag: "Directory" })),
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
        (trackedContents, ignoredEntries, generatedContents) =>
          Effect.runPromise(
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
              Effect.provide(createMemoryFileSystemLayer()),
              Effect.provide(Path.layer)
            )
          )
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

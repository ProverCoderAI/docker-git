import type { PlatformError } from "@effect/platform/Error"
import type { FileSystem as Fs } from "@effect/platform/FileSystem"
import type { Path as PathService } from "@effect/platform/Path"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { Effect, Either } from "effect"

import type { ScrapArchiveInvalidError } from "../shell/errors.js"
import { ScrapArchiveInvalidError as ScrapArchiveInvalidErrorClass } from "../shell/errors.js"

export const maxGitBlobBytes = 99 * 1000 * 1000
export const chunkManifestSuffix = ".chunks.json"

export type ChunkManifest = {
  readonly original: string
  readonly originalSize: number
  readonly parts: ReadonlyArray<string>
  readonly splitAt: number
  readonly partsCount: number
  readonly createdAt: string
}

const ChunkManifestSchema = Schema.Struct({
  original: Schema.String,
  originalSize: Schema.Number,
  parts: Schema.Array(Schema.String),
  splitAt: Schema.Number,
  partsCount: Schema.Number,
  createdAt: Schema.String
})

const ChunkManifestJsonSchema = Schema.parseJson(ChunkManifestSchema)

export const decodeChunkManifest = (
  manifestPath: string,
  input: string
): Effect.Effect<ChunkManifest, ScrapArchiveInvalidError> =>
  Either.match(ParseResult.decodeUnknownEither(ChunkManifestJsonSchema)(input), {
    onLeft: (issue) =>
      Effect.fail(
        new ScrapArchiveInvalidErrorClass({
          path: manifestPath,
          message: TreeFormatter.formatIssueSync(issue)
        })
      ),
    onRight: (value) => Effect.succeed(value)
  })

export const removeChunkArtifacts = (
  fs: Fs,
  path: PathService,
  fileAbs: string
): Effect.Effect<void, PlatformError> =>
  Effect.gen(function*(_) {
    const dir = path.dirname(fileAbs)
    const base = path.basename(fileAbs)
    const entries = yield* _(fs.readDirectory(dir))
    for (const entry of entries) {
      if (!entry.startsWith(`${base}.part`)) {
        continue
      }
      yield* _(fs.remove(path.join(dir, entry), { force: true }))
    }
    yield* _(fs.remove(`${fileAbs}${chunkManifestSuffix}`, { force: true }))
  }).pipe(Effect.asVoid)

export const listChunkParts = (
  fs: Fs,
  path: PathService,
  fileAbs: string
): Effect.Effect<ReadonlyArray<string>, PlatformError> =>
  Effect.gen(function*(_) {
    const dir = path.dirname(fileAbs)
    const base = path.basename(fileAbs)
    const entries = yield* _(fs.readDirectory(dir))
    const parts = entries
      .filter((entry) => entry.startsWith(`${base}.part`))
      .toSorted((a, b) => a.localeCompare(b))
    return parts.map((entry) => path.join(dir, entry))
  })

export const sumFileSizes = (
  fs: Fs,
  filesAbs: ReadonlyArray<string>
): Effect.Effect<number, PlatformError> =>
  Effect.gen(function*(_) {
    let total = 0
    for (const fileAbs of filesAbs) {
      const stat = yield* _(fs.stat(fileAbs))
      if (stat.type === "File") {
        total += Number(stat.size)
      }
    }
    return total
  })

export const writeChunkManifest = (
  fs: Fs,
  path: PathService,
  fileAbs: string,
  originalSize: number,
  partsAbs: ReadonlyArray<string>
): Effect.Effect<string, PlatformError> =>
  Effect.gen(function*(_) {
    const base = path.basename(fileAbs)
    const manifest: ChunkManifest = {
      original: base,
      originalSize,
      parts: partsAbs.map((part) => path.basename(part)),
      splitAt: maxGitBlobBytes,
      partsCount: partsAbs.length,
      createdAt: new Date().toISOString()
    }
    const manifestPath = `${fileAbs}${chunkManifestSuffix}`
    yield* _(fs.writeFileString(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`))
    return manifestPath
  })

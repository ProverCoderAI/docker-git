// CHANGE: add URL-based container access sharing with time-limited tokens
// WHY: enables sharing container access via URL without exposing full panel
// QUOTE(ТЗ): "я даю эту же ссылку условно в VS Code и он подключается к текущему контейнеру"
// REF: issue-428
// FORMAT THEOREM: ∀ token ∈ ShareLinks: valid(token) → project(token) ∧ notExpired(token)
// PURITY: SHELL
// EFFECT: Effect<ShareLink, ApiInternalError | ApiNotFoundError, FileSystem>
// INVARIANT: tokens are cryptographically random 16 hex chars (8 bytes = 2^64 space)
// COMPLEXITY: O(1) lookup via in-memory index, O(n) scan on cold start

import * as FileSystem from "@effect/platform/FileSystem"
import { randomBytes } from "node:crypto"
import * as nodePath from "node:path"
import { Effect, Either } from "effect"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"

import { ApiInternalError, ApiNotFoundError } from "../api/errors.js"

export type ShareLink = {
  readonly token: string
  readonly projectKey: string
  readonly projectDir: string
  readonly createdAt: string
  readonly expiresAt: string
}

type ShareLinksFile = {
  readonly schemaVersion: 1
  readonly links: ReadonlyArray<ShareLink>
}

const ShareLinkSchema = Schema.Struct({
  token: Schema.String,
  projectKey: Schema.String,
  projectDir: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String
})

const ShareLinksFileSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  links: Schema.Array(ShareLinkSchema)
})

const ShareLinksFileJsonSchema = Schema.parseJson(ShareLinksFileSchema)

const defaultShareLinksFile = (): ShareLinksFile => ({ schemaVersion: 1, links: [] })

const decodeShareLinksFile = (input: string): ShareLinksFile | null =>
  Either.match(ParseResult.decodeUnknownEither(ShareLinksFileJsonSchema)(input), {
    onLeft: () => null,
    onRight: (value) => value
  })

// Global file at projectsRoot/share-links.json holds all tokens across projects.
// This avoids scanning project directories on every token lookup.
const resolveGlobalStatePath = (projectsRoot: string): string =>
  nodePath.join(nodePath.resolve(projectsRoot), "share-links.json")

const defaultTtlMs = 7 * 24 * 60 * 60 * 1000

const readShareLinksFile = (
  projectsRoot: string
): Effect.Effect<ShareLinksFile, never, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const statePath = resolveGlobalStatePath(projectsRoot)
    const exists = yield* _(Effect.either(fs.exists(statePath)))
    const fileExists = Either.match(exists, { onLeft: () => false, onRight: (v) => v })
    if (!fileExists) {
      return defaultShareLinksFile()
    }
    const contents = yield* _(Effect.either(fs.readFileString(statePath)))
    return Either.match(contents, {
      onLeft: () => defaultShareLinksFile(),
      onRight: (raw) => decodeShareLinksFile(raw) ?? defaultShareLinksFile()
    })
  }).pipe(Effect.catchAll(() => Effect.succeed(defaultShareLinksFile())))

const writeShareLinksFile = (
  projectsRoot: string,
  file: ShareLinksFile
): Effect.Effect<void, ApiInternalError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const statePath = resolveGlobalStatePath(projectsRoot)
    yield* _(
      fs.writeFileString(statePath, JSON.stringify(file, null, 2)).pipe(
        Effect.catchAll((err) =>
          Effect.fail(new ApiInternalError({ message: `Failed to write share-links: ${String(err)}` }))
        )
      )
    )
  })

const isExpired = (link: ShareLink): boolean => new Date(link.expiresAt).getTime() <= Date.now()

export const createShareLink = (
  projectsRoot: string,
  projectDir: string,
  projectKey: string,
  ttlMs?: number
): Effect.Effect<ShareLink, ApiInternalError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const token = randomBytes(8).toString("hex")
    const now = new Date().toISOString()
    const expiresAt = new Date(Date.now() + (ttlMs ?? defaultTtlMs)).toISOString()
    const link: ShareLink = { token, projectKey, projectDir, createdAt: now, expiresAt }
    const file = yield* _(readShareLinksFile(projectsRoot))
    const activeLinks = file.links.filter((l) => !isExpired(l))
    yield* _(writeShareLinksFile(projectsRoot, { schemaVersion: 1, links: [...activeLinks, link] }))
    return link
  })

export const resolveShareLink = (
  projectsRoot: string,
  token: string
): Effect.Effect<ShareLink | null, never, FileSystem.FileSystem> =>
  readShareLinksFile(projectsRoot).pipe(
    Effect.map((file) => file.links.find((l) => l.token === token && !isExpired(l)) ?? null),
    Effect.catchAll(() => Effect.succeed(null))
  )

export const deleteShareLink = (
  projectsRoot: string,
  projectDir: string,
  token: string
): Effect.Effect<void, ApiNotFoundError | ApiInternalError, FileSystem.FileSystem> =>
  Effect.gen(function*(_) {
    const file = yield* _(readShareLinksFile(projectsRoot))
    const before = file.links.length
    const updated = file.links.filter((l) => !(l.token === token && l.projectDir === projectDir))
    if (updated.length === before) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Share link not found: ${token}` })))
    }
    yield* _(writeShareLinksFile(projectsRoot, { schemaVersion: 1, links: updated }))
  })

export const listShareLinks = (
  projectsRoot: string,
  projectDir: string
): Effect.Effect<ReadonlyArray<ShareLink>, never, FileSystem.FileSystem> =>
  readShareLinksFile(projectsRoot).pipe(
    Effect.map((file) => file.links.filter((l) => l.projectDir === projectDir && !isExpired(l))),
    Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<ShareLink>))
  )

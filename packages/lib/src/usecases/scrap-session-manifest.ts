import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { Effect, Either } from "effect"

import type { ScrapArchiveInvalidError } from "../shell/errors.js"
import { ScrapArchiveInvalidError as ScrapArchiveInvalidErrorClass } from "../shell/errors.js"

export type SessionManifest = {
  readonly schemaVersion: 1
  readonly mode: "session"
  readonly snapshotId: string
  readonly createdAtUtc: string
  readonly repo: {
    readonly originUrl: string
    readonly head: string
    readonly branch: string
  }
  readonly artifacts: {
    readonly worktreePatchChunks: string
    readonly codexChunks: string
    readonly codexSharedChunks: string
  }
}

const SessionManifestSchema = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  mode: Schema.Literal("session"),
  snapshotId: Schema.String,
  createdAtUtc: Schema.String,
  repo: Schema.Struct({
    originUrl: Schema.String,
    head: Schema.String,
    branch: Schema.String
  }),
  artifacts: Schema.Struct({
    worktreePatchChunks: Schema.String,
    codexChunks: Schema.String,
    codexSharedChunks: Schema.String
  })
})

const SessionManifestJsonSchema = Schema.parseJson(SessionManifestSchema)

export const decodeSessionManifest = (
  manifestPath: string,
  input: string
): Effect.Effect<SessionManifest, ScrapArchiveInvalidError> =>
  Either.match(ParseResult.decodeUnknownEither(SessionManifestJsonSchema)(input), {
    onLeft: (issue) =>
      Effect.fail(
        new ScrapArchiveInvalidErrorClass({
          path: manifestPath,
          message: TreeFormatter.formatIssueSync(issue)
        })
      ),
    onRight: (value) => Effect.succeed(value)
  })

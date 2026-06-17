import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Either } from "effect"

import type { PrCommentContext, SessionUploadContext } from "./backup.js"
import type { PrComment, TreeEntry } from "./types.js"

const NullableString = Schema.NullOr(Schema.String)
const NullableNumber = Schema.NullOr(Schema.Number)

const SourceInfoSchema = Schema.Struct({
  repo: Schema.String,
  branch: Schema.String,
  prNumber: NullableNumber,
  commitSha: Schema.String,
  createdAt: Schema.String
})

const PrCommentSchema: Schema.Schema<PrComment> = Schema.Struct({
  id: Schema.Number,
  url: Schema.String
})

const PrCommentContextSchema: Schema.Schema<PrCommentContext> = Schema.Struct({
  repo: Schema.String,
  comment: PrCommentSchema
})

const SessionUploadContextSchema: Schema.Schema<SessionUploadContext> = Schema.Struct({
  version: Schema.Literal(1),
  cwd: Schema.String,
  sessionDir: NullableString,
  source: SourceInfoSchema,
  snapshotRef: Schema.String,
  gitStatus: NullableString,
  prComment: Schema.NullOr(PrCommentContextSchema),
  verbose: Schema.Boolean
})

const BackgroundReadyStateSchema = Schema.Union(
  Schema.Struct({
    state: Schema.Literal("started")
  }),
  Schema.Struct({
    state: Schema.Literal("failed"),
    message: Schema.String
  })
)

export type BackgroundReadyState = Schema.Schema.Type<typeof BackgroundReadyStateSchema>

const GitHubRepoInfoSchema = Schema.Struct({
  default_branch: Schema.optional(Schema.NullOr(Schema.String)),
  html_url: Schema.optional(Schema.NullOr(Schema.String))
})

export type GitHubRepoInfo = {
  readonly defaultBranch: string | null
  readonly htmlUrl: string | null
}

const GitHubPrCommentResponseSchema = Schema.Struct({
  id: Schema.Number,
  html_url: Schema.String
})

const GitHubContentResponseSchema = Schema.Struct({
  encoding: Schema.String,
  content: Schema.String
})

export type GitHubContentResponse = Schema.Schema.Type<typeof GitHubContentResponseSchema>

const GitHubShaResponseSchema = Schema.Struct({
  sha: Schema.String
})

const TreeEntrySchema: Schema.Schema<TreeEntry> = Schema.Struct({
  path: Schema.String,
  mode: Schema.String,
  type: Schema.String,
  sha: Schema.String
})

const GitHubTreeResponseSchema = Schema.Struct({
  tree: Schema.Array(Schema.Unknown)
})

// CHANGE: Decode background upload context at the JSON boundary with @effect/schema.
// WHY: Once decoded, upload code receives a typed context instead of ad hoc unknown field probes.
// QUOTE(ТЗ): "заменить самые явные try/catch/unknown JSON boundaries на typed Schema декодирование"
// REF: user-request-2026-06-17-effect-compliance-session-sync
// SOURCE: n/a
// FORMAT THEOREM: decode(x)=ctx -> ctx.version=1 ∧ ctx.source.repo∈String ∧ ctx.verbose∈Boolean
// PURITY: SHELL
// EFFECT: none
// INVARIANT: invalid or incomplete context decodes to null.
// COMPLEXITY: O(n)/O(n), where n is encoded field count.
export const decodeSessionUploadContext = (value: unknown): SessionUploadContext | null =>
  Either.match(ParseResult.decodeUnknownEither(SessionUploadContextSchema)(value), {
    onLeft: () => null,
    onRight: (context) => context
  })

export const decodeBackgroundReadyState = (value: unknown): BackgroundReadyState | null =>
  Either.match(ParseResult.decodeUnknownEither(BackgroundReadyStateSchema)(value), {
    onLeft: () => null,
    onRight: (state) => state
  })

export const decodeGitHubRepoInfo = (value: unknown): GitHubRepoInfo | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubRepoInfoSchema)(value), {
    onLeft: () => null,
    onRight: (repo) => ({
      defaultBranch: repo.default_branch ?? null,
      htmlUrl: repo.html_url ?? null
    })
  })

export const decodeGitHubPrComment = (value: unknown): PrComment | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubPrCommentResponseSchema)(value), {
    onLeft: () => null,
    onRight: (comment) => ({
      id: comment.id,
      url: comment.html_url
    })
  })

export const decodeGitHubContentResponse = (value: unknown): GitHubContentResponse | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubContentResponseSchema)(value), {
    onLeft: () => null,
    onRight: (content) => content
  })

export const decodeGitHubSha = (value: unknown): string | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubShaResponseSchema)(value), {
    onLeft: () => null,
    onRight: (response) => response.sha
  })

const decodeTreeEntry = (value: unknown): TreeEntry | null =>
  Either.match(ParseResult.decodeUnknownEither(TreeEntrySchema)(value), {
    onLeft: () => null,
    onRight: (entry) => entry
  })

export const decodeGitHubTreeEntries = (value: unknown): ReadonlyArray<TreeEntry> =>
  Either.match(ParseResult.decodeUnknownEither(GitHubTreeResponseSchema)(value), {
    onLeft: () => [],
    onRight: (response) =>
      response.tree.flatMap((entry) => {
        const decoded = decodeTreeEntry(entry)
        return decoded === null ? [] : [decoded]
      })
  })

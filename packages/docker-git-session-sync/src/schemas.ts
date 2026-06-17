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
  encoding: Schema.Literal("base64"),
  content: Schema.String
})

export type GitHubContentResponse = Schema.Schema.Type<typeof GitHubContentResponseSchema>

const GitHubShaSchema = Schema.String.pipe(
  Schema.pattern(/^[0-9a-f]{40}$/iu)
)

const GitHubShaResponseSchema = Schema.Struct({
  sha: GitHubShaSchema
})

const TreeEntrySchema: Schema.Schema<TreeEntry> = Schema.Struct({
  path: Schema.String,
  mode: Schema.String,
  type: Schema.String,
  sha: Schema.String
})

type GitHubTreeResponse = {
  readonly tree: ReadonlyArray<TreeEntry>
}

const GitHubTreeResponseSchema: Schema.Schema<GitHubTreeResponse> = Schema.Struct({
  tree: Schema.Array(TreeEntrySchema)
})

/**
 * Decodes persisted background upload context at the JSON boundary.
 *
 * @param value - Unknown JSON value read from the upload context file.
 * @returns A typed session upload context, or null when required fields are invalid.
 * @pure false - boundary decoder for persisted JSON.
 * @effect none - synchronous schema decode only.
 * @invariant decode(x)=ctx -> ctx.version=1 and ctx.verbose is boolean.
 * @precondition value may be any JSON-compatible value.
 * @postcondition returned contexts preserve source, snapshotRef, gitStatus, and PR comment metadata.
 * @complexity O(n) time / O(n) space where n is the encoded field count.
 */
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

/**
 * Decodes the child-process readiness handshake payload.
 *
 * @param value - Unknown JSON value read from the readiness file.
 * @returns A typed readiness state, or null when the payload violates the schema.
 * @pure false - boundary decoder for JSON produced by another process.
 * @effect none - synchronous schema decode only.
 * @invariant decode(valid started|failed state) != null; decode(invalid) = null.
 * @precondition value may be any JSON-compatible value.
 * @postcondition returned failed states always carry a string message.
 * @complexity O(n) time / O(n) space where n is the decoded field count.
 */
export const decodeBackgroundReadyState = (value: unknown): BackgroundReadyState | null =>
  Either.match(ParseResult.decodeUnknownEither(BackgroundReadyStateSchema)(value), {
    onLeft: () => null,
    onRight: (state) => state
  })

/**
 * Decodes GitHub repository metadata used by the backup repository resolver.
 *
 * @param value - Unknown GitHub repository API response.
 * @returns Normalized repository info, or null when the response shape is invalid.
 * @pure false - boundary decoder for GitHub API JSON.
 * @effect none - synchronous schema decode only.
 * @invariant missing nullable fields normalize to null; invalid objects decode to null.
 * @precondition value may be any GitHub API JSON response.
 * @postcondition defaultBranch and htmlUrl are either strings or null.
 * @complexity O(n) time / O(n) space where n is the decoded field count.
 */
export const decodeGitHubRepoInfo = (value: unknown): GitHubRepoInfo | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubRepoInfoSchema)(value), {
    onLeft: () => null,
    onRight: (repo) => ({
      defaultBranch: repo.default_branch ?? null,
      htmlUrl: repo.html_url ?? null
    })
  })

/**
 * Decodes GitHub issue-comment creation responses into the internal PR comment type.
 *
 * @param value - Unknown GitHub issue comment API response.
 * @returns A typed PR comment reference, or null when the response shape is invalid.
 * @pure false - boundary decoder for GitHub API JSON.
 * @effect none - synchronous schema decode only.
 * @invariant decode(valid response) preserves id and html_url as id and url.
 * @precondition value may be any GitHub API JSON response.
 * @postcondition returned comments always contain a numeric id and URL string.
 * @complexity O(n) time / O(n) space where n is the decoded field count.
 */
export const decodeGitHubPrComment = (value: unknown): PrComment | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubPrCommentResponseSchema)(value), {
    onLeft: () => null,
    onRight: (comment) => ({
      id: comment.id,
      url: comment.html_url
    })
  })

/**
 * Decodes GitHub file-content responses that are contractually base64 encoded.
 *
 * @param value - Unknown GitHub contents API response.
 * @returns A base64 content response, or null when encoding/content are invalid.
 * @pure false - boundary decoder for GitHub API JSON.
 * @effect none - synchronous schema decode only.
 * @invariant decode(value) != null -> value.encoding = "base64".
 * @precondition value may be any GitHub API JSON response.
 * @postcondition returned content is a string and may be empty for empty files.
 * @complexity O(n) time / O(n) space where n is the decoded field count.
 */
export const decodeGitHubContentResponse = (value: unknown): GitHubContentResponse | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubContentResponseSchema)(value), {
    onLeft: () => null,
    onRight: (content) => content
  })

/**
 * Decodes GitHub object SHA responses and fails fast on contract violations.
 *
 * @param value - Unknown GitHub API response containing a sha field.
 * @param context - Human-readable GitHub operation context for parse errors.
 * @returns A 40-character hexadecimal Git object SHA.
 * @pure false - boundary decoder for GitHub API JSON.
 * @effect throws Error when the GitHub response is missing or has an invalid SHA.
 * @invariant returned sha matches /^[0-9a-f]{40}$/i.
 * @precondition value may be any GitHub API JSON response.
 * @postcondition callers never receive null or malformed SHAs.
 * @complexity O(n) time / O(n) space where n is the decoded field count.
 */
export const decodeGitHubSha = (value: unknown, context: string = "GitHub response"): string =>
  Either.match(ParseResult.decodeUnknownEither(GitHubShaResponseSchema)(value), {
    onLeft: () => {
      throw new Error(`${context} missing valid sha`)
    },
    onRight: (response) => response.sha
  })

/**
 * Decodes GitHub recursive tree responses without silently dropping invalid entries.
 *
 * @param value - Unknown GitHub tree API response.
 * @returns A readonly collection of tree entries, or null when the response is invalid.
 * @pure false - boundary decoder for GitHub API JSON.
 * @effect none - synchronous schema decode only.
 * @invariant invalid tree payloads decode to null, never to [].
 * @precondition value may be any GitHub API JSON response.
 * @postcondition every returned entry contains path, mode, type, and sha strings.
 * @complexity O(n) time / O(n) space where n is the number of tree entries.
 */
export const decodeGitHubTreeEntries = (value: unknown): ReadonlyArray<TreeEntry> | null =>
  Either.match(ParseResult.decodeUnknownEither(GitHubTreeResponseSchema)(value), {
    onLeft: () => null,
    onRight: (response) => response.tree
  })

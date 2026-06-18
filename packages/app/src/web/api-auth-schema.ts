import * as Schema from "@effect/schema/Schema"

import { NullableString } from "./api-project-schema.js"

export const GithubTokenStatusSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  login: NullableString,
  status: Schema.Union(
    Schema.Literal("valid"),
    Schema.Literal("invalid"),
    Schema.Literal("unknown")
  )
})

export const GithubAuthStatusSchema = Schema.Struct({
  summary: Schema.String,
  tokens: Schema.Array(GithubTokenStatusSchema)
})

export const GithubStatusResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  status: GithubAuthStatusSchema
})

/**
 * Boundary schema for the controller Codex authentication status.
 *
 * @pure true - describes immutable response data only.
 * @effect none
 * @invariant account may be null, while authPath, label, message, and present are always typed.
 * @precondition input is an unknown JSON value received from the API boundary.
 * @postcondition successful decoding yields the UI-safe Codex auth status shape.
 * @complexity O(1) schema construction; O(n) decode where n is the response size.
 * @throws Never.
 */
export const CodexAuthStatusSchema = Schema.Struct({
  account: NullableString,
  authPath: Schema.String,
  label: Schema.String,
  message: Schema.String,
  present: Schema.Boolean
})

/**
 * Boundary schema for the Codex status API response envelope.
 *
 * @pure true - describes immutable response data only.
 * @effect none
 * @invariant status is always present; ok is an optional compatibility flag.
 * @precondition input is an unknown JSON value received from the API boundary.
 * @postcondition successful decoding yields a response with a validated CodexAuthStatusSchema status.
 * @complexity O(1) schema construction; O(n) decode where n is the response size.
 * @throws Never.
 */
export const CodexStatusResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  status: CodexAuthStatusSchema
})

const AuthProviderSnapshotFields = {
  claudeAuthEntries: Schema.Number,
  claudeAuthPath: Schema.String,
  codexAuthEntries: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  codexAuthPath: Schema.optionalWith(Schema.String, { default: () => "" }),
  geminiAuthEntries: Schema.Number,
  geminiAuthPath: Schema.String,
  grokAuthEntries: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  grokAuthPath: Schema.optionalWith(Schema.String, { default: () => "" }),
  githubTokenEntries: Schema.Number,
  gitTokenEntries: Schema.Number
}

export const AuthSnapshotSchema = Schema.Struct({
  ...AuthProviderSnapshotFields,
  gitUserEntries: Schema.Number,
  globalEnvPath: Schema.String,
  totalEntries: Schema.Number
})

export const AuthSnapshotResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: AuthSnapshotSchema
})

export const ProjectAuthSnapshotSchema = Schema.Struct({
  activeClaudeLabel: NullableString,
  activeGeminiLabel: NullableString,
  activeGrokLabel: NullableString,
  activeGithubLabel: NullableString,
  activeGitLabel: NullableString,
  ...AuthProviderSnapshotFields,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  projectDir: Schema.String,
  projectName: Schema.String
})

export const ProjectAuthSnapshotResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: ProjectAuthSnapshotSchema
})

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

export const AuthSnapshotSchema = Schema.Struct({
  claudeAuthEntries: Schema.Number,
  claudeAuthPath: Schema.String,
  geminiAuthEntries: Schema.Number,
  geminiAuthPath: Schema.String,
  githubTokenEntries: Schema.Number,
  gitTokenEntries: Schema.Number,
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
  activeGithubLabel: NullableString,
  activeGitLabel: NullableString,
  claudeAuthEntries: Schema.Number,
  claudeAuthPath: Schema.String,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  geminiAuthEntries: Schema.Number,
  geminiAuthPath: Schema.String,
  githubTokenEntries: Schema.Number,
  gitTokenEntries: Schema.Number,
  projectDir: Schema.String,
  projectName: Schema.String
})

export const ProjectAuthSnapshotResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: ProjectAuthSnapshotSchema
})

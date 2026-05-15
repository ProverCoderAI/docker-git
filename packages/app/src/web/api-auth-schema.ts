import * as Schema from "@effect/schema/Schema"

const NullableString = Schema.NullOr(Schema.String)

export const AuthSnapshotSchema = Schema.Struct({
  globalEnvPath: Schema.String,
  claudeAuthPath: Schema.String,
  geminiAuthPath: Schema.String,
  grokAuthPath: Schema.String,
  totalEntries: Schema.Number,
  githubTokenEntries: Schema.Number,
  gitTokenEntries: Schema.Number,
  gitUserEntries: Schema.Number,
  claudeAuthEntries: Schema.Number,
  geminiAuthEntries: Schema.Number,
  grokAuthEntries: Schema.Number
})

export const AuthSnapshotResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: AuthSnapshotSchema
})

export const ProjectAuthSnapshotSchema = Schema.Struct({
  projectDir: Schema.String,
  projectName: Schema.String,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  claudeAuthPath: Schema.String,
  geminiAuthPath: Schema.String,
  grokAuthPath: Schema.String,
  githubTokenEntries: Schema.Number,
  gitTokenEntries: Schema.Number,
  claudeAuthEntries: Schema.Number,
  geminiAuthEntries: Schema.Number,
  grokAuthEntries: Schema.Number,
  activeGithubLabel: NullableString,
  activeGitLabel: NullableString,
  activeClaudeLabel: NullableString,
  activeGeminiLabel: NullableString,
  activeGrokLabel: NullableString
})

export const ProjectAuthSnapshotResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: ProjectAuthSnapshotSchema
})

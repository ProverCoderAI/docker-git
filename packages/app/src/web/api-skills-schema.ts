import * as Schema from "@effect/schema/Schema"

const NullableString = Schema.NullOr(Schema.String)

export const ProjectSkillScopeSchema = Schema.Union(
  Schema.Literal("skills"),
  Schema.Literal("agents/skills"),
  Schema.Literal("agents/.skills"),
  Schema.Literal("claude/skills"),
  Schema.Literal("codex/skills"),
  Schema.Literal("gemini/skills")
)

export const ProjectSkillFileSchema = Schema.Struct({
  id: Schema.String,
  scope: ProjectSkillScopeSchema,
  name: Schema.String,
  relativePath: Schema.String,
  absolutePath: Schema.String,
  bytes: Schema.Number,
  content: Schema.String,
  updatedAtIso: NullableString
})

export const ProjectSkillScopeInfoSchema = Schema.Struct({
  scope: ProjectSkillScopeSchema,
  relativeRoot: Schema.String,
  absoluteRoot: Schema.String
})

export const ProjectSkillsSnapshotSchema = Schema.Struct({
  projectId: Schema.String,
  projectKey: Schema.String,
  projectDir: Schema.String,
  skills: Schema.Array(ProjectSkillFileSchema),
  scopes: Schema.Array(ProjectSkillScopeInfoSchema)
})

export const ProjectSkillsResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: ProjectSkillsSnapshotSchema
})

export const ProjectSkillUpdateResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  skill: ProjectSkillFileSchema,
  snapshot: ProjectSkillsSnapshotSchema
})

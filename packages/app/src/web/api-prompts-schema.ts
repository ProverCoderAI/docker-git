import * as Schema from "@effect/schema/Schema"

export const ProjectPromptKindSchema = Schema.Union(
  Schema.Literal("claude"),
  Schema.Literal("codex"),
  Schema.Literal("gemini"),
  Schema.Literal("grok")
)

export const ProjectPromptFileSchema = Schema.Struct({
  kind: ProjectPromptKindSchema,
  fileName: Schema.String,
  relativePath: Schema.String,
  absolutePath: Schema.String,
  exists: Schema.Boolean,
  bytes: Schema.Number,
  content: Schema.String
})

export const ProjectPromptsSnapshotSchema = Schema.Struct({
  projectId: Schema.String,
  projectKey: Schema.String,
  projectDir: Schema.String,
  prompts: Schema.Array(ProjectPromptFileSchema)
})

export const ProjectPromptsResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: ProjectPromptsSnapshotSchema
})

export const ProjectPromptUpdateResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  prompt: ProjectPromptFileSchema,
  snapshot: ProjectPromptsSnapshotSchema
})

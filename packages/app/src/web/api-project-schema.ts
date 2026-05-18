import * as Schema from "@effect/schema/Schema"

export const NullableString = Schema.NullOr(Schema.String)

export const ProjectStatusSchema = Schema.Union(
  Schema.Literal("running"),
  Schema.Literal("stopped"),
  Schema.Literal("unknown")
)

const projectSummaryFields = {
  clonedOnHostname: Schema.optional(Schema.String),
  containerName: Schema.optional(Schema.String),
  displayName: Schema.String,
  id: Schema.String,
  projectKey: Schema.String,
  repoRef: Schema.String,
  repoUrl: Schema.String,
  sshSessions: Schema.Number,
  startedAtEpochMs: Schema.NullOr(Schema.Number),
  startedAtIso: NullableString,
  status: ProjectStatusSchema,
  statusLabel: Schema.String
}

export const ProjectSummarySchema = Schema.Struct(projectSummaryFields)

export const ProjectDetailsSchema = Schema.Struct({
  ...projectSummaryFields,
  authorizedKeysExists: Schema.Boolean,
  authorizedKeysPath: Schema.String,
  codexAuthPath: Schema.String,
  codexHome: Schema.String,
  containerName: Schema.String,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  gpu: Schema.Union(Schema.Literal("none"), Schema.Literal("all")),
  projectDir: Schema.String,
  serviceName: Schema.String,
  sshCommand: Schema.String,
  sshPort: Schema.Number,
  sshUser: Schema.String,
  targetDir: Schema.String
})

export const HealthResponseSchema = Schema.Struct({
  cwd: Schema.String,
  ok: Schema.Boolean,
  projectsRoot: Schema.String,
  revision: NullableString
})

export const ProjectsResponseSchema = Schema.Struct({
  projects: Schema.Array(ProjectSummarySchema)
})

export const ProjectResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  project: ProjectDetailsSchema
})

import * as Schema from "@effect/schema/Schema"

export const ContainerTaskKindSchema = Schema.Union(
  Schema.Literal("ssh"),
  Schema.Literal("web-terminal"),
  Schema.Literal("agent"),
  Schema.Literal("background"),
  Schema.Literal("system")
)

export const ContainerTaskSchema = Schema.Struct({
  pid: Schema.Number,
  ppid: Schema.Number,
  user: Schema.String,
  tty: Schema.String,
  etime: Schema.String,
  etimes: Schema.Number,
  command: Schema.String,
  kind: ContainerTaskKindSchema,
  managedId: Schema.optional(Schema.String),
  logAvailable: Schema.Boolean
})

export const ContainerTaskSnapshotSchema = Schema.Struct({
  projectId: Schema.String,
  containerName: Schema.String,
  generatedAt: Schema.String,
  sshConnections: Schema.Number,
  tasks: Schema.Array(ContainerTaskSchema)
})

export const ContainerTaskSnapshotResponseSchema = Schema.Struct({
  snapshot: ContainerTaskSnapshotSchema
})

import * as Schema from "@effect/schema/Schema"

export const TerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  sshCommand: Schema.String,
  status: Schema.Union(
    Schema.Literal("ready"),
    Schema.Literal("attached"),
    Schema.Literal("exited"),
    Schema.Literal("failed")
  ),
  createdAt: Schema.String,
  startedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  signal: Schema.optional(Schema.Number)
})

const TerminalServerMessagePayloadSchema = Schema.Union(
  Schema.Struct({
    type: Schema.Literal("ready"),
    session: TerminalSessionSchema
  }),
  Schema.Struct({
    type: Schema.Literal("output"),
    data: Schema.String
  }),
  Schema.Struct({
    type: Schema.Literal("exit"),
    exitCode: Schema.NullOr(Schema.Number),
    signal: Schema.NullOr(Schema.Number)
  }),
  Schema.Struct({
    type: Schema.Literal("error"),
    message: Schema.String
  })
)

export const TerminalServerMessageSchema = Schema.parseJson(TerminalServerMessagePayloadSchema)

export type TerminalSession = Schema.Schema.Type<typeof TerminalSessionSchema>
export type TerminalServerMessage = Schema.Schema.Type<typeof TerminalServerMessagePayloadSchema>

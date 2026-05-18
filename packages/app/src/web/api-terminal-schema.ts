import * as Schema from "@effect/schema/Schema"

import { TerminalSessionSchema } from "../shared/terminal-session-schema.js"
import { ProjectDetailsSchema } from "./api-project-schema.js"

export const TerminalSessionResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  project: ProjectDetailsSchema,
  session: TerminalSessionSchema
})

export const ProjectTerminalSessionsResponseSchema = Schema.Struct({
  activeSessionId: Schema.NullOr(Schema.String),
  sessions: Schema.Array(TerminalSessionSchema)
})

export const ProjectTerminalSessionResponseSchema = Schema.Struct({
  session: TerminalSessionSchema
})

export const TerminalSessionLookupResponseSchema = Schema.Struct({
  projectDisplayName: Schema.String,
  projectKey: Schema.String,
  session: TerminalSessionSchema
})

export const AuthTerminalSessionResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  session: TerminalSessionSchema
})

export { TerminalServerMessageSchema } from "../shared/terminal-session-schema.js"

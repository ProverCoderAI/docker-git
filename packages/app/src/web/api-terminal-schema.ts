import * as Schema from "@effect/schema/Schema"
import { TerminalSessionSchema } from "@prover-coder-ai/docker-git-terminal/contracts"

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

export { TerminalServerMessageSchema } from "@prover-coder-ai/docker-git-terminal/contracts"

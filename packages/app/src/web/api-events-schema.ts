import * as Schema from "@effect/schema/Schema"

import { JsonValueSchema } from "../shared/json-schema.js"

export const ApiEventSchema = Schema.Struct({
  seq: Schema.Number,
  projectId: Schema.String,
  type: Schema.Union(
    Schema.Literal("snapshot"),
    Schema.Literal("project.created"),
    Schema.Literal("project.deleted"),
    Schema.Literal("project.deployment.status"),
    Schema.Literal("project.deployment.log"),
    Schema.Literal("project.ssh.session"),
    Schema.Literal("agent.started"),
    Schema.Literal("agent.output"),
    Schema.Literal("agent.exited"),
    Schema.Literal("agent.stopped"),
    Schema.Literal("agent.error")
  ),
  at: Schema.String,
  payload: JsonValueSchema
})

export const ProjectEventsPollResponseSchema = Schema.Struct({
  cursor: Schema.Number,
  events: Schema.Array(ApiEventSchema)
})

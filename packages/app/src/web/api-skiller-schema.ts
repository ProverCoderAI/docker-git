import * as Schema from "@effect/schema/Schema"

export const SkillerLaunchResponseSchema = Schema.Struct({
  alreadyRunning: Schema.Boolean,
  logPath: Schema.String,
  ok: Schema.Boolean,
  pid: Schema.NullOr(Schema.Number),
  startedAtIso: Schema.String
})

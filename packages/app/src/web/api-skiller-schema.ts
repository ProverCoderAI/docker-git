import * as Schema from "@effect/schema/Schema"

export const SkillerLaunchResponseSchema = Schema.Struct({
  alreadyRunning: Schema.Boolean,
  appPath: Schema.String,
  logPath: Schema.String,
  ok: Schema.Boolean,
  pid: Schema.NullOr(Schema.Number),
  startedAtIso: Schema.String,
  trpcBasePath: Schema.String,
  trpcPort: Schema.Number
})

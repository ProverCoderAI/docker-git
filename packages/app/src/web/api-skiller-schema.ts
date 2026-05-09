import * as Schema from "@effect/schema/Schema"

export const SkillerScopeResponseSchema = Schema.Struct({
  containerHomePath: Schema.String,
  containerName: Schema.String,
  containerProjectPath: Schema.String,
  hostHomePath: Schema.String,
  hostProjectPath: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  sshUser: Schema.String
})

export const SkillerLaunchResponseSchema = Schema.Struct({
  alreadyRunning: Schema.Boolean,
  appPath: Schema.String,
  logPath: Schema.String,
  ok: Schema.Boolean,
  pid: Schema.NullOr(Schema.Number),
  scope: Schema.NullOr(SkillerScopeResponseSchema),
  startedAtIso: Schema.String,
  trpcBasePath: Schema.String,
  trpcPort: Schema.Number
})

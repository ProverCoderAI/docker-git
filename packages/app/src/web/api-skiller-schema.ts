import * as Schema from "@effect/schema/Schema"

export const SkillerScopeResponseSchema = Schema.Struct({
  containerCodexSkillsPath: Schema.String,
  containerHomePath: Schema.String,
  containerName: Schema.String,
  containerProjectPath: Schema.String,
  hostCodexSkillsPath: Schema.String,
  hostEnvGlobalPath: Schema.String,
  hostHomePath: Schema.String,
  hostProjectPath: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  sshUser: Schema.String
})

const bundledModeLiteral = Schema.Literal("bundled")
const externalModeLiteral = Schema.Literal("external")

export const SkillerLaunchResponseSchema = Schema.Struct({
  alreadyRunning: Schema.Boolean,
  appPath: Schema.String,
  backendUrl: Schema.NullOr(Schema.String),
  logPath: Schema.String,
  mode: Schema.optionalWith(
    Schema.Union(bundledModeLiteral, externalModeLiteral),
    { default: () => "bundled" }
  ),
  ok: Schema.Boolean,
  pid: Schema.NullOr(Schema.Number),
  scope: Schema.NullOr(SkillerScopeResponseSchema),
  startedAtIso: Schema.String,
  trpcBasePath: Schema.String,
  trpcPort: Schema.Number
})

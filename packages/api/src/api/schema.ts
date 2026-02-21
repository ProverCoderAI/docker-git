import * as Schema from "effect/Schema"

const OptionalString = Schema.optional(Schema.String)
const OptionalBoolean = Schema.optional(Schema.Boolean)

export const CreateProjectRequestSchema = Schema.Struct({
  repoUrl: OptionalString,
  repoRef: OptionalString,
  targetDir: OptionalString,
  sshPort: OptionalString,
  sshUser: OptionalString,
  containerName: OptionalString,
  serviceName: OptionalString,
  volumeName: OptionalString,
  secretsRoot: OptionalString,
  authorizedKeysPath: OptionalString,
  envGlobalPath: OptionalString,
  envProjectPath: OptionalString,
  codexAuthPath: OptionalString,
  codexHome: OptionalString,
  dockerNetworkMode: OptionalString,
  dockerSharedNetworkName: OptionalString,
  enableMcpPlaywright: OptionalBoolean,
  outDir: OptionalString,
  gitTokenLabel: OptionalString,
  codexTokenLabel: OptionalString,
  claudeTokenLabel: OptionalString,
  up: OptionalBoolean,
  openSsh: OptionalBoolean,
  force: OptionalBoolean,
  forceEnv: OptionalBoolean
})

export const AgentProviderSchema = Schema.Literal("codex", "opencode", "claude", "custom")

export const AgentEnvVarSchema = Schema.Struct({
  key: Schema.String,
  value: Schema.String
})

export const CreateAgentRequestSchema = Schema.Struct({
  provider: AgentProviderSchema,
  command: OptionalString,
  args: Schema.optional(Schema.Array(Schema.String)),
  cwd: OptionalString,
  env: Schema.optional(Schema.Array(AgentEnvVarSchema)),
  label: OptionalString
})

export const AgentSessionSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  provider: AgentProviderSchema,
  label: Schema.String,
  command: Schema.String,
  containerName: Schema.String,
  status: Schema.Literal("starting", "running", "stopping", "stopped", "exited", "failed"),
  source: Schema.String,
  pidFile: Schema.String,
  hostPid: Schema.NullOr(Schema.Number),
  startedAt: Schema.String,
  updatedAt: Schema.String,
  stoppedAt: OptionalString,
  exitCode: Schema.optional(Schema.Number),
  signal: OptionalString
})

export const AgentLogLineSchema = Schema.Struct({
  at: Schema.String,
  stream: Schema.Literal("stdout", "stderr"),
  line: Schema.String
})

export type CreateProjectRequestInput = Schema.Schema.Type<typeof CreateProjectRequestSchema>
export type CreateAgentRequestInput = Schema.Schema.Type<typeof CreateAgentRequestSchema>

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
  cpuLimit: OptionalString,
  ramLimit: OptionalString,
  dockerNetworkMode: OptionalString,
  dockerSharedNetworkName: OptionalString,
  enableMcpPlaywright: OptionalBoolean,
  outDir: OptionalString,
  gitTokenLabel: OptionalString,
  codexTokenLabel: OptionalString,
  claudeTokenLabel: OptionalString,
  agentAutoMode: OptionalString,
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

export const CreateFollowRequestSchema = Schema.Struct({
  actor: OptionalString,
  object: Schema.String,
  domain: OptionalString,
  inbox: OptionalString,
  to: Schema.optional(Schema.Array(Schema.String)),
  capability: OptionalString
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
export type CreateFollowRequestInput = Schema.Schema.Type<typeof CreateFollowRequestSchema>

export const AuthGithubLoginRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  token: Schema.optional(Schema.NullOr(Schema.String)),
  scopes: Schema.optional(Schema.NullOr(Schema.String)),
  envGlobalPath: Schema.String
})

export const AuthGithubStatusRequestSchema = Schema.Struct({
  envGlobalPath: Schema.String
})

export const AuthGithubLogoutRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  envGlobalPath: Schema.String
})

export const AuthCodexLoginRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  codexAuthPath: Schema.String
})

export const AuthCodexStatusRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  codexAuthPath: Schema.String
})

export const AuthCodexLogoutRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  codexAuthPath: Schema.String
})

export const AuthClaudeLoginRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  claudeAuthPath: Schema.String
})

export const AuthClaudeStatusRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  claudeAuthPath: Schema.String
})

export const AuthClaudeLogoutRequestSchema = Schema.Struct({
  label: Schema.optional(Schema.NullOr(Schema.String)),
  claudeAuthPath: Schema.String
})

export const StateInitRequestSchema = Schema.Struct({
  repoUrl: Schema.String,
  repoRef: OptionalString
})

export const StateCommitRequestSchema = Schema.Struct({
  message: Schema.String
})

export const StateSyncRequestSchema = Schema.Struct({
  message: Schema.optional(Schema.NullOr(Schema.String))
})

export const ScrapExportRequestSchema = Schema.Struct({
  projectDir: Schema.String,
  archivePath: OptionalString
})

export const ScrapImportRequestSchema = Schema.Struct({
  projectDir: Schema.String,
  archivePath: Schema.String,
  wipe: OptionalBoolean
})

export const SessionsListRequestSchema = Schema.Struct({
  projectDir: Schema.String,
  includeDefault: OptionalBoolean
})

export const SessionsKillRequestSchema = Schema.Struct({
  projectDir: Schema.String,
  pid: Schema.Number
})

export const SessionsLogsRequestSchema = Schema.Struct({
  projectDir: Schema.String,
  pid: Schema.Number,
  lines: Schema.optional(Schema.Number)
})

export const McpPlaywrightUpRequestSchema = Schema.Struct({
  projectDir: Schema.String,
  runUp: OptionalBoolean
})

export const ApplyRequestSchema = Schema.Struct({
  runUp: OptionalBoolean,
  gitTokenLabel: OptionalString,
  codexTokenLabel: OptionalString,
  claudeTokenLabel: OptionalString,
  cpuLimit: OptionalString,
  ramLimit: OptionalString,
  enableMcpPlaywright: OptionalBoolean
})

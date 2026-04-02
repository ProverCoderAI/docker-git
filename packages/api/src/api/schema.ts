import * as Schema from "effect/Schema"

const OptionalString = Schema.optional(Schema.String)
const OptionalBoolean = Schema.optional(Schema.Boolean)
const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String))

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
  authorizedKeysContents: OptionalString,
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
  skipGithubAuth: OptionalBoolean,
  codexTokenLabel: OptionalString,
  claudeTokenLabel: OptionalString,
  agentAutoMode: OptionalString,
  up: OptionalBoolean,
  openSsh: OptionalBoolean,
  force: OptionalBoolean,
  forceEnv: OptionalBoolean,
  waitForClone: OptionalBoolean
})

export const GithubAuthLoginRequestSchema = Schema.Struct({
  label: OptionalNullableString,
  token: OptionalNullableString,
  scopes: OptionalNullableString
})

export const GithubAuthLogoutRequestSchema = Schema.Struct({
  label: OptionalNullableString
})

export const CodexAuthImportRequestSchema = Schema.Struct({
  label: OptionalNullableString,
  authText: Schema.String
})

export const CodexAuthLogoutRequestSchema = Schema.Struct({
  label: OptionalNullableString
})

export const ApplyAllRequestSchema = Schema.Struct({
  activeOnly: OptionalBoolean
})

export const UpProjectRequestSchema = Schema.Struct({
  authorizedKeysContents: OptionalString
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
export type GithubAuthLoginRequestInput = Schema.Schema.Type<typeof GithubAuthLoginRequestSchema>
export type GithubAuthLogoutRequestInput = Schema.Schema.Type<typeof GithubAuthLogoutRequestSchema>
export type CodexAuthImportRequestInput = Schema.Schema.Type<typeof CodexAuthImportRequestSchema>
export type CodexAuthLogoutRequestInput = Schema.Schema.Type<typeof CodexAuthLogoutRequestSchema>
export type ApplyAllRequestInput = Schema.Schema.Type<typeof ApplyAllRequestSchema>
export type UpProjectRequestInput = Schema.Schema.Type<typeof UpProjectRequestSchema>
export type CreateAgentRequestInput = Schema.Schema.Type<typeof CreateAgentRequestSchema>
export type CreateFollowRequestInput = Schema.Schema.Type<typeof CreateFollowRequestSchema>

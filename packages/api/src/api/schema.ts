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
  useManagedAuthorizedKeys: OptionalBoolean,
  envGlobalPath: OptionalString,
  envProjectPath: OptionalString,
  codexAuthPath: OptionalString,
  codexHome: OptionalString,
  cpuLimit: OptionalString,
  ramLimit: OptionalString,
  playwrightCpuLimit: OptionalString,
  playwrightRamLimit: OptionalString,
  gpu: Schema.optional(Schema.Literal("none", "all")),
  dockerNetworkMode: OptionalString,
  dockerSharedNetworkName: OptionalString,
  enableMcpPlaywright: OptionalBoolean,
  outDir: OptionalString,
  gitTokenLabel: OptionalString,
  skipGithubAuth: OptionalBoolean,
  codexTokenLabel: OptionalString,
  claudeTokenLabel: OptionalString,
  geminiTokenLabel: OptionalString,
  grokTokenLabel: OptionalString,
  agentAutoMode: OptionalString,
  up: OptionalBoolean,
  openSsh: OptionalBoolean,
  force: OptionalBoolean,
  forceEnv: OptionalBoolean,
  waitForClone: OptionalBoolean,
  async: OptionalBoolean
})

export const GithubAuthLoginRequestSchema = Schema.Struct({
  label: OptionalNullableString,
  token: OptionalNullableString,
  scopes: OptionalNullableString
})

export const GitlabAuthLoginRequestSchema = Schema.Struct({
  label: OptionalNullableString,
  token: OptionalNullableString
})

export const AuthMenuFlowSchema = Schema.Literal(
  "GithubRemove",
  "GitSet",
  "GitRemove",
  "ClaudeLogout",
  "GeminiApiKey",
  "GeminiLogout",
  "GrokApiKey",
  "GrokLogout"
)

export const AuthTerminalFlowSchema = Schema.Literal("ClaudeOauth", "GeminiOauth", "GrokOauth")

export const AuthMenuRequestSchema = Schema.Struct({
  flow: AuthMenuFlowSchema,
  label: OptionalNullableString,
  token: OptionalNullableString,
  user: OptionalNullableString,
  apiKey: OptionalNullableString
})

export const AuthTerminalSessionRequestSchema = Schema.Struct({
  flow: AuthTerminalFlowSchema,
  label: OptionalNullableString
})

export const GithubAuthLogoutRequestSchema = Schema.Struct({
  label: OptionalNullableString
})

export const GitlabAuthLogoutRequestSchema = Schema.Struct({
  label: OptionalNullableString
})

export const CodexAuthImportRequestSchema = Schema.Struct({
  label: OptionalNullableString,
  authText: Schema.String
})

export const CodexAuthLoginRequestSchema = Schema.Struct({
  label: OptionalNullableString
})

export const CodexAuthLogoutRequestSchema = Schema.Struct({
  label: OptionalNullableString
})

export const ProjectAuthFlowSchema = Schema.Literal(
  "ProjectGithubConnect",
  "ProjectGithubDisconnect",
  "ProjectGitConnect",
  "ProjectGitDisconnect",
  "ProjectClaudeConnect",
  "ProjectClaudeDisconnect",
  "ProjectGeminiConnect",
  "ProjectGeminiDisconnect",
  "ProjectGrokConnect",
  "ProjectGrokDisconnect"
)

export const ProjectAuthRequestSchema = Schema.Struct({
  flow: ProjectAuthFlowSchema,
  label: OptionalNullableString
})

export const ProjectPromptKindSchema = Schema.Literal("claude", "codex", "gemini", "grok")

export const ProjectPromptUpdateRequestSchema = Schema.Struct({
  content: Schema.String
})

export const ProjectSkillScopeSchema = Schema.Literal(
  "skills",
  "agents/skills",
  "agents/.skills",
  "claude/skills",
  "codex/skills",
  "gemini/skills",
  "grok/skills"
)

export const ProjectSkillUpdateRequestSchema = Schema.Struct({
  scope: ProjectSkillScopeSchema,
  name: Schema.String,
  content: Schema.String
})

export const StateInitRequestSchema = Schema.Struct({
  repoUrl: Schema.String,
  repoRef: OptionalString
})

export const StateCommitRequestSchema = Schema.Struct({
  message: Schema.String
})

export const StateSyncRequestSchema = Schema.Struct({
  message: OptionalNullableString
})

export const ApplyAllRequestSchema = Schema.Struct({
  activeOnly: OptionalBoolean
})

export const ApplyProjectRequestSchema = Schema.Struct({
  cpuLimit: OptionalString,
  ramLimit: OptionalString,
  playwrightCpuLimit: OptionalString,
  playwrightRamLimit: OptionalString,
  gpu: Schema.optional(Schema.Literal("none", "all"))
})

export const UpProjectRequestSchema = Schema.Struct({
  authorizedKeysContents: OptionalString,
  useManagedAuthorizedKeys: OptionalBoolean
})

export const StartProjectTerminalSessionRequestSchema = Schema.Struct({
  requestId: Schema.UUID
})

export const ActiveProjectTerminalSessionRequestSchema = Schema.Struct({
  sessionId: Schema.String
})

export const ProjectPortForwardRequestSchema = Schema.Struct({
  hostPort: Schema.optional(Schema.Number),
  targetPort: Schema.Number
})

export const ProjectBrowserStatusSchema = Schema.Literal("running", "stopped", "missing", "unknown")

export const ProjectBrowserSessionSchema = Schema.Struct({
  cdpPath: Schema.String,
  cdpUrl: Schema.String,
  containerName: Schema.String,
  noVncPath: Schema.String,
  noVncUrl: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  status: ProjectBrowserStatusSchema
})

export const ProjectDatabaseEngineSchema = Schema.Literal("postgres", "mysql", "mariadb")

export const ProjectDatabaseProfileSchema = Schema.Struct({
  createdAt: Schema.String,
  database: Schema.String,
  engine: ProjectDatabaseEngineSchema,
  host: Schema.String,
  id: Schema.String,
  label: Schema.String,
  maskedConnectionString: Schema.String,
  port: Schema.Number,
  updatedAt: Schema.String,
  user: Schema.String
})

export const ProjectDatabaseProfileRequestSchema = Schema.Struct({
  connectionString: Schema.String,
  label: OptionalNullableString
})

export const ProjectDatabaseSessionStatusSchema = Schema.Literal("running", "stopped", "missing", "unknown")

export const ProjectDatabaseSessionSchema = Schema.Struct({
  configHash: Schema.String,
  containerName: Schema.String,
  editorPath: Schema.String,
  editorUrl: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  status: ProjectDatabaseSessionStatusSchema
})

export const ProjectDatabaseForwardStatusSchema = Schema.Literal("running", "stopped", "unknown")

export const ProjectDatabaseForwardSchema = Schema.Struct({
  bindHost: Schema.String,
  containerName: Schema.String,
  createdAt: Schema.NullOr(Schema.String),
  database: Schema.String,
  engine: ProjectDatabaseEngineSchema,
  externalConnectionString: Schema.String,
  hostPort: Schema.Number,
  id: Schema.String,
  maskedExternalConnectionString: Schema.String,
  profileId: Schema.String,
  profileLabel: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  publicHost: Schema.String,
  status: ProjectDatabaseForwardStatusSchema,
  targetHost: Schema.String,
  targetPort: Schema.Number
})

export const AgentProviderSchema = Schema.Literal("codex", "opencode", "claude", "grok", "custom")

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

export const ExchangeSubscribeRequestSchema = Schema.Struct({
  target: Schema.String,
  domain: OptionalString,
  actor: OptionalString,
  inbox: OptionalString,
  projectRepoUrl: OptionalString,
  agentProvider: Schema.optional(AgentProviderSchema),
  agentCommand: OptionalString
})

export const ExchangePollRequestSchema = Schema.Struct({
  target: OptionalString,
  runTasks: OptionalBoolean
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

export const TerminalSessionStatusSchema = Schema.Literal("ready", "attached", "exited", "failed")

export const TerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  sshCommand: Schema.String,
  status: TerminalSessionStatusSchema,
  createdAt: Schema.String,
  attachedClients: Schema.optional(Schema.Number),
  startedAt: OptionalString,
  closedAt: OptionalString,
  exitCode: Schema.optional(Schema.Number),
  signal: Schema.optional(Schema.Number)
})

export type CreateProjectRequestInput = Schema.Schema.Type<typeof CreateProjectRequestSchema>
export type GithubAuthLoginRequestInput = Schema.Schema.Type<typeof GithubAuthLoginRequestSchema>
export type GitlabAuthLoginRequestInput = Schema.Schema.Type<typeof GitlabAuthLoginRequestSchema>
export type AuthMenuRequestInput = Schema.Schema.Type<typeof AuthMenuRequestSchema>
export type AuthTerminalSessionRequestInput = Schema.Schema.Type<typeof AuthTerminalSessionRequestSchema>
export type GithubAuthLogoutRequestInput = Schema.Schema.Type<typeof GithubAuthLogoutRequestSchema>
export type GitlabAuthLogoutRequestInput = Schema.Schema.Type<typeof GitlabAuthLogoutRequestSchema>
export type CodexAuthImportRequestInput = Schema.Schema.Type<typeof CodexAuthImportRequestSchema>
export type CodexAuthLoginRequestInput = Schema.Schema.Type<typeof CodexAuthLoginRequestSchema>
export type CodexAuthLogoutRequestInput = Schema.Schema.Type<typeof CodexAuthLogoutRequestSchema>
export type ProjectAuthRequestInput = Schema.Schema.Type<typeof ProjectAuthRequestSchema>
export type ProjectPromptKindInput = Schema.Schema.Type<typeof ProjectPromptKindSchema>
export type ProjectPromptUpdateRequestInput = Schema.Schema.Type<typeof ProjectPromptUpdateRequestSchema>
export type ProjectSkillScopeInput = Schema.Schema.Type<typeof ProjectSkillScopeSchema>
export type ProjectSkillUpdateRequestInput = Schema.Schema.Type<typeof ProjectSkillUpdateRequestSchema>
export type StateInitRequestInput = Schema.Schema.Type<typeof StateInitRequestSchema>
export type StateCommitRequestInput = Schema.Schema.Type<typeof StateCommitRequestSchema>
export type StateSyncRequestInput = Schema.Schema.Type<typeof StateSyncRequestSchema>
export type ApplyAllRequestInput = Schema.Schema.Type<typeof ApplyAllRequestSchema>
export type UpProjectRequestInput = Schema.Schema.Type<typeof UpProjectRequestSchema>
export type ProjectPortForwardRequestInput = Schema.Schema.Type<typeof ProjectPortForwardRequestSchema>
export type ProjectDatabaseProfileRequestInput = Schema.Schema.Type<typeof ProjectDatabaseProfileRequestSchema>
export type CreateAgentRequestInput = Schema.Schema.Type<typeof CreateAgentRequestSchema>
export type CreateFollowRequestInput = Schema.Schema.Type<typeof CreateFollowRequestSchema>

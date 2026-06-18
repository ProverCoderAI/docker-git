import * as HttpApi from "@effect/platform/HttpApi"
import * as HttpApiEndpoint from "@effect/platform/HttpApiEndpoint"
import * as HttpApiGroup from "@effect/platform/HttpApiGroup"
import * as HttpApiSchema from "@effect/platform/HttpApiSchema"
import * as OpenApi from "@effect/platform/OpenApi"
import * as Schema from "effect/Schema"

import {
  ActiveProjectTerminalSessionRequestSchema,
  AgentSessionSchema,
  ApplyAllRequestSchema,
  ApplyProjectRequestSchema,
  AuthMenuRequestSchema,
  AuthTerminalSessionRequestSchema,
  CodexAuthImportRequestSchema,
  CodexAuthLogoutRequestSchema,
  CreateProjectRequestSchema,
  GitAuthLoginRequestSchema,
  GitAuthLogoutRequestSchema,
  GithubAuthLoginRequestSchema,
  GithubAuthLogoutRequestSchema,
  GitlabAuthLoginRequestSchema,
  GitlabAuthLogoutRequestSchema,
  GrokAuthLogoutRequestSchema,
  ProjectAuthRequestSchema,
  ProjectBrowserSessionSchema,
  ProjectDatabaseForwardSchema,
  ProjectDatabaseProfileRequestSchema,
  ProjectDatabaseProfileSchema,
  ProjectDatabaseSessionSchema,
  ProjectPortForwardRequestSchema,
  ProjectSkillUpdateRequestSchema,
  StartPanelCloudflareTunnelRequestSchema,
  StartProjectTerminalSessionRequestSchema,
  UpProjectRequestSchema
} from "./schema.js"

const NullableStringSchema = Schema.NullOr(Schema.String)
const OptionalOkSchema = Schema.optional(Schema.Boolean)

const ProjectIdParam = HttpApiSchema.param("projectId", Schema.String)
const ProjectKeyParam = HttpApiSchema.param("projectKey", Schema.String)
const SessionIdParam = HttpApiSchema.param("sessionId", Schema.String)
const TargetPortParam = HttpApiSchema.param("targetPort", Schema.NumberFromString)
const ProfileIdParam = HttpApiSchema.param("profileId", Schema.String)
const PromptKindParam = HttpApiSchema.param("kind", Schema.String)
const ScopeIdParam = HttpApiSchema.param("scopeId", Schema.String)
const SkillNameParam = HttpApiSchema.param("name", Schema.String)
const PidParam = HttpApiSchema.param("pid", Schema.NumberFromString)

export const OkResponseSchema = Schema.Struct({
  ok: Schema.Literal(true)
})

export const HealthResponseSchema = Schema.Struct({
  cwd: Schema.String,
  ok: Schema.Boolean,
  projectsRoot: Schema.String,
  revision: NullableStringSchema
})

export const ProjectStatusSchema = Schema.Literal("running", "stopped", "unknown")

const ProjectSummaryFields = {
  clonedOnHostname: Schema.optional(Schema.String),
  containerName: Schema.optional(Schema.String),
  displayName: Schema.String,
  id: Schema.String,
  projectKey: Schema.String,
  repoRef: Schema.String,
  repoUrl: Schema.String,
  sshSessions: Schema.Number,
  startedAtEpochMs: Schema.NullOr(Schema.Number),
  startedAtIso: NullableStringSchema,
  status: ProjectStatusSchema,
  statusLabel: Schema.String
}

export const ProjectSummarySchema = Schema.Struct(ProjectSummaryFields)

export const ProjectDetailsSchema = Schema.Struct({
  ...ProjectSummaryFields,
  authorizedKeysExists: Schema.Boolean,
  authorizedKeysPath: Schema.String,
  codexAuthPath: Schema.String,
  codexHome: Schema.String,
  containerName: Schema.String,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  gpu: Schema.Literal("none", "all"),
  projectDir: Schema.String,
  serviceName: Schema.String,
  sshCommand: Schema.String,
  sshPort: Schema.Number,
  sshUser: Schema.String,
  targetDir: Schema.String
})

export const ProjectsResponseSchema = Schema.Struct({
  projects: Schema.Array(ProjectSummarySchema)
})

export const ProjectResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  project: ProjectDetailsSchema
})

export const CreateProjectAcceptedResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  cursor: Schema.Number,
  projectId: Schema.String
})

export const StartProjectTerminalSessionAcceptedResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  cursor: Schema.Number,
  projectId: Schema.String,
  requestId: Schema.String
})

export const OutputResponseSchema = Schema.Struct({
  output: Schema.String
})

export const ProjectPortForwardStatusSchema = Schema.Literal("running", "stopped", "unknown")

export const ProjectPortForwardSchema = Schema.Struct({
  bindHost: Schema.String,
  containerName: Schema.String,
  createdAt: NullableStringSchema,
  hostPort: Schema.Number,
  id: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  proxyPath: Schema.String,
  publicHost: Schema.String,
  status: ProjectPortForwardStatusSchema,
  targetContainerName: Schema.String,
  targetPort: Schema.Number,
  url: Schema.String
})

export const ProjectPortForwardsResponseSchema = Schema.Struct({
  forwards: Schema.Array(ProjectPortForwardSchema)
})

export const ProjectPortForwardResponseSchema = Schema.Struct({
  forward: ProjectPortForwardSchema
})

export const ProjectBrowserResponseSchema = Schema.Struct({
  browser: ProjectBrowserSessionSchema
})

export const PanelCloudflareTunnelStatusSchema = Schema.Literal("starting", "running", "stopped", "failed")

export const PanelCloudflareTunnelSessionSchema = Schema.Struct({
  error: NullableStringSchema,
  id: Schema.String,
  logTail: Schema.Array(Schema.String),
  panelUrl: Schema.String,
  publicUrl: NullableStringSchema,
  startedAt: Schema.String,
  status: PanelCloudflareTunnelStatusSchema,
  stoppedAt: NullableStringSchema
})

export const PanelCloudflareTunnelResponseSchema = Schema.Struct({
  tunnel: Schema.NullOr(PanelCloudflareTunnelSessionSchema)
})

export const ProjectDatabaseProfilesResponseSchema = Schema.Struct({
  profiles: Schema.Array(ProjectDatabaseProfileSchema)
})

export const ProjectDatabaseProfileResponseSchema = Schema.Struct({
  profile: ProjectDatabaseProfileSchema
})

export const ProjectDatabaseSessionResponseSchema = Schema.Struct({
  session: ProjectDatabaseSessionSchema
})

export const ProjectDatabaseForwardsResponseSchema = Schema.Struct({
  forwards: Schema.Array(ProjectDatabaseForwardSchema)
})

export const ProjectDatabaseForwardResponseSchema = Schema.Struct({
  forward: ProjectDatabaseForwardSchema
})

export const GithubTokenStatusSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  login: NullableStringSchema,
  status: Schema.Literal("valid", "invalid", "unknown")
})

export const GithubAuthStatusSchema = Schema.Struct({
  summary: Schema.String,
  tokens: Schema.Array(GithubTokenStatusSchema)
})

export const GithubStatusResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  status: GithubAuthStatusSchema
})

export const GitlabTokenStatusSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  login: NullableStringSchema,
  status: Schema.Literal("valid", "invalid", "unknown")
})

export const GitlabAuthStatusSchema = Schema.Struct({
  summary: Schema.String,
  tokens: Schema.Array(GitlabTokenStatusSchema)
})

export const GitlabStatusResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  status: GitlabAuthStatusSchema
})

export const GitAuthConnectionStatusSchema = Schema.Struct({
  host: Schema.String,
  user: Schema.String
})

export const GitAuthStatusSchema = Schema.Struct({
  connections: Schema.Array(GitAuthConnectionStatusSchema),
  summary: Schema.String
})

export const GitStatusResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  status: GitAuthStatusSchema
})

export const CodexAuthStatusSchema = Schema.Struct({
  account: NullableStringSchema,
  authPath: Schema.String,
  label: Schema.String,
  message: Schema.String,
  present: Schema.Boolean
})

export const CodexStatusResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  status: CodexAuthStatusSchema
})

export const GrokAuthStatusSchema = Schema.Struct({
  authPath: Schema.String,
  connected: Schema.Boolean,
  label: Schema.String,
  message: Schema.String,
  method: Schema.Literal("none", "api-key", "oauth")
})

export const GrokStatusResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  status: GrokAuthStatusSchema
})

export const AuthSnapshotSchema = Schema.Struct({
  claudeAuthEntries: Schema.Number,
  claudeAuthPath: Schema.String,
  codexAuthEntries: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  codexAuthPath: Schema.optionalWith(Schema.String, { default: () => "" }),
  geminiAuthEntries: Schema.Number,
  geminiAuthPath: Schema.String,
  gitTokenEntries: Schema.Number,
  gitUserEntries: Schema.Number,
  githubTokenEntries: Schema.Number,
  globalEnvPath: Schema.String,
  grokAuthEntries: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  grokAuthPath: Schema.optionalWith(Schema.String, { default: () => "" }),
  totalEntries: Schema.Number
})

export const AuthSnapshotResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  snapshot: AuthSnapshotSchema
})

export const ProjectAuthSnapshotSchema = Schema.Struct({
  activeClaudeLabel: NullableStringSchema,
  activeGeminiLabel: NullableStringSchema,
  activeGitLabel: NullableStringSchema,
  activeGithubLabel: NullableStringSchema,
  activeGrokLabel: NullableStringSchema,
  claudeAuthEntries: Schema.Number,
  claudeAuthPath: Schema.String,
  codexAuthEntries: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  codexAuthPath: Schema.optionalWith(Schema.String, { default: () => "" }),
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  geminiAuthEntries: Schema.Number,
  geminiAuthPath: Schema.String,
  gitTokenEntries: Schema.Number,
  githubTokenEntries: Schema.Number,
  grokAuthEntries: Schema.optionalWith(Schema.Number, { default: () => 0 }),
  grokAuthPath: Schema.optionalWith(Schema.String, { default: () => "" }),
  projectDir: Schema.String,
  projectName: Schema.String
})

export const ProjectAuthSnapshotResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  snapshot: ProjectAuthSnapshotSchema
})

export const TerminalSessionSchema = Schema.Struct({
  attachedClients: Schema.optional(Schema.Number),
  closedAt: Schema.optional(Schema.String),
  createdAt: Schema.String,
  exitCode: Schema.optional(Schema.Number),
  id: Schema.String,
  projectId: Schema.String,
  signal: Schema.optional(Schema.Number),
  sshCommand: Schema.String,
  startedAt: Schema.optional(Schema.String),
  status: Schema.Literal("ready", "attached", "exited", "failed")
})

export const TerminalSessionResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  project: ProjectDetailsSchema,
  session: TerminalSessionSchema
})

export const ProjectTerminalSessionsResponseSchema = Schema.Struct({
  activeSessionId: NullableStringSchema,
  sessions: Schema.Array(TerminalSessionSchema)
})

export const ProjectTerminalSessionResponseSchema = Schema.Struct({
  session: TerminalSessionSchema
})

export const ActiveProjectTerminalSessionResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  session: TerminalSessionSchema
})

export const TerminalSessionLookupResponseSchema = Schema.Struct({
  projectDisplayName: Schema.String,
  projectKey: Schema.String,
  session: TerminalSessionSchema
})

export const AuthTerminalSessionResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  session: TerminalSessionSchema
})

export const ProjectPromptKindSchema = Schema.Literal("claude", "codex", "gemini", "grok")

export const ProjectPromptFileSchema = Schema.Struct({
  absolutePath: Schema.String,
  bytes: Schema.Number,
  content: Schema.String,
  exists: Schema.Boolean,
  fileName: Schema.String,
  kind: ProjectPromptKindSchema,
  relativePath: Schema.String
})

export const ProjectPromptsSnapshotSchema = Schema.Struct({
  projectDir: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  prompts: Schema.Array(ProjectPromptFileSchema)
})

export const ProjectPromptsResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  snapshot: ProjectPromptsSnapshotSchema
})

export const ProjectPromptUpdateResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  prompt: ProjectPromptFileSchema,
  snapshot: ProjectPromptsSnapshotSchema
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

export const ProjectSkillFileSchema = Schema.Struct({
  absolutePath: Schema.String,
  bytes: Schema.Number,
  content: Schema.String,
  id: Schema.String,
  name: Schema.String,
  relativePath: Schema.String,
  scope: ProjectSkillScopeSchema,
  updatedAtIso: NullableStringSchema
})

export const ProjectSkillScopeInfoSchema = Schema.Struct({
  absoluteRoot: Schema.String,
  relativeRoot: Schema.String,
  scope: ProjectSkillScopeSchema
})

export const ProjectSkillsSnapshotSchema = Schema.Struct({
  projectDir: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  scopes: Schema.Array(ProjectSkillScopeInfoSchema),
  skills: Schema.Array(ProjectSkillFileSchema)
})

export const ProjectSkillsResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  snapshot: ProjectSkillsSnapshotSchema
})

export const ProjectSkillUpdateResponseSchema = Schema.Struct({
  ok: OptionalOkSchema,
  skill: ProjectSkillFileSchema,
  snapshot: ProjectSkillsSnapshotSchema
})

export const ContainerTaskKindSchema = Schema.Literal("ssh", "web-terminal", "agent", "background", "system")

export const ContainerTaskSchema = Schema.Struct({
  command: Schema.String,
  elapsed: Schema.optional(Schema.String),
  etime: Schema.String,
  etimes: Schema.Number,
  kind: ContainerTaskKindSchema,
  logAvailable: Schema.Boolean,
  managedId: Schema.optional(Schema.String),
  pid: Schema.Number,
  ppid: Schema.Number,
  tty: Schema.String,
  user: Schema.String
})

export const ContainerTaskSnapshotSchema = Schema.Struct({
  agents: Schema.Array(AgentSessionSchema),
  containerName: Schema.String,
  generatedAt: Schema.String,
  projectId: Schema.String,
  sshConnections: Schema.Number,
  tasks: Schema.Array(ContainerTaskSchema),
  terminalSessions: Schema.Array(TerminalSessionSchema)
})

export const ContainerTaskSnapshotResponseSchema = Schema.Struct({
  snapshot: ContainerTaskSnapshotSchema
})

const QueryIncludeDefaultSchema = Schema.Struct({
  includeDefault: Schema.optional(Schema.String)
})

const QueryLabelSchema = Schema.Struct({
  label: Schema.optional(Schema.String)
})

const QueryLinesSchema = Schema.Struct({
  lines: Schema.optional(Schema.String)
})

const ApiErrorEnvelopeSchema = Schema.Struct({
  command: Schema.optional(Schema.String),
  details: Schema.optional(Schema.Unknown),
  message: Schema.String,
  provider: Schema.optional(Schema.String),
  type: Schema.String
})

const ApiErrorResponseSchema = Schema.Struct({
  error: ApiErrorEnvelopeSchema
})

const endpoint = {
  del: HttpApiEndpoint.del,
  get: HttpApiEndpoint.get,
  post: HttpApiEndpoint.post,
  put: HttpApiEndpoint.put
}

const CoreGroup = HttpApiGroup.make("core").add(
  endpoint.get("health", "/health").addSuccess(HealthResponseSchema)
)

const ProjectsGroup = HttpApiGroup.make("projects")
  .add(endpoint.get("listProjects", "/projects").addSuccess(ProjectsResponseSchema))
  .add(
    endpoint.post("createProject", "/projects")
      .setPayload(CreateProjectRequestSchema)
      .addSuccess(ProjectResponseSchema, { status: 201 })
      .addSuccess(CreateProjectAcceptedResponseSchema, { status: 202 })
  )
  .add(
    endpoint.post("applyAllProjects", "/projects/apply-all")
      .setPayload(ApplyAllRequestSchema)
      .addSuccess(OkResponseSchema)
  )
  .add(endpoint.post("downAllProjects", "/projects/down-all").addSuccess(OkResponseSchema))
  .add(endpoint.get("getProject")`/projects/${ProjectIdParam}`.addSuccess(ProjectResponseSchema))
  .add(endpoint.del("deleteProject")`/projects/${ProjectIdParam}`.addSuccess(OkResponseSchema))
  .add(endpoint.post("downProject")`/projects/${ProjectIdParam}/down`.addSuccess(OkResponseSchema))
  .add(
    endpoint.post("applyProject")`/projects/${ProjectIdParam}/apply`
      .setPayload(ApplyProjectRequestSchema)
      .addSuccess(ProjectResponseSchema)
  )
  .add(
    endpoint.post("upProject")`/projects/${ProjectIdParam}/up`
      .setPayload(UpProjectRequestSchema)
      .addSuccess(ProjectResponseSchema)
  )
  .add(endpoint.post("resumeProject")`/projects/${ProjectIdParam}/resume`.addSuccess(ProjectResponseSchema))
  .add(endpoint.post("suspendProject")`/projects/${ProjectIdParam}/suspend`.addSuccess(ProjectResponseSchema))
  .add(endpoint.get("projectPs")`/projects/${ProjectIdParam}/ps`.addSuccess(OutputResponseSchema))
  .add(endpoint.get("projectLogs")`/projects/${ProjectIdParam}/logs`.addSuccess(OutputResponseSchema))

const ProjectPortsGroup = HttpApiGroup.make("projectPorts")
  .add(endpoint.get("listProjectPorts")`/projects/${ProjectIdParam}/ports`.addSuccess(ProjectPortForwardsResponseSchema))
  .add(
    endpoint.post("createProjectPort")`/projects/${ProjectIdParam}/ports`
      .setPayload(ProjectPortForwardRequestSchema)
      .addSuccess(ProjectPortForwardResponseSchema, { status: 201 })
  )
  .add(
    endpoint.del("deleteProjectPort")`/projects/${ProjectIdParam}/ports/${TargetPortParam}`
      .addSuccess(OkResponseSchema)
  )

const ProjectBrowserGroup = HttpApiGroup.make("projectBrowser")
  .add(endpoint.get("readProjectBrowser")`/projects/${ProjectIdParam}/browser`.addSuccess(ProjectBrowserResponseSchema))
  .add(
    endpoint.post("startProjectBrowser")`/projects/${ProjectIdParam}/browser/start`
      .addSuccess(ProjectBrowserResponseSchema)
  )

const ProjectDatabasesGroup = HttpApiGroup.make("projectDatabases")
  .add(
    endpoint.get("listDatabaseProfiles")`/projects/${ProjectIdParam}/databases/profiles`
      .addSuccess(ProjectDatabaseProfilesResponseSchema)
  )
  .add(
    endpoint.post("saveDatabaseProfile")`/projects/${ProjectIdParam}/databases/profiles`
      .setPayload(ProjectDatabaseProfileRequestSchema)
      .addSuccess(ProjectDatabaseProfileResponseSchema, { status: 201 })
  )
  .add(
    endpoint.del("deleteDatabaseProfile")`/projects/${ProjectIdParam}/databases/profiles/${ProfileIdParam}`
      .addSuccess(OkResponseSchema)
  )
  .add(
    endpoint.post("exposeDatabaseProfile")`/projects/${ProjectIdParam}/databases/profiles/${ProfileIdParam}/expose`
      .addSuccess(ProjectDatabaseForwardResponseSchema, { status: 201 })
  )
  .add(
    endpoint.del("deleteDatabaseForward")`/projects/${ProjectIdParam}/databases/profiles/${ProfileIdParam}/expose`
      .addSuccess(OkResponseSchema)
  )
  .add(
    endpoint.get("listDatabaseForwards")`/projects/${ProjectIdParam}/databases/forwards`
      .addSuccess(ProjectDatabaseForwardsResponseSchema)
  )
  .add(
    endpoint.get("readDatabaseSession")`/projects/${ProjectIdParam}/databases/session`
      .addSuccess(ProjectDatabaseSessionResponseSchema)
  )
  .add(
    endpoint.post("openDatabaseEditor")`/projects/${ProjectIdParam}/databases/open`
      .addSuccess(ProjectDatabaseSessionResponseSchema)
  )
  .add(
    endpoint.post("restartDatabaseEditor")`/projects/${ProjectIdParam}/databases/restart`
      .addSuccess(ProjectDatabaseSessionResponseSchema)
  )

const AuthGroup = HttpApiGroup.make("auth")
  .add(endpoint.get("githubStatus", "/auth/github/status").addSuccess(GithubStatusResponseSchema))
  .add(endpoint.get("gitlabStatus", "/auth/gitlab/status").addSuccess(GitlabStatusResponseSchema))
  .add(endpoint.get("gitStatus", "/auth/git/status").addSuccess(GitStatusResponseSchema))
  .add(
    endpoint.get("grokStatus", "/auth/grok/status")
      .setUrlParams(QueryLabelSchema)
      .addSuccess(GrokStatusResponseSchema)
  )
  .add(
    endpoint.get("codexStatus", "/auth/codex/status")
      .setUrlParams(QueryLabelSchema)
      .addSuccess(CodexStatusResponseSchema)
  )
  .add(
    endpoint.post("githubLogin", "/auth/github/login")
      .setPayload(GithubAuthLoginRequestSchema)
      .addSuccess(GithubStatusResponseSchema, { status: 201 })
  )
  .add(
    endpoint.post("githubLogout", "/auth/github/logout")
      .setPayload(GithubAuthLogoutRequestSchema)
      .addSuccess(GithubStatusResponseSchema)
  )
  .add(
    endpoint.post("gitlabLogin", "/auth/gitlab/login")
      .setPayload(GitlabAuthLoginRequestSchema)
      .addSuccess(GitlabStatusResponseSchema, { status: 201 })
  )
  .add(
    endpoint.post("gitlabLogout", "/auth/gitlab/logout")
      .setPayload(GitlabAuthLogoutRequestSchema)
      .addSuccess(GitlabStatusResponseSchema)
  )
  .add(
    endpoint.post("gitLogin", "/auth/git/login")
      .setPayload(GitAuthLoginRequestSchema)
      .addSuccess(GitStatusResponseSchema, { status: 201 })
  )
  .add(
    endpoint.post("gitLogout", "/auth/git/logout")
      .setPayload(GitAuthLogoutRequestSchema)
      .addSuccess(GitStatusResponseSchema)
  )
  .add(endpoint.get("authMenu", "/auth/menu").addSuccess(AuthSnapshotResponseSchema))
  .add(
    endpoint.post("authMenuAction", "/auth/menu")
      .setPayload(AuthMenuRequestSchema)
      .addSuccess(AuthSnapshotResponseSchema)
  )
  .add(
    endpoint.post("authTerminalSession", "/auth/terminal-sessions")
      .setPayload(AuthTerminalSessionRequestSchema)
      .addSuccess(AuthTerminalSessionResponseSchema, { status: 201 })
  )
  .add(
    endpoint.post("codexImport", "/auth/codex/import")
      .setPayload(CodexAuthImportRequestSchema)
      .addSuccess(CodexStatusResponseSchema, { status: 201 })
  )
  .add(
    endpoint.post("codexLogout", "/auth/codex/logout")
      .setPayload(CodexAuthLogoutRequestSchema)
      .addSuccess(CodexStatusResponseSchema)
  )
  .add(
    endpoint.post("grokLogout", "/auth/grok/logout")
      .setPayload(GrokAuthLogoutRequestSchema)
      .addSuccess(GrokStatusResponseSchema)
  )

const ProjectAuthGroup = HttpApiGroup.make("projectAuth")
  .add(endpoint.get("projectAuth")`/projects/${ProjectIdParam}/auth/menu`.addSuccess(ProjectAuthSnapshotResponseSchema))
  .add(
    endpoint.post("projectAuthAction")`/projects/${ProjectIdParam}/auth/menu`
      .setPayload(ProjectAuthRequestSchema)
      .addSuccess(ProjectAuthSnapshotResponseSchema)
  )

const TerminalGroup = HttpApiGroup.make("terminal")
  .add(
    endpoint.post("createTerminalByKey")`/projects/by-key/${ProjectKeyParam}/terminal-sessions`
      .addSuccess(TerminalSessionResponseSchema, { status: 201 })
  )
  .add(
    endpoint.post("startTerminalByKey")`/projects/by-key/${ProjectKeyParam}/terminal-sessions/start`
      .setPayload(StartProjectTerminalSessionRequestSchema)
      .addSuccess(StartProjectTerminalSessionAcceptedResponseSchema, { status: 202 })
  )
  .add(
    endpoint.get("listTerminalsByKey")`/projects/by-key/${ProjectKeyParam}/terminal-sessions`
      .addSuccess(ProjectTerminalSessionsResponseSchema)
  )
  .add(
    endpoint.get("getTerminalByKey")`/projects/by-key/${ProjectKeyParam}/terminal-sessions/${SessionIdParam}`
      .addSuccess(ProjectTerminalSessionResponseSchema)
  )
  .add(
    endpoint.del("deleteTerminalByKey")`/projects/by-key/${ProjectKeyParam}/terminal-sessions/${SessionIdParam}`
      .addSuccess(OkResponseSchema)
  )
  .add(
    endpoint.put("setActiveTerminalByKey")`/projects/by-key/${ProjectKeyParam}/terminal-sessions/active`
      .setPayload(ActiveProjectTerminalSessionRequestSchema)
      .addSuccess(ActiveProjectTerminalSessionResponseSchema)
  )
  .add(endpoint.get("lookupTerminal")`/terminal-sessions/${SessionIdParam}`.addSuccess(TerminalSessionLookupResponseSchema))
  .add(
    endpoint.del("deleteAuthTerminal")`/auth/terminal-sessions/${SessionIdParam}`.addSuccess(OkResponseSchema)
  )

const PromptsGroup = HttpApiGroup.make("prompts")
  .add(endpoint.get("listPrompts")`/projects/${ProjectIdParam}/prompts`.addSuccess(ProjectPromptsResponseSchema))
  .add(
    endpoint.put("writePrompt")`/projects/${ProjectIdParam}/prompts/${PromptKindParam}`
      .setPayload(Schema.Struct({ content: Schema.String }))
      .addSuccess(ProjectPromptUpdateResponseSchema)
  )
  .add(
    endpoint.del("deletePrompt")`/projects/${ProjectIdParam}/prompts/${PromptKindParam}`
      .addSuccess(ProjectPromptsResponseSchema)
  )

const SkillsGroup = HttpApiGroup.make("skills")
  .add(endpoint.get("listSkills")`/projects/${ProjectIdParam}/skills`.addSuccess(ProjectSkillsResponseSchema))
  .add(
    endpoint.post("writeSkill")`/projects/${ProjectIdParam}/skills`
      .setPayload(ProjectSkillUpdateRequestSchema)
      .addSuccess(ProjectSkillUpdateResponseSchema)
  )
  .add(
    endpoint.del("deleteSkill")`/projects/${ProjectIdParam}/skills/${ScopeIdParam}/${SkillNameParam}`
      .addSuccess(ProjectSkillsResponseSchema)
  )

const TasksGroup = HttpApiGroup.make("tasks")
  .add(
    endpoint.get("listTasks")`/projects/${ProjectIdParam}/tasks`
      .setUrlParams(QueryIncludeDefaultSchema)
      .addSuccess(ContainerTaskSnapshotResponseSchema)
  )
  .add(endpoint.post("stopTask")`/projects/${ProjectIdParam}/tasks/${PidParam}/stop`.addSuccess(OkResponseSchema))
  .add(
    endpoint.get("taskLogs")`/projects/${ProjectIdParam}/tasks/${PidParam}/logs`
      .setUrlParams(QueryLinesSchema)
      .addSuccess(OutputResponseSchema)
  )

const SharingGroup = HttpApiGroup.make("sharing")
  .add(endpoint.get("readPanelCloudflareTunnel", "/cloudflare-tunnels/panel").addSuccess(PanelCloudflareTunnelResponseSchema))
  .add(
    endpoint.post("startPanelCloudflareTunnel", "/cloudflare-tunnels/panel")
      .setPayload(StartPanelCloudflareTunnelRequestSchema)
      .addSuccess(PanelCloudflareTunnelResponseSchema, { status: 202 })
  )
  .add(endpoint.del("stopPanelCloudflareTunnel", "/cloudflare-tunnels/panel").addSuccess(PanelCloudflareTunnelResponseSchema))

export const DockerGitApi = HttpApi.make("docker-git")
  .annotate(OpenApi.Title, "docker-git API")
  .annotate(OpenApi.Version, "1.0.0")
  .annotate(OpenApi.Description, "Effect contract for docker-git JSON REST endpoints.")
  .addError(ApiErrorResponseSchema, { status: 400 })
  .addError(ApiErrorResponseSchema, { status: 401 })
  .addError(ApiErrorResponseSchema, { status: 404 })
  .addError(ApiErrorResponseSchema, { status: 409 })
  .addError(ApiErrorResponseSchema, { status: 500 })
  .add(CoreGroup)
  .add(ProjectsGroup)
  .add(ProjectPortsGroup)
  .add(ProjectBrowserGroup)
  .add(ProjectDatabasesGroup)
  .add(AuthGroup)
  .add(ProjectAuthGroup)
  .add(TerminalGroup)
  .add(PromptsGroup)
  .add(SkillsGroup)
  .add(TasksGroup)
  .add(SharingGroup)

/**
 * Builds the OpenAPI document from the Effect HttpApi contract.
 *
 * @returns OpenAPI 3.1 specification for JSON REST endpoints.
 *
 * @pure true - deterministic projection from the static Effect contract.
 * @effect none
 * @invariant every documented path is derived from DockerGitApi, not hand-written JSON.
 * @precondition DockerGitApi is importable without starting the HTTP server.
 * @postcondition the returned spec has openapi = "3.1.0".
 * @complexity O(n) time / O(n) space where n is the number of endpoints and schemas.
 * @throws Never.
 */
// CHANGE: derive Swagger/OpenAPI from the Effect HttpApi contract.
// WHY: frontend clients must be generated from one typed REST contract.
// QUOTE(ТЗ): "Надо сделать REST API нормальный на базе Effect и использовать Swagger."
// REF: user-message-2026-06-18-openapi-fetch
// SOURCE: https://openapi-ts.dev/openapi-fetch/
// FORMAT THEOREM: forall endpoint e in DockerGitApi, e is represented in buildDockerGitOpenApi().paths.
// PURITY: CORE
// EFFECT: none
// INVARIANT: spec = OpenApi.fromApi(DockerGitApi).
// COMPLEXITY: O(n)/O(n)
export const buildDockerGitOpenApi = (): OpenApi.OpenAPISpec =>
  OpenApi.fromApi(DockerGitApi, { additionalPropertiesStrategy: "strict" })

import * as Schema from "@effect/schema/Schema"

import { TerminalSessionSchema } from "../shared/terminal-session-schema.js"

export { ApiEventSchema, ProjectEventsPollResponseSchema } from "./api-events-schema.js"
export {
  ProjectPromptFileSchema,
  ProjectPromptKindSchema,
  ProjectPromptsResponseSchema,
  ProjectPromptsSnapshotSchema,
  ProjectPromptUpdateResponseSchema
} from "./api-prompts-schema.js"
export { SkillerLaunchResponseSchema } from "./api-skiller-schema.js"
export {
  ProjectSkillFileSchema,
  ProjectSkillScopeInfoSchema,
  ProjectSkillScopeSchema,
  ProjectSkillsResponseSchema,
  ProjectSkillsSnapshotSchema,
  ProjectSkillUpdateResponseSchema
} from "./api-skills-schema.js"
export {
  ContainerTaskKindSchema,
  ContainerTaskSchema,
  ContainerTaskSnapshotResponseSchema,
  ContainerTaskSnapshotSchema
} from "./api-task-schema.js"

const NullableString = Schema.NullOr(Schema.String)

export const ProjectStatusSchema = Schema.Union(
  Schema.Literal("running"),
  Schema.Literal("stopped"),
  Schema.Literal("unknown")
)

const projectSummaryFields = {
  id: Schema.String,
  projectKey: Schema.String,
  displayName: Schema.String,
  repoUrl: Schema.String,
  repoRef: Schema.String,
  containerName: Schema.optional(Schema.String),
  status: ProjectStatusSchema,
  statusLabel: Schema.String,
  sshSessions: Schema.Number,
  startedAtIso: NullableString,
  startedAtEpochMs: Schema.NullOr(Schema.Number),
  clonedOnHostname: Schema.optional(Schema.String)
}

export const ProjectSummarySchema = Schema.Struct(projectSummaryFields)

export const ProjectDetailsSchema = Schema.Struct({
  ...projectSummaryFields,
  containerName: Schema.String,
  serviceName: Schema.String,
  sshUser: Schema.String,
  sshPort: Schema.Number,
  targetDir: Schema.String,
  projectDir: Schema.String,
  sshCommand: Schema.String,
  authorizedKeysPath: Schema.String,
  authorizedKeysExists: Schema.Boolean,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  codexAuthPath: Schema.String,
  codexHome: Schema.String
})

export const HealthResponseSchema = Schema.Struct({
  ok: Schema.Boolean,
  revision: NullableString,
  cwd: Schema.String,
  projectsRoot: Schema.String
})

export const ProjectsResponseSchema = Schema.Struct({
  projects: Schema.Array(ProjectSummarySchema)
})

export const ProjectResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  project: ProjectDetailsSchema
})

export const CreateProjectAcceptedResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  projectId: Schema.String,
  cursor: Schema.Number
})

export const StartProjectTerminalSessionAcceptedResponseSchema = Schema.Struct({
  accepted: Schema.Literal(true),
  projectId: Schema.String,
  cursor: Schema.Number,
  requestId: Schema.String
})

const ProjectPublishedStatusSchema = Schema.Union(
  Schema.Literal("running"),
  Schema.Literal("stopped"),
  Schema.Literal("unknown")
)

export const ProjectPortForwardSchema = Schema.Struct({
  bindHost: Schema.String,
  containerName: Schema.String,
  createdAt: NullableString,
  hostPort: Schema.Number,
  id: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  proxyPath: Schema.String,
  publicHost: Schema.String,
  status: ProjectPublishedStatusSchema,
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

const ProjectSidecarStatusSchema = Schema.Union(
  Schema.Literal("running"),
  Schema.Literal("stopped"),
  Schema.Literal("missing"),
  Schema.Literal("unknown")
)

export const ProjectBrowserSessionSchema = Schema.Struct({
  cdpPath: Schema.String,
  cdpUrl: Schema.String,
  containerName: Schema.String,
  noVncPath: Schema.String,
  noVncUrl: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  status: ProjectSidecarStatusSchema
})

export const ProjectBrowserResponseSchema = Schema.Struct({
  browser: ProjectBrowserSessionSchema
})

export const ProjectDatabaseEngineSchema = Schema.Union(
  Schema.Literal("postgres"),
  Schema.Literal("mysql"),
  Schema.Literal("mariadb")
)

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

export const ProjectDatabaseProfilesResponseSchema = Schema.Struct({
  profiles: Schema.Array(ProjectDatabaseProfileSchema)
})

export const ProjectDatabaseProfileResponseSchema = Schema.Struct({
  profile: ProjectDatabaseProfileSchema
})

export const ProjectDatabaseSessionSchema = Schema.Struct({
  configHash: Schema.String,
  containerName: Schema.String,
  editorPath: Schema.String,
  editorUrl: Schema.String,
  projectId: Schema.String,
  projectKey: Schema.String,
  status: ProjectSidecarStatusSchema
})

export const ProjectDatabaseSessionResponseSchema = Schema.Struct({
  session: ProjectDatabaseSessionSchema
})

export const ProjectDatabaseForwardSchema = Schema.Struct({
  bindHost: Schema.String,
  containerName: Schema.String,
  createdAt: NullableString,
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
  status: ProjectPublishedStatusSchema,
  targetHost: Schema.String,
  targetPort: Schema.Number
})

export const ProjectDatabaseForwardsResponseSchema = Schema.Struct({
  forwards: Schema.Array(ProjectDatabaseForwardSchema)
})

export const ProjectDatabaseForwardResponseSchema = Schema.Struct({
  forward: ProjectDatabaseForwardSchema
})

export const OutputResponseSchema = Schema.Struct({
  output: Schema.String
})

export const GithubTokenStatusSchema = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  status: Schema.Union(
    Schema.Literal("valid"),
    Schema.Literal("invalid"),
    Schema.Literal("unknown")
  ),
  login: NullableString
})

export const GithubAuthStatusSchema = Schema.Struct({
  summary: Schema.String,
  tokens: Schema.Array(GithubTokenStatusSchema)
})

export const GithubStatusResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  status: GithubAuthStatusSchema
})

export const AuthSnapshotSchema = Schema.Struct({
  globalEnvPath: Schema.String,
  claudeAuthPath: Schema.String,
  geminiAuthPath: Schema.String,
  totalEntries: Schema.Number,
  githubTokenEntries: Schema.Number,
  gitTokenEntries: Schema.Number,
  gitUserEntries: Schema.Number,
  claudeAuthEntries: Schema.Number,
  geminiAuthEntries: Schema.Number
})

export const AuthSnapshotResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: AuthSnapshotSchema
})

export const ProjectAuthSnapshotSchema = Schema.Struct({
  projectDir: Schema.String,
  projectName: Schema.String,
  envGlobalPath: Schema.String,
  envProjectPath: Schema.String,
  claudeAuthPath: Schema.String,
  geminiAuthPath: Schema.String,
  githubTokenEntries: Schema.Number,
  gitTokenEntries: Schema.Number,
  claudeAuthEntries: Schema.Number,
  geminiAuthEntries: Schema.Number,
  activeGithubLabel: NullableString,
  activeGitLabel: NullableString,
  activeClaudeLabel: NullableString,
  activeGeminiLabel: NullableString
})

export const ProjectAuthSnapshotResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  snapshot: ProjectAuthSnapshotSchema
})

export const TerminalSessionResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  project: ProjectDetailsSchema,
  session: TerminalSessionSchema
})

export const ProjectTerminalSessionsResponseSchema = Schema.Struct({
  sessions: Schema.Array(TerminalSessionSchema)
})

export const ProjectTerminalSessionResponseSchema = Schema.Struct({
  session: TerminalSessionSchema
})

export const TerminalSessionLookupResponseSchema = Schema.Struct({
  projectDisplayName: Schema.String,
  projectKey: Schema.String,
  session: TerminalSessionSchema
})

export const AuthTerminalSessionResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  session: TerminalSessionSchema
})

export { TerminalServerMessageSchema } from "../shared/terminal-session-schema.js"
export type {
  ApiEvent,
  AuthMenuFlow,
  AuthSnapshot,
  ContainerTask,
  ContainerTaskSnapshot,
  CreateProjectAcceptedResponse,
  CreateProjectDraft,
  DashboardData,
  GithubAuthStatus,
  ProjectAuthFlow,
  ProjectAuthSnapshot,
  ProjectBrowserSession,
  ProjectDatabaseForward,
  ProjectDatabaseProfile,
  ProjectDatabaseSession,
  ProjectDetails,
  ProjectPortForward,
  ProjectPromptFile,
  ProjectPromptKind,
  ProjectPromptsSnapshot,
  ProjectSkillFile,
  ProjectSkillScope,
  ProjectSkillScopeInfo,
  ProjectSkillsSnapshot,
  ProjectSummary,
  ProjectTerminalSessionLookup,
  StartProjectTerminalSessionAccepted,
  TerminalServerMessage,
  TerminalSession
} from "./api-types.js"

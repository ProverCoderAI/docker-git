import * as Schema from "@effect/schema/Schema"

import { NullableString } from "./api-project-schema.js"

export {
  AuthSnapshotResponseSchema,
  AuthSnapshotSchema,
  CodexAuthStatusSchema,
  CodexStatusResponseSchema,
  GithubAuthStatusSchema,
  GithubStatusResponseSchema,
  GithubTokenStatusSchema,
  ProjectAuthSnapshotResponseSchema,
  ProjectAuthSnapshotSchema
} from "./api-auth-schema.js"
export { ApiEventSchema, ProjectEventsPollResponseSchema } from "./api-events-schema.js"
export {
  HealthResponseSchema,
  ProjectDetailsSchema,
  ProjectResponseSchema,
  ProjectsResponseSchema,
  ProjectStatusSchema,
  ProjectSummarySchema
} from "./api-project-schema.js"
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
export {
  AuthTerminalSessionResponseSchema,
  ProjectTerminalSessionResponseSchema,
  ProjectTerminalSessionsResponseSchema,
  TerminalServerMessageSchema,
  TerminalSessionLookupResponseSchema,
  TerminalSessionResponseSchema
} from "./api-terminal-schema.js"

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

export const PanelCloudflareTunnelStatusSchema = Schema.Union(
  Schema.Literal("starting"),
  Schema.Literal("running"),
  Schema.Literal("stopped"),
  Schema.Literal("failed")
)

export const PanelCloudflareTunnelSessionSchema = Schema.Struct({
  error: NullableString,
  id: Schema.String,
  logTail: Schema.Array(Schema.String),
  panelUrl: Schema.String,
  publicUrl: NullableString,
  startedAt: Schema.String,
  status: PanelCloudflareTunnelStatusSchema,
  stoppedAt: NullableString
})

export const PanelCloudflareTunnelResponseSchema = Schema.Struct({
  tunnel: Schema.NullOr(PanelCloudflareTunnelSessionSchema)
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
  PanelCloudflareTunnelSession,
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

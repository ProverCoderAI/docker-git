import * as Schema from "@effect/schema/Schema"

import { JsonValueSchema } from "../shared/json-schema.js"
import { TerminalSessionSchema } from "../shared/terminal-session-schema.js"

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
  status: Schema.Union(
    Schema.Literal("running"),
    Schema.Literal("stopped"),
    Schema.Literal("unknown")
  ),
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

export const AuthTerminalSessionResponseSchema = Schema.Struct({
  ok: Schema.optional(Schema.Boolean),
  session: TerminalSessionSchema
})

export const ApiEventSchema = Schema.Struct({
  seq: Schema.Number,
  projectId: Schema.String,
  type: Schema.Union(
    Schema.Literal("snapshot"),
    Schema.Literal("project.created"),
    Schema.Literal("project.deleted"),
    Schema.Literal("project.deployment.status"),
    Schema.Literal("project.deployment.log"),
    Schema.Literal("project.ssh.session"),
    Schema.Literal("agent.started"),
    Schema.Literal("agent.output"),
    Schema.Literal("agent.exited"),
    Schema.Literal("agent.stopped"),
    Schema.Literal("agent.error")
  ),
  at: Schema.String,
  payload: JsonValueSchema
})

export const ProjectEventsPollResponseSchema = Schema.Struct({
  cursor: Schema.Number,
  events: Schema.Array(ApiEventSchema)
})

export type ProjectSummary = Schema.Schema.Type<typeof ProjectSummarySchema>
export type ProjectDetails = Schema.Schema.Type<typeof ProjectDetailsSchema>
export type ProjectPortForward = Schema.Schema.Type<typeof ProjectPortForwardSchema>
export type GithubAuthStatus = Schema.Schema.Type<typeof GithubAuthStatusSchema>
export type AuthSnapshot = Schema.Schema.Type<typeof AuthSnapshotSchema>
export type ProjectAuthSnapshot = Schema.Schema.Type<typeof ProjectAuthSnapshotSchema>
export type ApiEvent = Schema.Schema.Type<typeof ApiEventSchema>

export type DashboardData = {
  readonly apiBaseUrl: string
  readonly health: Schema.Schema.Type<typeof HealthResponseSchema>
  readonly projects: ReadonlyArray<ProjectSummary>
}

export type CreateProjectDraft = {
  readonly repoUrl: string
  readonly repoRef: string
  readonly outDir: string
  readonly cpuLimit: string
  readonly ramLimit: string
  readonly enableMcpPlaywright: boolean
  readonly force: boolean
  readonly forceEnv: boolean
  readonly up: boolean
}

export type AuthMenuFlow =
  | "GithubRemove"
  | "GitSet"
  | "GitRemove"
  | "ClaudeLogout"
  | "GeminiApiKey"
  | "GeminiLogout"

export type ProjectAuthFlow =
  | "ProjectGithubConnect"
  | "ProjectGithubDisconnect"
  | "ProjectGitConnect"
  | "ProjectGitDisconnect"
  | "ProjectClaudeConnect"
  | "ProjectClaudeDisconnect"
  | "ProjectGeminiConnect"
  | "ProjectGeminiDisconnect"

export {
  type TerminalServerMessage,
  TerminalServerMessageSchema,
  type TerminalSession
} from "../shared/terminal-session-schema.js"

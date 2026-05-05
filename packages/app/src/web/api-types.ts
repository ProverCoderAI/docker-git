import type * as Schema from "@effect/schema/Schema"

import type {
  AuthSnapshotSchema,
  ContainerTaskSchema,
  ContainerTaskSnapshotSchema,
  CreateProjectAcceptedResponseSchema,
  GithubAuthStatusSchema,
  HealthResponseSchema,
  ProjectAuthSnapshotSchema,
  ProjectBrowserSessionSchema,
  ProjectDatabaseForwardSchema,
  ProjectDatabaseProfileSchema,
  ProjectDatabaseSessionSchema,
  ProjectDetailsSchema,
  ProjectEventsPollResponseSchema,
  ProjectPortForwardSchema,
  ProjectSummarySchema,
  TerminalSessionLookupResponseSchema
} from "./api-schema.js"

export type ProjectSummary = Schema.Schema.Type<typeof ProjectSummarySchema>
export type ProjectDetails = Schema.Schema.Type<typeof ProjectDetailsSchema>
export type CreateProjectAcceptedResponse = Schema.Schema.Type<typeof CreateProjectAcceptedResponseSchema>
export type ProjectPortForward = Schema.Schema.Type<typeof ProjectPortForwardSchema>
export type ProjectBrowserSession = Schema.Schema.Type<typeof ProjectBrowserSessionSchema>
export type ProjectDatabaseForward = Schema.Schema.Type<typeof ProjectDatabaseForwardSchema>
export type ProjectDatabaseProfile = Schema.Schema.Type<typeof ProjectDatabaseProfileSchema>
export type ProjectDatabaseSession = Schema.Schema.Type<typeof ProjectDatabaseSessionSchema>
export type ProjectTerminalSessionLookup = Schema.Schema.Type<typeof TerminalSessionLookupResponseSchema>
export type GithubAuthStatus = Schema.Schema.Type<typeof GithubAuthStatusSchema>
export type AuthSnapshot = Schema.Schema.Type<typeof AuthSnapshotSchema>
export type ProjectAuthSnapshot = Schema.Schema.Type<typeof ProjectAuthSnapshotSchema>
export type ApiEvent = Schema.Schema.Type<typeof ProjectEventsPollResponseSchema>["events"][number]
export type ContainerTask = Schema.Schema.Type<typeof ContainerTaskSchema>
export type ContainerTaskSnapshot = Schema.Schema.Type<typeof ContainerTaskSnapshotSchema>

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

export { type TerminalServerMessage, type TerminalSession } from "../shared/terminal-session-schema.js"

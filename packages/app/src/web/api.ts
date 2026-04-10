import { Effect } from "effect"

import type { AuthMenuRequestBody, ProjectAuthMenuRequestBody } from "../shared/auth-menu-request.js"
import { requestJson, requestText, resolveApiBaseUrl } from "./api-http.js"
import {
  AuthSnapshotResponseSchema,
  AuthTerminalSessionResponseSchema,
  GithubStatusResponseSchema,
  HealthResponseSchema,
  OutputResponseSchema,
  ProjectAuthSnapshotResponseSchema,
  ProjectEventsPollResponseSchema,
  ProjectResponseSchema,
  ProjectsResponseSchema,
  TerminalSessionResponseSchema
} from "./api-schema.js"
import type { AuthMenuFlow, CreateProjectDraft, DashboardData, ProjectAuthFlow } from "./api-schema.js"

export type {
  ApiEvent,
  AuthMenuFlow,
  AuthSnapshot,
  CreateProjectDraft,
  DashboardData,
  GithubAuthStatus,
  ProjectAuthFlow,
  ProjectAuthSnapshot,
  ProjectDetails,
  ProjectSummary,
  TerminalSession
} from "./api-schema.js"

export const loadDashboard = (): Effect.Effect<DashboardData, string> =>
  Effect.all({
    health: requestJson("GET", "/health", HealthResponseSchema),
    projectsResponse: requestJson("GET", "/projects", ProjectsResponseSchema)
  }).pipe(
    Effect.map(({ health, projectsResponse }) => ({
      apiBaseUrl: resolveApiBaseUrl(),
      health,
      projects: projectsResponse.projects
    }))
  )

export const loadProjectDetails = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}`, ProjectResponseSchema).pipe(
    Effect.map((response) => response.project)
  )

export const loadProjectPs = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/ps`, OutputResponseSchema).pipe(
    Effect.map((response) => response.output)
  )

export const loadProjectLogs = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/logs`, OutputResponseSchema).pipe(
    Effect.map((response) => response.output)
  )

export const createProject = (draft: CreateProjectDraft) =>
  requestJson(
    "POST",
    "/projects",
    ProjectResponseSchema,
    { ...draft, openSsh: false, useManagedAuthorizedKeys: true }
  ).pipe(
    Effect.map((response) => response.project)
  )

export const upProject = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/up`,
    ProjectResponseSchema,
    { useManagedAuthorizedKeys: true }
  ).pipe(
    Effect.map((response) => response.project)
  )

export const createProjectTerminalSession = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/terminal-sessions`,
    TerminalSessionResponseSchema
  ).pipe(
    Effect.map((response) => ({
      project: response.project,
      session: response.session
    }))
  )

export const createAuthTerminalSession = (
  flow: "ClaudeOauth" | "GeminiOauth",
  label: string | null
) =>
  requestJson(
    "POST",
    "/auth/terminal-sessions",
    AuthTerminalSessionResponseSchema,
    { flow, label }
  ).pipe(
    Effect.map((response) => response.session)
  )

export const deleteProjectTerminalSession = (
  projectId: string,
  sessionId: string
) =>
  requestText("DELETE", `/projects/${encodeURIComponent(projectId)}/terminal-sessions/${encodeURIComponent(sessionId)}`)
    .pipe(
      Effect.asVoid
    )

export const deleteTerminalSessionByPath = (path: string) => requestText("DELETE", path).pipe(Effect.asVoid)

export const downProject = (projectId: string) =>
  requestText("POST", `/projects/${encodeURIComponent(projectId)}/down`).pipe(Effect.asVoid)

export const deleteProject = (projectId: string) =>
  requestText("DELETE", `/projects/${encodeURIComponent(projectId)}`).pipe(Effect.asVoid)

export const downAllProjects = () => requestText("POST", "/projects/down-all").pipe(Effect.asVoid)

export const loadGithubStatus = () =>
  requestJson("GET", "/auth/github/status", GithubStatusResponseSchema).pipe(
    Effect.map((response) => response.status)
  )

export const loginGithub = (label: string | null) =>
  requestJson("POST", "/auth/github/login", GithubStatusResponseSchema, { label }).pipe(
    Effect.map((response) => response.status)
  )

export const loadProjectEvents = (
  projectId: string,
  cursor?: number
) =>
  requestJson(
    "GET",
    cursor === undefined
      ? `/projects/${encodeURIComponent(projectId)}/events-poll`
      : `/projects/${encodeURIComponent(projectId)}/events-poll?cursor=${cursor}`,
    ProjectEventsPollResponseSchema
  )

export const loadAuthSnapshot = () =>
  requestJson("GET", "/auth/menu", AuthSnapshotResponseSchema).pipe(
    Effect.map((response) => response.snapshot)
  )

export const runAuthMenuFlow = (request: AuthMenuRequestBody & { readonly flow: AuthMenuFlow }) =>
  requestJson("POST", "/auth/menu", AuthSnapshotResponseSchema, request).pipe(
    Effect.map((response) => response.snapshot)
  )

export const loadProjectAuthSnapshot = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/auth/menu`,
    ProjectAuthSnapshotResponseSchema
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const runProjectAuthFlow = (
  projectId: string,
  request: ProjectAuthMenuRequestBody & { readonly flow: ProjectAuthFlow }
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/auth/menu`,
    ProjectAuthSnapshotResponseSchema,
    request
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export { resolveApiBaseUrl } from "./api-http.js"

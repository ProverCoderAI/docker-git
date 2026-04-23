import { Effect } from "effect"

import { sortSelectItemsByLaunchTime } from "../docker-git/menu-select-order.js"
import type { SelectProjectRuntime } from "../docker-git/menu-types.js"
import type { AuthMenuRequestBody, ProjectAuthMenuRequestBody } from "../shared/auth-menu-request.js"
import { requestJson, requestText, requestTextStream, resolveApiBaseUrl } from "./api-http.js"
import {
  AuthSnapshotResponseSchema,
  AuthTerminalSessionResponseSchema,
  ContainerTaskSnapshotResponseSchema,
  GithubStatusResponseSchema,
  HealthResponseSchema,
  OutputResponseSchema,
  ProjectAuthSnapshotResponseSchema,
  ProjectBrowserResponseSchema,
  ProjectDatabaseForwardResponseSchema,
  ProjectDatabaseForwardsResponseSchema,
  ProjectDatabaseProfileResponseSchema,
  ProjectDatabaseProfilesResponseSchema,
  ProjectDatabaseSessionResponseSchema,
  ProjectEventsPollResponseSchema,
  ProjectPortForwardResponseSchema,
  ProjectPortForwardsResponseSchema,
  ProjectsResponseSchema,
  TerminalSessionResponseSchema
} from "./api-schema.js"
import type {
  AuthMenuFlow,
  DashboardData,
  ProjectAuthFlow,
  ProjectBrowserSession,
  ProjectDatabaseForward,
  ProjectDatabaseSession,
  ProjectPortForward,
  ProjectSummary
} from "./api-schema.js"

export { startCreateProject } from "./api-create-project.js"
export { createProject, loadProjectDetails, loadProjectLogs, loadProjectPs, upProject } from "./api-project-core.js"

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
  ProjectSummary,
  TerminalSession
} from "./api-schema.js"

export const projectPortForwardProxyUrl = (forward: ProjectPortForward): string =>
  `${resolveApiBaseUrl()}${forward.proxyPath}`

export const projectBrowserNoVncUrl = (browser: ProjectBrowserSession): string => browser.noVncPath

export const projectBrowserCdpUrl = (browser: ProjectBrowserSession): string => browser.cdpPath

export const projectDatabaseEditorUrl = (session: ProjectDatabaseSession): string => session.editorPath

export const projectDatabaseExternalUrl = (forward: ProjectDatabaseForward): string =>
  `${forward.publicHost}:${forward.hostPort}`

const dashboardRuntimeByProject = (
  projects: ReadonlyArray<ProjectSummary>
): Readonly<Record<string, SelectProjectRuntime>> =>
  Object.fromEntries(
    projects.map((project) => [
      project.id,
      {
        running: project.status === "running",
        sshSessions: project.sshSessions,
        startedAtIso: project.startedAtIso,
        startedAtEpochMs: project.startedAtEpochMs
      }
    ])
  )

// CHANGE: keep WEB `/select/` project order identical to CLI Select
// WHY: both surfaces must use the same launch-time ordering and tie-breakers
// QUOTE(ТЗ): "мы можем иметь 1 в 1 логику что в CLI что на WEB?"
// REF: user-message-2026-04-21-unify-cli-web-select
// SOURCE: n/a
// FORMAT THEOREM: forall projects: web_order(projects) = select_order(projects)
// PURITY: CORE
// EFFECT: none
// INVARIANT: loadDashboard returns projects ordered by the shared select comparator
// COMPLEXITY: O(n log n)
export const sortDashboardProjects = (
  projects: ReadonlyArray<ProjectSummary>
): ReadonlyArray<ProjectSummary> =>
  sortSelectItemsByLaunchTime(projects, dashboardRuntimeByProject(projects), {
    displayName: (project) => project.displayName,
    projectKey: (project) => project.id
  })

export const loadDashboard = (): Effect.Effect<DashboardData, string> =>
  Effect.all({
    health: requestJson("GET", "/health", HealthResponseSchema),
    projectsResponse: requestJson("GET", "/projects", ProjectsResponseSchema)
  }).pipe(
    Effect.map(({ health, projectsResponse }) => ({
      apiBaseUrl: resolveApiBaseUrl(),
      health,
      projects: sortDashboardProjects(projectsResponse.projects)
    }))
  )

export const loadProjectPortForwards = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/ports`, ProjectPortForwardsResponseSchema).pipe(
    Effect.map((response) => response.forwards)
  )

export const loadProjectBrowser = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/browser`, ProjectBrowserResponseSchema).pipe(
    Effect.map((response) => response.browser)
  )

export const loadProjectTasks = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/tasks`,
    ContainerTaskSnapshotResponseSchema
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const stopProjectTask = (
  projectId: string,
  pid: number
) =>
  requestText(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/tasks/${pid}/stop`
  ).pipe(Effect.asVoid)

export const loadProjectTaskLogs = (
  projectId: string,
  pid: number,
  lines = 200
) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/tasks/${pid}/logs?lines=${lines}`,
    OutputResponseSchema
  ).pipe(
    Effect.map((response) => response.output)
  )

export const loadProjectDatabaseProfiles = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles`,
    ProjectDatabaseProfilesResponseSchema
  ).pipe(
    Effect.map((response) => response.profiles)
  )

export const loadProjectDatabaseForwards = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/databases/forwards`,
    ProjectDatabaseForwardsResponseSchema
  ).pipe(
    Effect.map((response) => response.forwards)
  )

export const saveProjectDatabaseProfile = (
  projectId: string,
  connectionString: string,
  label: string | null
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles`,
    ProjectDatabaseProfileResponseSchema,
    { connectionString, label }
  ).pipe(
    Effect.map((response) => response.profile)
  )

export const deleteProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) =>
  requestText(
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles/${encodeURIComponent(profileId)}`
  ).pipe(Effect.asVoid)

export const exposeProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles/${encodeURIComponent(profileId)}/expose`,
    ProjectDatabaseForwardResponseSchema
  ).pipe(
    Effect.map((response) => response.forward)
  )

export const deleteProjectDatabaseForward = (
  projectId: string,
  profileId: string
) =>
  requestText(
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles/${encodeURIComponent(profileId)}/expose`
  ).pipe(Effect.asVoid)

export const loadProjectDatabaseSession = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/databases/session`,
    ProjectDatabaseSessionResponseSchema
  ).pipe(
    Effect.map((response) => response.session)
  )

export const openProjectDatabaseEditor = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/open`,
    ProjectDatabaseSessionResponseSchema
  ).pipe(
    Effect.map((response) => response.session)
  )

export const restartProjectDatabaseEditor = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/restart`,
    ProjectDatabaseSessionResponseSchema
  ).pipe(
    Effect.map((response) => response.session)
  )

export const createProjectPortForward = (
  projectId: string,
  targetPort: number,
  hostPort?: number
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/ports`,
    ProjectPortForwardResponseSchema,
    hostPort === undefined ? { targetPort } : { hostPort, targetPort }
  ).pipe(
    Effect.map((response) => response.forward)
  )

export const deleteProjectPortForward = (
  projectId: string,
  targetPort: number
) => requestText("DELETE", `/projects/${encodeURIComponent(projectId)}/ports/${targetPort}`).pipe(Effect.asVoid)

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

export const loginGithubStream = (label: string | null, onChunk: (chunk: string) => void) =>
  requestTextStream({
    body: { label, token: null },
    method: "POST",
    onChunk,
    path: "/auth/github/login/stream"
  })

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

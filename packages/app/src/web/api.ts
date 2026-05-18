import { Effect } from "effect"

import { sortSelectItemsByLaunchTime } from "../docker-git/menu-select-order.js"
import type { SelectProjectRuntime } from "../docker-git/menu-types.js"
import type { AuthMenuRequestBody, ProjectAuthMenuRequestBody } from "../shared/auth-menu-request.js"
import { requestJson, requestText, requestTextStream, resolveApiBaseUrl } from "./api-http.js"
import {
  AuthSnapshotResponseSchema,
  AuthTerminalSessionResponseSchema,
  GithubStatusResponseSchema,
  HealthResponseSchema,
  ProjectAuthSnapshotResponseSchema,
  ProjectBrowserResponseSchema,
  ProjectEventsPollResponseSchema,
  ProjectPortForwardResponseSchema,
  ProjectPortForwardsResponseSchema,
  ProjectsResponseSchema,
  ProjectTerminalSessionResponseSchema,
  ProjectTerminalSessionsResponseSchema,
  SkillerLaunchResponseSchema,
  StartProjectTerminalSessionAcceptedResponseSchema,
  TerminalSessionLookupResponseSchema,
  TerminalSessionResponseSchema
} from "./api-schema.js"
import type {
  AuthMenuFlow,
  DashboardData,
  ProjectAuthFlow,
  ProjectBrowserSession,
  ProjectPortForward,
  ProjectSummary
} from "./api-schema.js"

export { startCreateProject } from "./api-create-project.js"
export {
  deleteProjectDatabaseForward,
  deleteProjectDatabaseProfile,
  exposeProjectDatabaseProfile,
  loadProjectDatabaseForwards,
  loadProjectDatabaseProfiles,
  loadProjectDatabaseSession,
  openProjectDatabaseEditor,
  projectDatabaseEditorUrl,
  projectDatabaseExternalUrl,
  restartProjectDatabaseEditor,
  saveProjectDatabaseProfile
} from "./api-database.js"
export {
  applyProject,
  createProject,
  loadProjectDetails,
  loadProjectLogs,
  loadProjectPs,
  upProject
} from "./api-project-core.js"
export { deleteProjectPrompt, loadProjectPrompts, writeProjectPrompt } from "./api-prompts.js"
export { loadPanelCloudflareTunnel, startPanelCloudflareTunnel, stopPanelCloudflareTunnel } from "./api-share.js"
export { deleteProjectSkill, loadProjectSkills, projectSkillScopeToId, writeProjectSkill } from "./api-skills.js"
export { loadProjectTaskLogs, loadProjectTasks, stopProjectTask } from "./api-tasks.js"

export type * from "./api-types.js"

export const projectPortForwardProxyUrl = (forward: ProjectPortForward): string =>
  `${resolveApiBaseUrl()}${forward.proxyPath}`

export const projectBrowserNoVncUrl = (browser: ProjectBrowserSession): string => browser.noVncPath

export const projectBrowserCdpUrl = (browser: ProjectBrowserSession): string => browser.cdpPath

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

const openSkillerPath = (projectKey: string | undefined, sessionId: string | undefined): string => {
  if (projectKey !== undefined && sessionId !== undefined) {
    return `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions/${
      encodeURIComponent(sessionId)
    }/skiller/open`
  }
  return projectKey === undefined
    ? "/skiller/open"
    : `/projects/by-key/${encodeURIComponent(projectKey)}/skiller/open`
}

export const openSkiller = (projectKey?: string, sessionId?: string) =>
  requestJson(
    "POST",
    openSkillerPath(projectKey, sessionId),
    SkillerLaunchResponseSchema
  )

export const loadProjectPortForwards = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/ports`, ProjectPortForwardsResponseSchema).pipe(
    Effect.map((response) => response.forwards)
  )

export const loadProjectBrowser = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/browser`, ProjectBrowserResponseSchema).pipe(
    Effect.map((response) => response.browser)
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

export const createProjectTerminalSession = (projectKey: string) =>
  requestJson(
    "POST",
    `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions`,
    TerminalSessionResponseSchema
  ).pipe(
    Effect.map((response) => ({
      project: response.project,
      session: response.session
    }))
  )

export const startProjectTerminalSession = (
  projectKey: string,
  requestId: string
) =>
  requestJson(
    "POST",
    `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions/start`,
    StartProjectTerminalSessionAcceptedResponseSchema,
    { requestId }
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
  projectKey: string,
  sessionId: string
) =>
  requestText(
    "DELETE",
    `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions/${encodeURIComponent(sessionId)}`
  )
    .pipe(
      Effect.asVoid
    )

export const loadProjectTerminalSessions = (projectKey: string) =>
  requestJson(
    "GET",
    `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions`,
    ProjectTerminalSessionsResponseSchema
  ).pipe(
    Effect.map((response) => response.sessions)
  )

export const loadProjectTerminalWorkspace = (projectKey: string) =>
  requestJson(
    "GET",
    `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions`,
    ProjectTerminalSessionsResponseSchema
  )

export const setProjectActiveTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  requestJson(
    "PUT",
    `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions/active`,
    ProjectTerminalSessionResponseSchema,
    { sessionId }
  ).pipe(
    Effect.map((response) => response.session)
  )

export const loadProjectTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  requestJson(
    "GET",
    `/projects/by-key/${encodeURIComponent(projectKey)}/terminal-sessions/${encodeURIComponent(sessionId)}`,
    ProjectTerminalSessionResponseSchema
  ).pipe(
    Effect.map((response) => response.session)
  )

export const loadTerminalSessionById = (sessionId: string) =>
  requestJson(
    "GET",
    `/terminal-sessions/${encodeURIComponent(sessionId)}`,
    TerminalSessionLookupResponseSchema
  )

export const deleteTerminalSessionByPath = (path: string) => requestText("DELETE", path).pipe(Effect.asVoid)

export const downProject = (projectId: string) =>
  requestText("POST", `/projects/${encodeURIComponent(projectId)}/down`).pipe(Effect.asVoid)

export const deleteProject = (projectId: string) =>
  requestText("DELETE", `/projects/${encodeURIComponent(projectId)}`).pipe(Effect.asVoid)

export const downAllProjects = () => requestText("POST", "/projects/down-all").pipe(Effect.asVoid)

export const applyAllProjects = (activeOnly: boolean) =>
  requestText("POST", "/projects/apply-all", { activeOnly }).pipe(Effect.asVoid)

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

export { type PanelCloudflareTunnelSession } from "./api-schema.js"

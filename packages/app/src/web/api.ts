import { Effect } from "effect"

import { sortSelectItemsByLaunchTime } from "../docker-git/menu-select-order.js"
import type { SelectProjectRuntime } from "../docker-git/menu-types.js"
import type { AuthMenuRequestBody, ProjectAuthMenuRequestBody } from "../shared/auth-menu-request.js"
import { dockerGitOpenApi, requestJson, requestTextStream, resolveApiBaseUrl } from "./api-http.js"
import {
  AuthSnapshotResponseSchema,
  CodexStatusResponseSchema,
  GithubStatusResponseSchema,
  HealthResponseSchema,
  ProjectAuthSnapshotResponseSchema,
  ProjectBrowserResponseSchema,
  ProjectEventsPollResponseSchema,
  ProjectPortForwardResponseSchema,
  ProjectPortForwardsResponseSchema,
  ProjectsResponseSchema,
  SkillerLaunchResponseSchema
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
  resumeProject,
  suspendProject,
  upProject
} from "./api-project-core.js"
export type { ApplyProjectRequest, ProjectResourceLimitRequest } from "./api-project-core.js"
export { deleteProjectPrompt, loadProjectPrompts, writeProjectPrompt } from "./api-prompts.js"
export { loadPanelCloudflareTunnel, startPanelCloudflareTunnel, stopPanelCloudflareTunnel } from "./api-share.js"
export { deleteProjectSkill, loadProjectSkills, projectSkillScopeToId, writeProjectSkill } from "./api-skills.js"
export { loadProjectTaskLogs, loadProjectTasks, stopProjectTask } from "./api-tasks.js"
export {
  createAuthTerminalSession,
  createProjectTerminalSession,
  deleteAuthTerminalSession,
  deleteProjectTerminalSession,
  deleteTerminalSessionByPath,
  loadProjectTerminalSession,
  loadProjectTerminalSessions,
  loadProjectTerminalWorkspace,
  loadTerminalSessionById,
  setProjectActiveTerminalSession,
  startProjectTerminalSession
} from "./api-terminal.js"

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
    health: dockerGitOpenApi.openApiJsonSchema(HealthResponseSchema, (client) => client.GET("/health")),
    projectsResponse: dockerGitOpenApi.openApiJsonSchema(ProjectsResponseSchema, (client) => client.GET("/projects"))
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
  dockerGitOpenApi.openApiJsonSchema(
    ProjectPortForwardsResponseSchema,
    (client) =>
      client.GET("/projects/{projectId}/ports", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.forwards)
  )

export const loadProjectBrowser = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectBrowserResponseSchema,
    (client) =>
      client.GET("/projects/{projectId}/browser", {
        params: { path: { projectId } }
      })
  )
    .pipe(Effect.map((response) => response.browser))

export const startProjectBrowser = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectBrowserResponseSchema,
    (client) =>
      client.POST("/projects/{projectId}/browser/start", {
        params: { path: { projectId } }
      })
  )
    .pipe(Effect.map((response) => response.browser))

export const createProjectPortForward = (
  projectId: string,
  targetPort: number,
  hostPort?: number
) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectPortForwardResponseSchema,
    (client) =>
      client.POST("/projects/{projectId}/ports", {
        body: hostPort === undefined ? { targetPort } : { hostPort, targetPort },
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.forward)
  )

export const deleteProjectPortForward = (
  projectId: string,
  targetPort: number
) =>
  dockerGitOpenApi.openApiVoid((client) =>
    client.DELETE("/projects/{projectId}/ports/{targetPort}", {
      params: { path: { projectId, targetPort: String(targetPort) } }
    })
  )

export const downProject = (projectId: string) =>
  dockerGitOpenApi.openApiVoid((client) =>
    client.POST("/projects/{projectId}/down", {
      params: { path: { projectId } }
    })
  )

export const deleteProject = (projectId: string) =>
  dockerGitOpenApi.openApiVoid((client) =>
    client.DELETE("/projects/{projectId}", {
      params: { path: { projectId } }
    })
  )

export const downAllProjects = () => dockerGitOpenApi.openApiVoid((client) => client.POST("/projects/down-all"))

export const applyAllProjects = (shouldApplyActiveOnly: boolean) =>
  dockerGitOpenApi.openApiVoid((client) =>
    client.POST("/projects/apply-all", {
      body: { activeOnly: shouldApplyActiveOnly }
    })
  )

export const loadGithubStatus = () =>
  dockerGitOpenApi.openApiJsonSchema(GithubStatusResponseSchema, (client) => client.GET("/auth/github/status")).pipe(
    Effect.map((response) => response.status)
  )

export const loginGithub = (label: string | null) =>
  dockerGitOpenApi.openApiJsonSchema(GithubStatusResponseSchema, (client) =>
    client.POST("/auth/github/login", {
      body: { label }
    })).pipe(
      Effect.map((response) => response.status)
    )

export const loginGithubStream = (label: string | null, onChunk: (chunk: string) => void) =>
  requestTextStream({
    body: { label, token: null },
    method: "POST",
    onChunk,
    path: "/auth/github/login/stream"
  })

export const loginCodexStream = (label: string | null, onChunk: (chunk: string) => void) =>
  requestTextStream({
    body: { label },
    method: "POST",
    onChunk,
    path: "/auth/codex/login"
  })

export const logoutCodex = (label: string | null) =>
  dockerGitOpenApi.openApiJsonSchema(CodexStatusResponseSchema, (client) =>
    client.POST("/auth/codex/logout", {
      body: { label }
    })).pipe(Effect.asVoid)

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
  dockerGitOpenApi.openApiJsonSchema(AuthSnapshotResponseSchema, (client) => client.GET("/auth/menu")).pipe(
    Effect.map((response) => response.snapshot)
  )

export const runAuthMenuFlow = (request: AuthMenuRequestBody & { readonly flow: AuthMenuFlow }) =>
  dockerGitOpenApi.openApiJsonSchema(
    AuthSnapshotResponseSchema,
    (client) => client.POST("/auth/menu", { body: request })
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const loadProjectAuthSnapshot = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectAuthSnapshotResponseSchema,
    (client) =>
      client.GET("/projects/{projectId}/auth/menu", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const runProjectAuthFlow = (
  projectId: string,
  request: ProjectAuthMenuRequestBody & { readonly flow: ProjectAuthFlow }
) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectAuthSnapshotResponseSchema,
    (client) =>
      client.POST("/projects/{projectId}/auth/menu", {
        body: request,
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export { resolveApiBaseUrl } from "./api-http.js"

export { type PanelCloudflareTunnelSession } from "./api-schema.js"

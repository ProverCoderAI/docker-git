import { Effect } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import { normalizeProjectDetails, normalizeTerminalSession } from "./api-normalize.js"

export const createProjectTerminalSession = (projectKey: string) =>
  dockerGitOpenApi.POST("/projects/by-key/{projectKey}/terminal-sessions", {
    params: { path: { projectKey } }
  }).pipe(
    Effect.map(({ body }) => ({
      project: normalizeProjectDetails(body.project),
      session: normalizeTerminalSession(body.session)
    })),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const startProjectTerminalSession = (
  projectKey: string,
  requestId: string
) =>
  dockerGitOpenApi.POST("/projects/by-key/{projectKey}/terminal-sessions/start", {
    body: { requestId },
    params: { path: { projectKey } }
  }).pipe(
    Effect.map(({ body }) => body),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const createAuthTerminalSession = (
  flow: "ClaudeOauth" | "GeminiOauth" | "GrokOauth",
  label: string | null
) =>
  dockerGitOpenApi.POST("/auth/terminal-sessions", {
    body: { flow, label }
  }).pipe(
    Effect.map(({ body }) => normalizeTerminalSession(body.session)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const deleteProjectTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  dockerGitOpenApi.DELETE("/projects/by-key/{projectKey}/terminal-sessions/{sessionId}", {
    params: { path: { projectKey, sessionId } }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const deleteAuthTerminalSession = (sessionId: string) =>
  dockerGitOpenApi.DELETE("/auth/terminal-sessions/{sessionId}", {
    params: { path: { sessionId } }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// WHY: panel UI needs only the sessions array for list rendering.
// INVARIANT: this helper intentionally projects the full terminal workspace response to sessions.
export const loadProjectTerminalSessions = (projectKey: string) =>
  dockerGitOpenApi.GET("/projects/by-key/{projectKey}/terminal-sessions", {
    params: { path: { projectKey } }
  }).pipe(
    Effect.map(({ body }) => body.sessions.map((session) => normalizeTerminalSession(session))),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

// WHY: SSH-link initialization needs the full terminal workspace, including activeSessionId.
// INVARIANT: this helper intentionally preserves the complete response shape.
export const loadProjectTerminalWorkspace = (projectKey: string) =>
  dockerGitOpenApi.GET("/projects/by-key/{projectKey}/terminal-sessions", {
    params: { path: { projectKey } }
  }).pipe(
    Effect.map(({ body }) => ({
      activeSessionId: body.activeSessionId,
      sessions: body.sessions.map((session) => normalizeTerminalSession(session))
    })),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const setProjectActiveTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  dockerGitOpenApi.PUT("/projects/by-key/{projectKey}/terminal-sessions/active", {
    body: { sessionId },
    params: { path: { projectKey } }
  }).pipe(
    Effect.map(({ body }) => normalizeTerminalSession(body.session)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const loadProjectTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  dockerGitOpenApi.GET("/projects/by-key/{projectKey}/terminal-sessions/{sessionId}", {
    params: { path: { projectKey, sessionId } }
  }).pipe(
    Effect.map(({ body }) => normalizeTerminalSession(body.session)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const loadTerminalSessionById = (sessionId: string) =>
  dockerGitOpenApi.GET("/terminal-sessions/{sessionId}", {
    params: { path: { sessionId } }
  }).pipe(
    Effect.map(({ body }) => ({
      projectDisplayName: body.projectDisplayName,
      projectKey: body.projectKey,
      session: normalizeTerminalSession(body.session)
    })),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

const invalidTerminalClosePath = (path: string): string => `Invalid terminal close path: ${path}`

const authTerminalClosePathPattern = /^\/auth\/terminal-sessions\/([^/]+)$/u
const projectTerminalClosePathPattern = /^\/projects\/by-key\/([^/]+)\/terminal-sessions\/([^/]+)$/u

const decodeTerminalClosePathSegment = (
  segment: string,
  path: string
): Effect.Effect<string, string> =>
  Effect.try({
    try: () => decodeURIComponent(segment),
    catch: () => invalidTerminalClosePath(path)
  })

const readTerminalClosePathMatchSegment = (
  match: RegExpExecArray,
  index: number,
  path: string
): Effect.Effect<string, string> => {
  const segment = match[index]
  return segment === undefined
    ? Effect.fail(invalidTerminalClosePath(path))
    : decodeTerminalClosePathSegment(segment, path)
}

const deleteMatchedAuthTerminalSession = (
  match: RegExpExecArray,
  path: string
): Effect.Effect<void, string> =>
  readTerminalClosePathMatchSegment(match, 1, path).pipe(
    Effect.flatMap((sessionId) => deleteAuthTerminalSession(sessionId))
  )

const deleteMatchedProjectTerminalSession = (
  match: RegExpExecArray,
  path: string
): Effect.Effect<void, string> =>
  Effect.all({
    projectKey: readTerminalClosePathMatchSegment(match, 1, path),
    sessionId: readTerminalClosePathMatchSegment(match, 2, path)
  }).pipe(
    Effect.flatMap(({ projectKey, sessionId }) => deleteProjectTerminalSession(projectKey, sessionId))
  )

export const deleteTerminalSessionByPath = (path: string): Effect.Effect<void, string> => {
  const authMatch = authTerminalClosePathPattern.exec(path)
  if (authMatch !== null) {
    return deleteMatchedAuthTerminalSession(authMatch, path)
  }

  const projectMatch = projectTerminalClosePathPattern.exec(path)
  if (projectMatch !== null) {
    return deleteMatchedProjectTerminalSession(projectMatch, path)
  }

  return Effect.fail(invalidTerminalClosePath(path))
}

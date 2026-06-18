import { Effect } from "effect"

import {
  AuthTerminalSessionResponseSchema,
  ProjectTerminalSessionResponseSchema,
  ProjectTerminalSessionsResponseSchema,
  StartProjectTerminalSessionAcceptedResponseSchema,
  TerminalSessionLookupResponseSchema,
  TerminalSessionResponseSchema
} from "./api-schema.js"
import { openApiJsonSchema, openApiVoid } from "./openapi-client.js"

export const createProjectTerminalSession = (projectKey: string) =>
  openApiJsonSchema(
    TerminalSessionResponseSchema,
    (client) =>
      client.POST("/projects/by-key/{projectKey}/terminal-sessions", {
        params: { path: { projectKey } }
      })
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
  openApiJsonSchema(
    StartProjectTerminalSessionAcceptedResponseSchema,
    (client) =>
      client.POST("/projects/by-key/{projectKey}/terminal-sessions/start", {
        body: { requestId },
        params: { path: { projectKey } }
      })
  )

export const createAuthTerminalSession = (
  flow: "ClaudeOauth" | "GeminiOauth" | "GrokOauth",
  label: string | null
) =>
  openApiJsonSchema(AuthTerminalSessionResponseSchema, (client) =>
    client.POST("/auth/terminal-sessions", {
      body: { flow, label }
    })).pipe(
      Effect.map((response) => response.session)
    )

export const deleteProjectTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  openApiVoid((client) =>
    client.DELETE("/projects/by-key/{projectKey}/terminal-sessions/{sessionId}", {
      params: { path: { projectKey, sessionId } }
    })
  )

export const deleteAuthTerminalSession = (sessionId: string) =>
  openApiVoid((client) =>
    client.DELETE("/auth/terminal-sessions/{sessionId}", {
      params: { path: { sessionId } }
    })
  )

// WHY: panel UI needs only the sessions array for list rendering.
// INVARIANT: this helper intentionally projects the full terminal workspace response to sessions.
export const loadProjectTerminalSessions = (projectKey: string) =>
  openApiJsonSchema(
    ProjectTerminalSessionsResponseSchema,
    (client) =>
      client.GET("/projects/by-key/{projectKey}/terminal-sessions", {
        params: { path: { projectKey } }
      })
  ).pipe(
    Effect.map((response) => response.sessions)
  )

// WHY: SSH-link initialization needs the full terminal workspace, including activeSessionId.
// INVARIANT: this helper intentionally preserves the complete response shape.
export const loadProjectTerminalWorkspace = (projectKey: string) =>
  openApiJsonSchema(
    ProjectTerminalSessionsResponseSchema,
    (client) =>
      client.GET("/projects/by-key/{projectKey}/terminal-sessions", {
        params: { path: { projectKey } }
      })
  )

export const setProjectActiveTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  openApiJsonSchema(
    ProjectTerminalSessionResponseSchema,
    (client) =>
      client.PUT("/projects/by-key/{projectKey}/terminal-sessions/active", {
        body: { sessionId },
        params: { path: { projectKey } }
      })
  ).pipe(
    Effect.map((response) => response.session)
  )

export const loadProjectTerminalSession = (
  projectKey: string,
  sessionId: string
) =>
  openApiJsonSchema(
    ProjectTerminalSessionResponseSchema,
    (client) =>
      client.GET("/projects/by-key/{projectKey}/terminal-sessions/{sessionId}", {
        params: { path: { projectKey, sessionId } }
      })
  ).pipe(
    Effect.map((response) => response.session)
  )

export const loadTerminalSessionById = (sessionId: string) =>
  openApiJsonSchema(TerminalSessionLookupResponseSchema, (client) =>
    client.GET("/terminal-sessions/{sessionId}", {
      params: { path: { sessionId } }
    }))

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

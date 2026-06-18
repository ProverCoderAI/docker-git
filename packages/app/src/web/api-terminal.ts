import { Effect } from "effect"

import { requestText } from "./api-http.js"
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

export const deleteTerminalSessionByPath = (path: string) => requestText("DELETE", path).pipe(Effect.asVoid)

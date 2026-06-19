import { Effect } from "effect"

import { dockerGitOpenApi } from "./api-http.js"
import {
  ProjectDatabaseForwardResponseSchema,
  ProjectDatabaseForwardsResponseSchema,
  ProjectDatabaseProfileResponseSchema,
  ProjectDatabaseProfilesResponseSchema,
  ProjectDatabaseSessionResponseSchema
} from "./api-schema.js"
import type { ProjectDatabaseForward, ProjectDatabaseSession } from "./api-schema.js"

export const projectDatabaseEditorUrl = (session: ProjectDatabaseSession): string => session.editorPath

export const projectDatabaseExternalUrl = (forward: ProjectDatabaseForward): string =>
  `${forward.publicHost}:${forward.hostPort}`

export const loadProjectDatabaseProfiles = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectDatabaseProfilesResponseSchema,
    (client) =>
      client.GET("/projects/{projectId}/databases/profiles", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.profiles)
  )

export const loadProjectDatabaseForwards = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectDatabaseForwardsResponseSchema,
    (client) =>
      client.GET("/projects/{projectId}/databases/forwards", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.forwards)
  )

export const saveProjectDatabaseProfile = (
  projectId: string,
  connectionString: string,
  label: string | null
) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectDatabaseProfileResponseSchema,
    (client) =>
      client.POST("/projects/{projectId}/databases/profiles", {
        body: { connectionString, label },
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.profile)
  )

export const deleteProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) =>
  dockerGitOpenApi.openApiVoid((client) =>
    client.DELETE("/projects/{projectId}/databases/profiles/{profileId}", {
      params: { path: { profileId, projectId } }
    })
  )

export const exposeProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectDatabaseForwardResponseSchema,
    (client) =>
      client.POST("/projects/{projectId}/databases/profiles/{profileId}/expose", {
        params: { path: { profileId, projectId } }
      })
  ).pipe(
    Effect.map((response) => response.forward)
  )

export const deleteProjectDatabaseForward = (
  projectId: string,
  profileId: string
) =>
  dockerGitOpenApi.openApiVoid((client) =>
    client.DELETE("/projects/{projectId}/databases/profiles/{profileId}/expose", {
      params: { path: { profileId, projectId } }
    })
  )

export const loadProjectDatabaseSession = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectDatabaseSessionResponseSchema,
    (client) =>
      client.GET("/projects/{projectId}/databases/session", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.session)
  )

export const openProjectDatabaseEditor = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectDatabaseSessionResponseSchema,
    (client) =>
      client.POST("/projects/{projectId}/databases/open", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.session)
  )

export const restartProjectDatabaseEditor = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectDatabaseSessionResponseSchema,
    (client) =>
      client.POST("/projects/{projectId}/databases/restart", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.session)
  )

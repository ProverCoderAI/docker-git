import { Effect } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import type { ProjectDatabaseForward, ProjectDatabaseSession } from "./api-schema.js"

export const projectDatabaseEditorUrl = (session: ProjectDatabaseSession): string => session.editorPath

export const projectDatabaseExternalUrl = (forward: ProjectDatabaseForward): string =>
  `${forward.publicHost}:${forward.hostPort}`

export const loadProjectDatabaseProfiles = (projectId: string) =>
  dockerGitOpenApi.GET("/projects/{projectId}/databases/profiles", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.profiles),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const loadProjectDatabaseForwards = (projectId: string) =>
  dockerGitOpenApi.GET("/projects/{projectId}/databases/forwards", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.forwards),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const saveProjectDatabaseProfile = (
  projectId: string,
  connectionString: string,
  label: string | null
) =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/profiles", {
    body: { connectionString, label },
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.profile),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const deleteProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) =>
  dockerGitOpenApi.DELETE("/projects/{projectId}/databases/profiles/{profileId}", {
    params: { path: { profileId, projectId } }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const exposeProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/profiles/{profileId}/expose", {
    params: { path: { profileId, projectId } }
  }).pipe(
    Effect.map(({ body }) => body.forward),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const deleteProjectDatabaseForward = (
  projectId: string,
  profileId: string
) =>
  dockerGitOpenApi.DELETE("/projects/{projectId}/databases/profiles/{profileId}/expose", {
    params: { path: { profileId, projectId } }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const loadProjectDatabaseSession = (projectId: string) =>
  dockerGitOpenApi.GET("/projects/{projectId}/databases/session", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.session),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const openProjectDatabaseEditor = (projectId: string) =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/open", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.session),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const restartProjectDatabaseEditor = (projectId: string) =>
  dockerGitOpenApi.POST("/projects/{projectId}/databases/restart", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.session),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

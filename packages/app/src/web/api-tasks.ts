import { Effect } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"

export const loadProjectTasks = (projectId: string, shouldIncludeDefault = false) =>
  dockerGitOpenApi.GET("/projects/{projectId}/tasks", {
    params: {
      path: { projectId },
      query: shouldIncludeDefault ? { includeDefault: "true" } : {}
    }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const stopProjectTask = (
  projectId: string,
  pid: number
) =>
  dockerGitOpenApi.POST("/projects/{projectId}/tasks/{pid}/stop", {
    params: { path: { pid: String(pid), projectId } }
  }).pipe(
    Effect.asVoid,
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const loadProjectTaskLogs = (
  projectId: string,
  pid: number,
  lines = 200
) =>
  dockerGitOpenApi.GET("/projects/{projectId}/tasks/{pid}/logs", {
    params: {
      path: { pid: String(pid), projectId },
      query: { lines: String(lines) }
    }
  }).pipe(
    Effect.map(({ body }) => body.output),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

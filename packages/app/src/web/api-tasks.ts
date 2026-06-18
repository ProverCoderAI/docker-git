import { Effect } from "effect"

import { ContainerTaskSnapshotResponseSchema, OutputResponseSchema } from "./api-schema.js"
import { openApiJsonSchema, openApiVoid } from "./openapi-client.js"

export const loadProjectTasks = (projectId: string, shouldIncludeDefault = false) =>
  openApiJsonSchema(ContainerTaskSnapshotResponseSchema, (client) =>
    client.GET("/projects/{projectId}/tasks", {
      params: {
        path: { projectId },
        query: shouldIncludeDefault ? { includeDefault: "true" } : {}
      }
    })).pipe(
      Effect.map((response) => response.snapshot)
    )

export const stopProjectTask = (
  projectId: string,
  pid: number
) =>
  openApiVoid((client) =>
    client.POST("/projects/{projectId}/tasks/{pid}/stop", {
      params: { path: { pid: String(pid), projectId } }
    })
  )

export const loadProjectTaskLogs = (
  projectId: string,
  pid: number,
  lines = 200
) =>
  openApiJsonSchema(OutputResponseSchema, (client) =>
    client.GET("/projects/{projectId}/tasks/{pid}/logs", {
      params: {
        path: { pid: String(pid), projectId },
        query: { lines: String(lines) }
      }
    })).pipe(
      Effect.map((response) => response.output)
    )

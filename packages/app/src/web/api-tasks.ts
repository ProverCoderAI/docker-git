import { Effect } from "effect"

import { requestJson, requestText } from "./api-http.js"
import { ContainerTaskSnapshotResponseSchema, OutputResponseSchema } from "./api-schema.js"

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

import { Effect } from "effect"

import { requestJson } from "./api-http.js"
import { ProjectPromptsResponseSchema, ProjectPromptUpdateResponseSchema } from "./api-schema.js"
import type { ProjectPromptKind } from "./api-schema.js"

export const loadProjectPrompts = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/prompts`,
    ProjectPromptsResponseSchema
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const writeProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind,
  content: string
) =>
  requestJson(
    "PUT",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(kind)}`,
    ProjectPromptUpdateResponseSchema,
    { content }
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const deleteProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind
) =>
  requestJson(
    "DELETE",
    `/projects/${encodeURIComponent(projectId)}/prompts/${encodeURIComponent(kind)}`,
    ProjectPromptsResponseSchema
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

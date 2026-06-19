import { Effect } from "effect"

import { dockerGitOpenApi } from "./api-http.js"
import { ProjectPromptsResponseSchema, ProjectPromptUpdateResponseSchema } from "./api-schema.js"
import type { ProjectPromptKind } from "./api-schema.js"

export const loadProjectPrompts = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectPromptsResponseSchema,
    (client) =>
      client.GET("/projects/{projectId}/prompts", {
        params: { path: { projectId } }
      })
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const writeProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind,
  content: string
) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectPromptUpdateResponseSchema,
    (client) =>
      client.PUT("/projects/{projectId}/prompts/{kind}", {
        body: { content },
        params: { path: { kind, projectId } }
      })
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

export const deleteProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind
) =>
  dockerGitOpenApi.openApiJsonSchema(
    ProjectPromptsResponseSchema,
    (client) =>
      client.DELETE("/projects/{projectId}/prompts/{kind}", {
        params: { path: { kind, projectId } }
      })
  ).pipe(
    Effect.map((response) => response.snapshot)
  )

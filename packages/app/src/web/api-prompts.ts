import { Effect } from "effect"

import { ProjectPromptsResponseSchema, ProjectPromptUpdateResponseSchema } from "./api-schema.js"
import type { ProjectPromptKind } from "./api-schema.js"
import { openApiJsonSchema } from "./openapi-client.js"

export const loadProjectPrompts = (projectId: string) =>
  openApiJsonSchema(ProjectPromptsResponseSchema, (client) =>
    client.GET("/projects/{projectId}/prompts", {
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.snapshot)
    )

export const writeProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind,
  content: string
) =>
  openApiJsonSchema(ProjectPromptUpdateResponseSchema, (client) =>
    client.PUT("/projects/{projectId}/prompts/{kind}", {
      body: { content },
      params: { path: { kind, projectId } }
    })).pipe(
      Effect.map((response) => response.snapshot)
    )

export const deleteProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind
) =>
  openApiJsonSchema(ProjectPromptsResponseSchema, (client) =>
    client.DELETE("/projects/{projectId}/prompts/{kind}", {
      params: { path: { kind, projectId } }
    })).pipe(
      Effect.map((response) => response.snapshot)
    )

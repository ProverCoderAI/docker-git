import { Effect } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import type { ProjectPromptKind, ProjectPromptsSnapshot } from "./api-schema.js"

export const loadProjectPrompts = (projectId: string): Effect.Effect<ProjectPromptsSnapshot, string> =>
  dockerGitOpenApi.GET("/projects/{projectId}/prompts", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const writeProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind,
  content: string
): Effect.Effect<ProjectPromptsSnapshot, string> =>
  dockerGitOpenApi.PUT("/projects/{projectId}/prompts/{kind}", {
    body: { content },
    params: { path: { kind, projectId } }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const deleteProjectPrompt = (
  projectId: string,
  kind: ProjectPromptKind
): Effect.Effect<ProjectPromptsSnapshot, string> =>
  dockerGitOpenApi.DELETE("/projects/{projectId}/prompts/{kind}", {
    params: { path: { kind, projectId } }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

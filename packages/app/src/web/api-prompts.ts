import { Effect } from "effect"

import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import type { ProjectPromptKind } from "./api-schema.js"

export const loadProjectPrompts = (projectId: string) =>
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
) =>
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
) =>
  dockerGitOpenApi.DELETE("/projects/{projectId}/prompts/{kind}", {
    params: { path: { kind, projectId } }
  }).pipe(
    Effect.map(({ body }) => body.snapshot),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

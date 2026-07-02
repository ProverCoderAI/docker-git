import { Effect, Match } from "effect"

import type { ApplyProjectRequest } from "../shared/project-resource-request.js"
import { dockerGitOpenApi, renderDockerGitOpenApiFailure } from "./api-http.js"
import { normalizeProjectDetails } from "./api-normalize.js"
import {
  baseCreateProjectBody,
  type CreateProjectRequestDraft,
  optionalProjectResourceFields
} from "./api-project-create-body.js"

export type { ApplyProjectRequest, ProjectResourceLimitRequest } from "../shared/project-resource-request.js"
export type { CreateProjectRequestDraft } from "./api-project-create-body.js"

const applyProjectBody = (request: ApplyProjectRequest | undefined) => ({
  ...(request?.cpuLimit !== undefined && { cpuLimit: request.cpuLimit }),
  ...(request?.gpu !== undefined && { gpu: request.gpu }),
  ...(request?.ramLimit !== undefined && { ramLimit: request.ramLimit }),
  ...(request !== undefined && optionalProjectResourceFields(request))
})

const createProjectBody = (draft: CreateProjectRequestDraft) => ({
  ...baseCreateProjectBody(draft),
  ...optionalProjectResourceFields(draft)
})

export const loadProjectDetails = (projectId: string) =>
  dockerGitOpenApi.GET("/projects/{projectId}", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => normalizeProjectDetails(body.project)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const loadProjectPs = (projectId: string) =>
  dockerGitOpenApi.GET("/projects/{projectId}/ps", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.output),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const loadProjectLogs = (projectId: string) =>
  dockerGitOpenApi.GET("/projects/{projectId}/logs", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => body.output),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const applyProject = (
  projectId: string,
  request?: ApplyProjectRequest
) =>
  dockerGitOpenApi.POST("/projects/{projectId}/apply", {
    body: applyProjectBody(request),
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => normalizeProjectDetails(body.project)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const createProject = (draft: CreateProjectRequestDraft) =>
  dockerGitOpenApi.POST("/projects", {
    body: createProjectBody(draft)
  }).pipe(
    Effect.mapError(renderDockerGitOpenApiFailure),
    Effect.flatMap((success) =>
      Match.value(success).pipe(
        Match.when({ status: 201 }, ({ body }) => Effect.succeed(normalizeProjectDetails(body.project))),
        Match.when({ status: 202 }, () => Effect.fail("HTTP 202: unexpected async project creation response")),
        Match.exhaustive
      )
    )
  )

export const upProject = (projectId: string) =>
  dockerGitOpenApi.POST("/projects/{projectId}/up", {
    body: { useManagedAuthorizedKeys: true },
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => normalizeProjectDetails(body.project)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const resumeProject = (projectId: string) =>
  dockerGitOpenApi.POST("/projects/{projectId}/resume", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => normalizeProjectDetails(body.project)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

export const suspendProject = (projectId: string) =>
  dockerGitOpenApi.POST("/projects/{projectId}/suspend", {
    params: { path: { projectId } }
  }).pipe(
    Effect.map(({ body }) => normalizeProjectDetails(body.project)),
    Effect.mapError(renderDockerGitOpenApiFailure)
  )

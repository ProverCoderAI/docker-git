import { Effect } from "effect"

import type { ApplyProjectRequest } from "../shared/project-resource-request.js"
import { dockerGitOpenApi } from "./api-http.js"
import {
  baseCreateProjectBody,
  type CreateProjectRequestDraft,
  optionalProjectResourceFields
} from "./api-project-create-body.js"
import { OutputResponseSchema, ProjectResponseSchema } from "./api-schema.js"

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
  dockerGitOpenApi.openApiJsonSchema(ProjectResponseSchema, (client) =>
    client.GET("/projects/{projectId}", {
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.project)
    )

export const loadProjectPs = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(OutputResponseSchema, (client) =>
    client.GET("/projects/{projectId}/ps", {
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.output)
    )

export const loadProjectLogs = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(OutputResponseSchema, (client) =>
    client.GET("/projects/{projectId}/logs", {
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.output)
    )

export const applyProject = (
  projectId: string,
  request?: ApplyProjectRequest
) =>
  dockerGitOpenApi.openApiJsonSchema(ProjectResponseSchema, (client) =>
    client.POST("/projects/{projectId}/apply", {
      body: applyProjectBody(request),
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.project)
    )

export const createProject = (draft: CreateProjectRequestDraft) =>
  dockerGitOpenApi.openApiJsonSchema(ProjectResponseSchema, (client) =>
    client.POST("/projects", {
      body: createProjectBody(draft)
    })).pipe(
      Effect.map((response) => response.project)
    )

export const upProject = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(ProjectResponseSchema, (client) =>
    client.POST("/projects/{projectId}/up", {
      body: { useManagedAuthorizedKeys: true },
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.project)
    )

export const resumeProject = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(ProjectResponseSchema, (client) =>
    client.POST("/projects/{projectId}/resume", {
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.project)
    )

export const suspendProject = (projectId: string) =>
  dockerGitOpenApi.openApiJsonSchema(ProjectResponseSchema, (client) =>
    client.POST("/projects/{projectId}/suspend", {
      params: { path: { projectId } }
    })).pipe(
      Effect.map((response) => response.project)
    )

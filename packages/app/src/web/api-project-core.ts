import { Effect } from "effect"

import type { ApplyProjectRequest, ProjectResourceLimitRequest } from "../shared/project-resource-request.js"
import type { CreateProjectDraft } from "./api-schema.js"
import { OutputResponseSchema, ProjectResponseSchema } from "./api-schema.js"
import { openApiJsonSchema } from "./openapi-client.js"

export type { ApplyProjectRequest, ProjectResourceLimitRequest } from "../shared/project-resource-request.js"

type CreateProjectRequestDraft = CreateProjectDraft & ProjectResourceLimitRequest

const optionalProjectResourceFields = (request: ProjectResourceLimitRequest) => ({
  ...(request.playwrightCpuLimit === undefined ? {} : { playwrightCpuLimit: request.playwrightCpuLimit }),
  ...(request.playwrightRamLimit === undefined ? {} : { playwrightRamLimit: request.playwrightRamLimit })
})

const applyProjectBody = (request: ApplyProjectRequest | undefined) => ({
  ...(request?.cpuLimit === undefined ? {} : { cpuLimit: request.cpuLimit }),
  ...(request?.gpu === undefined ? {} : { gpu: request.gpu }),
  ...(request?.ramLimit === undefined ? {} : { ramLimit: request.ramLimit }),
  ...(request === undefined ? {} : optionalProjectResourceFields(request))
})

const createProjectBody = (draft: CreateProjectRequestDraft) => ({
  cpuLimit: draft.cpuLimit,
  enableMcpPlaywright: draft.enableMcpPlaywright,
  force: draft.force,
  forceEnv: draft.forceEnv,
  gpu: draft.gpu,
  openSsh: false,
  outDir: draft.outDir,
  ramLimit: draft.ramLimit,
  repoRef: draft.repoRef,
  repoUrl: draft.repoUrl,
  up: draft.up,
  useManagedAuthorizedKeys: true,
  ...optionalProjectResourceFields(draft)
})

export const loadProjectDetails = (projectId: string) =>
  openApiJsonSchema(ProjectResponseSchema, (client) => client.GET("/projects/{projectId}", {
    params: { path: { projectId } }
  })).pipe(
    Effect.map((response) => response.project)
  )

export const loadProjectPs = (projectId: string) =>
  openApiJsonSchema(OutputResponseSchema, (client) => client.GET("/projects/{projectId}/ps", {
    params: { path: { projectId } }
  })).pipe(
    Effect.map((response) => response.output)
  )

export const loadProjectLogs = (projectId: string) =>
  openApiJsonSchema(OutputResponseSchema, (client) => client.GET("/projects/{projectId}/logs", {
    params: { path: { projectId } }
  })).pipe(
    Effect.map((response) => response.output)
  )

export const applyProject = (
  projectId: string,
  request?: ApplyProjectRequest
) =>
  openApiJsonSchema(ProjectResponseSchema, (client) => client.POST("/projects/{projectId}/apply", {
    body: applyProjectBody(request),
    params: { path: { projectId } }
  })).pipe(
    Effect.map((response) => response.project)
  )

export const createProject = (draft: CreateProjectRequestDraft) =>
  openApiJsonSchema(ProjectResponseSchema, (client) => client.POST("/projects", {
    body: createProjectBody(draft)
  })).pipe(
    Effect.map((response) => response.project)
  )

export const upProject = (projectId: string) =>
  openApiJsonSchema(ProjectResponseSchema, (client) => client.POST("/projects/{projectId}/up", {
    body: { useManagedAuthorizedKeys: true },
    params: { path: { projectId } }
  })).pipe(
    Effect.map((response) => response.project)
  )

export const resumeProject = (projectId: string) =>
  openApiJsonSchema(ProjectResponseSchema, (client) => client.POST("/projects/{projectId}/resume", {
    params: { path: { projectId } }
  })).pipe(
    Effect.map((response) => response.project)
  )

export const suspendProject = (projectId: string) =>
  openApiJsonSchema(ProjectResponseSchema, (client) => client.POST("/projects/{projectId}/suspend", {
    params: { path: { projectId } }
  })).pipe(
    Effect.map((response) => response.project)
  )

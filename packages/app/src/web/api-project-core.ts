import { Effect } from "effect"

import { requestJson } from "./api-http.js"
import type { CreateProjectDraft } from "./api-schema.js"
import { OutputResponseSchema, ProjectResponseSchema } from "./api-schema.js"

export type ProjectResourceLimitRequest = {
  readonly cpuLimit?: string | undefined
  readonly ramLimit?: string | undefined
  readonly playwrightCpuLimit?: string | undefined
  readonly playwrightRamLimit?: string | undefined
}

type CreateProjectRequestDraft = CreateProjectDraft & ProjectResourceLimitRequest

export type ApplyProjectRequest = ProjectResourceLimitRequest & {
  readonly gpu?: "none" | "all" | undefined
}

export const loadProjectDetails = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}`, ProjectResponseSchema).pipe(
    Effect.map((response) => response.project)
  )

export const loadProjectPs = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/ps`, OutputResponseSchema).pipe(
    Effect.map((response) => response.output)
  )

export const loadProjectLogs = (projectId: string) =>
  requestJson("GET", `/projects/${encodeURIComponent(projectId)}/logs`, OutputResponseSchema).pipe(
    Effect.map((response) => response.output)
  )

export const applyProject = (
  projectId: string,
  request?: ApplyProjectRequest
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/apply`,
    ProjectResponseSchema,
    request
  ).pipe(
    Effect.map((response) => response.project)
  )

export const createProject = (draft: CreateProjectRequestDraft) =>
  requestJson(
    "POST",
    "/projects",
    ProjectResponseSchema,
    { ...draft, openSsh: false, useManagedAuthorizedKeys: true }
  ).pipe(
    Effect.map((response) => response.project)
  )

export const upProject = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/up`,
    ProjectResponseSchema,
    { useManagedAuthorizedKeys: true }
  ).pipe(
    Effect.map((response) => response.project)
  )

export const resumeProject = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/resume`,
    ProjectResponseSchema
  ).pipe(
    Effect.map((response) => response.project)
  )

export const suspendProject = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/suspend`,
    ProjectResponseSchema
  ).pipe(
    Effect.map((response) => response.project)
  )

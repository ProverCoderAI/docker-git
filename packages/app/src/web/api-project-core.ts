import { Effect } from "effect"

import { requestJson } from "./api-http.js"
import type { CreateProjectDraft } from "./api-schema.js"
import { OutputResponseSchema, ProjectResponseSchema } from "./api-schema.js"

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

export const createProject = (draft: CreateProjectDraft) =>
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

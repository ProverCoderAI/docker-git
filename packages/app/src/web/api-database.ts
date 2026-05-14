import { Effect } from "effect"

import { requestJson, requestText } from "./api-http.js"
import {
  ProjectDatabaseForwardResponseSchema,
  ProjectDatabaseForwardsResponseSchema,
  ProjectDatabaseProfileResponseSchema,
  ProjectDatabaseProfilesResponseSchema,
  ProjectDatabaseSessionResponseSchema
} from "./api-schema.js"
import type { ProjectDatabaseForward, ProjectDatabaseSession } from "./api-schema.js"

export const projectDatabaseEditorUrl = (session: ProjectDatabaseSession): string => session.editorPath

export const projectDatabaseExternalUrl = (forward: ProjectDatabaseForward): string =>
  `${forward.publicHost}:${forward.hostPort}`

const projectDatabaseProfilePath = (projectId: string, profileId: string): string =>
  `/projects/${encodeURIComponent(projectId)}/databases/profiles/${encodeURIComponent(profileId)}`

const projectDatabaseForwardPath = (projectId: string, profileId: string): string =>
  `${projectDatabaseProfilePath(projectId, profileId)}/expose`

export const loadProjectDatabaseProfiles = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles`,
    ProjectDatabaseProfilesResponseSchema
  ).pipe(
    Effect.map((response) => response.profiles)
  )

export const loadProjectDatabaseForwards = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/databases/forwards`,
    ProjectDatabaseForwardsResponseSchema
  ).pipe(
    Effect.map((response) => response.forwards)
  )

export const saveProjectDatabaseProfile = (
  projectId: string,
  connectionString: string,
  label: string | null
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles`,
    ProjectDatabaseProfileResponseSchema,
    { connectionString, label }
  ).pipe(
    Effect.map((response) => response.profile)
  )

export const deleteProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) => requestText("DELETE", projectDatabaseProfilePath(projectId, profileId)).pipe(Effect.asVoid)

export const exposeProjectDatabaseProfile = (
  projectId: string,
  profileId: string
) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/profiles/${encodeURIComponent(profileId)}/expose`,
    ProjectDatabaseForwardResponseSchema
  ).pipe(
    Effect.map((response) => response.forward)
  )

export const deleteProjectDatabaseForward = (
  projectId: string,
  profileId: string
) => requestText("DELETE", projectDatabaseForwardPath(projectId, profileId)).pipe(Effect.asVoid)

export const loadProjectDatabaseSession = (projectId: string) =>
  requestJson(
    "GET",
    `/projects/${encodeURIComponent(projectId)}/databases/session`,
    ProjectDatabaseSessionResponseSchema
  ).pipe(
    Effect.map((response) => response.session)
  )

export const openProjectDatabaseEditor = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/open`,
    ProjectDatabaseSessionResponseSchema
  ).pipe(
    Effect.map((response) => response.session)
  )

export const restartProjectDatabaseEditor = (projectId: string) =>
  requestJson(
    "POST",
    `/projects/${encodeURIComponent(projectId)}/databases/restart`,
    ProjectDatabaseSessionResponseSchema
  ).pipe(
    Effect.map((response) => response.session)
  )

import { Effect } from "effect"

import type { AuthMenuRequestBody, ProjectAuthMenuRequestBody } from "../shared/auth-menu-request.js"
import { decodeAuthSnapshot, decodeProjectAuthSnapshot } from "./api-auth-codec.js"
import { request } from "./api-http.js"

const projectPath = (projectId: string, suffix = ""): string => `/projects/${encodeURIComponent(projectId)}${suffix}`

export const loadAuthSnapshot = () =>
  request("GET", "/auth/menu").pipe(
    Effect.map((payload) => decodeAuthSnapshot(payload))
  )

export const runAuthMenuFlow = (requestBody: AuthMenuRequestBody) =>
  request("POST", "/auth/menu", {
    flow: requestBody.flow,
    label: requestBody.label ?? undefined,
    token: requestBody.token ?? undefined,
    user: requestBody.user ?? undefined,
    apiKey: requestBody.apiKey ?? undefined
  }).pipe(
    Effect.map((payload) => decodeAuthSnapshot(payload))
  )

export const loadProjectAuthSnapshot = (projectId: string) =>
  request("GET", projectPath(projectId, "/auth/menu")).pipe(
    Effect.map((payload) => decodeProjectAuthSnapshot(payload))
  )

export const runProjectAuthFlow = (
  projectId: string,
  requestBody: ProjectAuthMenuRequestBody
) =>
  request("POST", projectPath(projectId, "/auth/menu"), {
    flow: requestBody.flow,
    label: requestBody.label ?? undefined
  }).pipe(
    Effect.map((payload) => decodeProjectAuthSnapshot(payload))
  )

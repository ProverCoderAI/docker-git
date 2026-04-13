import { Effect } from "effect"

import { buildCreateProjectRequest } from "./api-client-create.js"
import { readProjectEventCursor, startProjectEventPolling, stopProjectEventPolling } from "./api-client-events.js"
import { readProjectOutput, resolveCreateRequestPaths } from "./api-client-helpers.js"
import { request, requestVoid } from "./api-http.js"
import { asArray, asObject, asString, type JsonValue } from "./api-json.js"
import { decodeProjectDetails, decodeProjectSummary } from "./api-project-codec.js"
import { decodeTerminalSession } from "./api-terminal-codec.js"
import type {
  CreateCommand,
  StateCommitCommand,
  StateInitCommand,
  StateSyncCommand
} from "./frontend-lib/core/domain.js"

export {
  codexImport,
  codexLogin,
  codexLogout,
  codexStatus,
  githubLogin,
  githubLogout,
  githubStatus
} from "./api-client-auth.js"
export { type JsonObject, type JsonRequest, type JsonValue, renderJsonPayload } from "./api-json.js"
export {
  type ApiProjectDetails,
  type ApiProjectSummary,
  decodeProjectDetails,
  decodeProjectSummary,
  renderProjectSummaryLine
} from "./api-project-codec.js"
export { type ApiTerminalSession } from "./api-terminal-codec.js"

const projectPath = (projectId: string, suffix = ""): string => `/projects/${encodeURIComponent(projectId)}${suffix}`

const decodeProjectResponse = (payload: JsonValue) => {
  const object = asObject(payload)
  return object === null
    ? decodeProjectDetails(payload)
    : decodeProjectDetails(object["project"] ?? payload)
}

export const listProjects = () =>
  request("GET", "/projects").pipe(
    Effect.map((payload) => {
      const object = asObject(payload)
      const items = object === null ? asArray(payload) : asArray(object["projects"])
      return items
        .map((item) => decodeProjectSummary(item))
        .filter((value): value is NonNullable<typeof value> => value !== null)
    })
  )

export const getProject = (projectId: string) =>
  request("GET", projectPath(projectId)).pipe(
    Effect.map((payload) => decodeProjectResponse(payload))
  )

const createProjectWithResolvedPaths = (
  command: CreateCommand,
  resolvedPaths: {
    readonly authorizedKeysPath: string
    readonly authorizedKeysContents?: string | undefined
  }
) =>
  Effect.gen(function*(_) {
    const createRequest = buildCreateProjectRequest(command, resolvedPaths)
    const projectId = asString(createRequest.outDir)
    const initialCursor = projectId === null
      ? null
      : yield* _(
        readProjectEventCursor(projectId).pipe(
          Effect.orElseSucceed(() => 0)
        )
      )
    const eventPolling = projectId === null || initialCursor === null
      ? null
      : yield* _(startProjectEventPolling(projectId, initialCursor))
    const payload = yield* _(
      request("POST", "/projects", createRequest).pipe(
        Effect.ensuring(
          eventPolling === null
            ? Effect.void
            : stopProjectEventPolling(eventPolling)
        )
      )
    )
    return decodeProjectResponse(payload)
  })

export const createProject = (command: CreateCommand) =>
  Effect.gen(function*(_) {
    const resolvedPaths = yield* _(resolveCreateRequestPaths(command))
    return yield* _(createProjectWithResolvedPaths(command, resolvedPaths))
  })

export const deleteProject = (projectId: string) => requestVoid("DELETE", projectPath(projectId))

export const upProject = (projectId: string) =>
  requestVoid("POST", projectPath(projectId, "/up"), { useManagedAuthorizedKeys: true })

export const downProject = (projectId: string) => requestVoid("POST", projectPath(projectId, "/down"))

export const readProjectPs = (projectId: string) =>
  request("GET", projectPath(projectId, "/ps")).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const readProjectLogs = (projectId: string) =>
  request("GET", projectPath(projectId, "/logs")).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const createProjectTerminalSession = (projectId: string) =>
  request("POST", projectPath(projectId, "/terminal-sessions")).pipe(
    Effect.map((payload) => {
      const object = asObject(payload)
      const project = decodeProjectDetails(object?.["project"] ?? payload)
      const session = decodeTerminalSession(object?.["session"] ?? payload)
      return project === null || session === null ? null : { project, session }
    })
  )

export const createAuthTerminalSession = (
  flow: "ClaudeOauth" | "GeminiOauth",
  label: string | null
) =>
  request("POST", "/auth/terminal-sessions", { flow, label: label ?? undefined }).pipe(
    Effect.map((payload) => {
      const object = asObject(payload)
      return decodeTerminalSession(object?.["session"] ?? payload)
    })
  )

export const deleteTerminalSessionByPath = (path: string) => requestVoid("DELETE", path)

export const applyAllProjects = (activeOnly: boolean) => requestVoid("POST", "/projects/apply-all", { activeOnly })

export const downAllProjects = () => requestVoid("POST", "/projects/down-all")

export const readStatePath = () =>
  request("GET", "/state/path").pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const initState = (command: StateInitCommand) =>
  request("POST", "/state/init", {
    repoUrl: command.repoUrl,
    repoRef: command.repoRef
  }).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const readStateStatus = () =>
  request("GET", "/state/status").pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const pullState = () =>
  request("POST", "/state/pull").pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const commitState = (command: StateCommitCommand) =>
  request("POST", "/state/commit", {
    message: command.message
  }).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const syncState = (command: StateSyncCommand) =>
  request("POST", "/state/sync", {
    message: command.message
  }).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const pushState = () =>
  request("POST", "/state/push").pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

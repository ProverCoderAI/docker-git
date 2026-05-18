import { Effect } from "effect"

import type { ApplyProjectRequest } from "../shared/project-resource-request.js"
import { buildCreateProjectRequest } from "./api-client-create.js"
import {
  readProjectEventCursor,
  startProjectEventPolling,
  stopProjectEventPolling,
  waitForProjectCreation
} from "./api-client-events.js"
import { readProjectOutput, resolveCreateRequestPaths } from "./api-client-helpers.js"
import { decodeContainerTaskSnapshot } from "./api-container-tasks-codec.js"
import { request, requestVoid } from "./api-http.js"
import { asArray, asObject, asString, type JsonValue } from "./api-json.js"
import { decodeCreateProjectAccepted, decodeProjectDetails, decodeProjectSummary } from "./api-project-codec.js"
import { decodeTerminalSession } from "./api-terminal-codec.js"
import type { ControllerRuntime } from "./controller.js"
import type {
  CreateCommand,
  StateCommitCommand,
  StateInitCommand,
  StateSyncCommand
} from "./frontend-lib/core/domain.js"
import type { ApiRequestError } from "./host-errors.js"

export {
  codexImport,
  codexLogin,
  codexLogout,
  codexStatus,
  githubLogin,
  githubLogout,
  githubStatus,
  gitlabLogin,
  gitlabLogout,
  gitlabStatus
} from "./api-client-auth.js"
export {
  type ApiContainerTask,
  type ApiContainerTaskKind,
  type ApiContainerTaskSnapshot,
  renderContainerTaskSnapshot
} from "./api-container-tasks-codec.js"
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

const decodeProjectsResponse = <A>(
  payload: JsonValue,
  decode: (value: JsonValue) => A | null
): ReadonlyArray<A> => {
  const object = asObject(payload)
  const items = object === null ? asArray(payload) : asArray(object["projects"])
  return items
    .map((item) => decode(item))
    .filter((value): value is A => value !== null)
}

const invalidCreateAcceptedResponse = (): ApiRequestError => ({
  _tag: "ApiRequestError",
  method: "POST",
  path: "/projects",
  message: "API accepted async create but returned an invalid response."
})

type ResolvedCreateRequestPaths = {
  readonly authorizedKeysPath: string
  readonly authorizedKeysContents?: string | undefined
}

const createProjectAsync = (
  command: CreateCommand,
  resolvedPaths: ResolvedCreateRequestPaths
) =>
  Effect.gen(function*(_) {
    const createRequest = buildCreateProjectRequest(command, resolvedPaths, { async: true })
    const payload = yield* _(request("POST", "/projects", createRequest))
    const accepted = decodeCreateProjectAccepted(payload)
    if (accepted === null) {
      return yield* _(Effect.fail(invalidCreateAcceptedResponse()))
    }

    const created = yield* _(waitForProjectCreation(accepted.projectId, accepted.cursor))
    if (created.project !== null) {
      return created.project
    }
    return yield* _(getProject(created.projectId))
  })

export const listProjects = () =>
  request("GET", "/projects").pipe(
    Effect.map((payload) => decodeProjectsResponse(payload, decodeProjectSummary))
  )

// CHANGE: expose DB-only project details already returned by GET /projects
// WHY: TUI Select/Open must not issue N follow-up project reads for the same `.docker-git` inventory
// QUOTE(ТЗ): "А должен ходить только в .docker-git папку и читать данные из неё если необходимо"
// REF: user-message-2026-04-21-db-only-project-list
// SOURCE: n/a
// FORMAT THEOREM: forall projects response R: details(R) is decoded from one API response
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ApiProjectDetails>, ApiRequestError, ControllerRuntime>
// INVARIANT: no per-project API fan-out is required for project selection
// COMPLEXITY: O(n)
export const listProjectDetails = () =>
  request("GET", "/projects").pipe(
    Effect.map((payload) => decodeProjectsResponse(payload, decodeProjectDetails))
  )

export const getProject = (projectId: string) =>
  request("GET", projectPath(projectId)).pipe(
    Effect.map((payload) => decodeProjectResponse(payload))
  )

const createProjectWithResolvedPaths = (
  command: CreateCommand,
  resolvedPaths: ResolvedCreateRequestPaths
) =>
  Effect.gen(function*(_) {
    if (command.runUp) {
      return yield* _(createProjectAsync(command, resolvedPaths))
    }

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

const withProjectEventPolling = <A, E, R>(
  projectId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E | ApiRequestError, R | ControllerRuntime> =>
  Effect.gen(function*(_) {
    const initialCursor = yield* _(
      readProjectEventCursor(projectId).pipe(
        Effect.orElseSucceed(() => 0)
      )
    )
    const eventPolling = yield* _(startProjectEventPolling(projectId, initialCursor))
    return yield* _(
      effect.pipe(
        Effect.ensuring(stopProjectEventPolling(eventPolling))
      )
    )
  })

export const createProject = (command: CreateCommand) =>
  Effect.gen(function*(_) {
    const resolvedPaths = yield* _(resolveCreateRequestPaths(command))
    return yield* _(createProjectWithResolvedPaths(command, resolvedPaths))
  })

export const deleteProject = (projectId: string) => requestVoid("DELETE", projectPath(projectId))

export const upProject = (projectId: string) =>
  withProjectEventPolling(
    projectId,
    request("POST", projectPath(projectId, "/up"), { useManagedAuthorizedKeys: true }).pipe(
      Effect.map((payload) => decodeProjectResponse(payload))
    )
  )

export const applyProject = (projectId: string, applyRequest: ApplyProjectRequest = {}) =>
  withProjectEventPolling(
    projectId,
    request("POST", projectPath(projectId, "/apply"), applyRequest).pipe(
      Effect.map((payload) => decodeProjectResponse(payload))
    )
  )

export const resumeProject = (projectId: string) =>
  withProjectEventPolling(
    projectId,
    request("POST", projectPath(projectId, "/resume")).pipe(
      Effect.map((payload) => decodeProjectResponse(payload))
    )
  )

export const suspendProject = (projectId: string) =>
  withProjectEventPolling(
    projectId,
    request("POST", projectPath(projectId, "/suspend")).pipe(
      Effect.map((payload) => decodeProjectResponse(payload))
    )
  )

export const downProject = (projectId: string) =>
  withProjectEventPolling(projectId, requestVoid("POST", projectPath(projectId, "/down")))

export const readProjectPs = (projectId: string) =>
  request("GET", projectPath(projectId, "/ps")).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const readProjectLogs = (projectId: string) =>
  request("GET", projectPath(projectId, "/logs")).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const readContainerTaskSnapshot = (projectId: string, includeDefault: boolean) =>
  request("GET", projectPath(projectId, `/tasks${includeDefault ? "?includeDefault=true" : ""}`)).pipe(
    Effect.map((payload) => decodeContainerTaskSnapshot(payload))
  )

export const stopContainerTask = (projectId: string, pid: number) =>
  requestVoid("POST", projectPath(projectId, `/tasks/${pid}/stop`))

export const readContainerTaskLogs = (projectId: string, pid: number, lines: number) =>
  request("GET", projectPath(projectId, `/tasks/${pid}/logs?lines=${lines}`)).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const createProjectTerminalSession = (projectId: string) =>
  withProjectEventPolling(
    projectId,
    request("POST", projectPath(projectId, "/terminal-sessions")).pipe(
      Effect.map((payload) => {
        const object = asObject(payload)
        const project = decodeProjectDetails(object?.["project"] ?? payload)
        const session = decodeTerminalSession(object?.["session"] ?? payload)
        return project === null || session === null ? null : { project, session }
      })
    )
  )

export const createAuthTerminalSession = (
  flow: "ClaudeOauth" | "GeminiOauth" | "GrokOauth",
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

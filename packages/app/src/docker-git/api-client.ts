import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import { readProjectOutput, resolveCreateRequestPaths } from "./api-client-helpers.js"
import { request, requestTextStream, requestVoid } from "./api-http.js"
import { asArray, asObject, type JsonRequest } from "./api-json.js"
import { decodeProjectDetails, decodeProjectSummary } from "./api-project-codec.js"
import { decodeTerminalSession } from "./api-terminal-codec.js"
import type {
  AuthCodexImportCommand,
  AuthCodexLoginCommand,
  AuthCodexLogoutCommand,
  AuthCodexStatusCommand,
  AuthGithubLoginCommand,
  AuthGithubLogoutCommand,
  AuthGithubStatusCommand,
  CreateCommand,
  StateCommitCommand,
  StateInitCommand,
  StateSyncCommand
} from "./frontend-lib/core/domain.js"
import { resolvePathFromCwd } from "./frontend-lib/usecases/path-helpers.js"
import type { ApiRequestError } from "./host-errors.js"

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
const codexLoginSuccessMarker = "__DOCKER_GIT_CODEX_LOGIN_STATUS__:ok"
const codexLoginErrorMarkerPrefix = "__DOCKER_GIT_CODEX_LOGIN_STATUS__:error:"

const codexLoginFailureMessage = (output: string, exitCode: string | null): string => {
  if (output.includes("429 Too Many Requests")) {
    return "Codex device auth is rate-limited by OpenAI (429 Too Many Requests). Wait a few minutes and retry."
  }

  const lines = output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      line.length > 0 &&
      !line.startsWith(codexLoginSuccessMarker) &&
      !line.startsWith(codexLoginErrorMarkerPrefix)
    )

  const detailedLine = lines.findLast((line) => line.toLowerCase().includes("error"))
  if (detailedLine !== undefined) {
    return detailedLine
  }

  const lastLine = lines.at(-1)
  if (lastLine !== undefined) {
    return lastLine
  }

  return exitCode === null
    ? "Codex login stream ended without a completion marker."
    : `Codex login failed (${exitCode}).`
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
    Effect.map((payload) => {
      const object = asObject(payload)
      return object === null ? decodeProjectDetails(payload) : decodeProjectDetails(object["project"] ?? payload)
    })
  )

export const createProject = (command: CreateCommand) =>
  Effect.gen(function*(_) {
    const config = command.config
    const resolvedPaths = yield* _(resolveCreateRequestPaths(command))
    const body = {
      repoUrl: config.repoUrl,
      repoRef: config.repoRef,
      targetDir: config.targetDir,
      sshPort: String(config.sshPort),
      sshUser: config.sshUser,
      containerName: config.containerName,
      serviceName: config.serviceName,
      volumeName: config.volumeName,
      authorizedKeysPath: resolvedPaths.authorizedKeysPath,
      envGlobalPath: config.envGlobalPath,
      envProjectPath: config.envProjectPath,
      codexAuthPath: config.codexAuthPath,
      codexHome: config.codexHome,
      cpuLimit: config.cpuLimit,
      ramLimit: config.ramLimit,
      dockerNetworkMode: config.dockerNetworkMode,
      dockerSharedNetworkName: config.dockerSharedNetworkName,
      enableMcpPlaywright: config.enableMcpPlaywright,
      outDir: command.outDir,
      gitTokenLabel: config.gitTokenLabel,
      skipGithubAuth: config.skipGithubAuth,
      useManagedAuthorizedKeys: true,
      codexTokenLabel: config.codexAuthLabel,
      claudeTokenLabel: config.claudeAuthLabel,
      agentAutoMode: config.agentAuto ? (config.agentMode ?? "auto") : undefined,
      up: command.runUp,
      openSsh: false,
      force: command.force,
      forceEnv: command.forceEnv,
      waitForClone: command.waitForClone
    } satisfies JsonRequest

    const payload = yield* _(request("POST", "/projects", body))
    const object = asObject(payload)
    return object === null ? decodeProjectDetails(payload) : decodeProjectDetails(object["project"] ?? payload)
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

export const githubLogin = (command: AuthGithubLoginCommand) =>
  request("POST", "/auth/github/login", {
    label: command.label,
    token: command.token,
    scopes: command.scopes
  })

export const githubStatus = (_command: AuthGithubStatusCommand) => request("GET", "/auth/github/status")

export const githubLogout = (command: AuthGithubLogoutCommand) =>
  requestVoid("POST", "/auth/github/logout", {
    label: command.label
  })

export const codexLogin = (command: AuthCodexLoginCommand) =>
  Effect.gen(function*(_) {
    let pending = ""
    const writeVisibleChunk = (chunk: string) => {
      pending += chunk
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""

      for (const line of lines) {
        if (line.startsWith(codexLoginSuccessMarker) || line.startsWith(codexLoginErrorMarkerPrefix)) {
          continue
        }
        process.stdout.write(`${line}\n`)
      }
    }

    const output = yield* _(
      requestTextStream(
        "POST",
        "/auth/codex/login",
        { label: command.label },
        writeVisibleChunk
      )
    )

    if (
      pending.length > 0 &&
      !pending.startsWith(codexLoginSuccessMarker) &&
      !pending.startsWith(codexLoginErrorMarkerPrefix)
    ) {
      process.stdout.write(pending)
    }

    if (output.includes(codexLoginSuccessMarker)) {
      return
    }

    const failureLine = output
      .split(/\r?\n/u)
      .find((line) => line.startsWith(codexLoginErrorMarkerPrefix))

    const exitCode = failureLine === undefined
      ? null
      : failureLine.slice(codexLoginErrorMarkerPrefix.length)
    const failureMessage = codexLoginFailureMessage(output, exitCode)

    return yield* _(
      Effect.fail<ApiRequestError>({
        _tag: "ApiRequestError",
        method: "POST",
        path: "/auth/codex/login",
        message: failureMessage,
        displayOnlyMessage: true
      })
    )
  })

const readCodexAuthText = (command: AuthCodexImportCommand) =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const resolvedCodexAuthDir = resolvePathFromCwd(path, process.cwd(), command.codexAuthPath)
    const authFilePath = path.join(resolvedCodexAuthDir, "auth.json")
    return yield* _(fs.readFileString(authFilePath))
  })

export const codexImport = (command: AuthCodexImportCommand) =>
  Effect.gen(function*(_) {
    const authText = yield* _(readCodexAuthText(command))
    return yield* _(request("POST", "/auth/codex/import", { label: command.label, authText }))
  })

export const codexStatus = (command: AuthCodexStatusCommand) => {
  const query = command.label === null ? "" : `?label=${encodeURIComponent(command.label)}`
  return request("GET", `/auth/codex/status${query}`)
}

export const codexLogout = (command: AuthCodexLogoutCommand) =>
  requestVoid("POST", "/auth/codex/logout", {
    label: command.label
  })

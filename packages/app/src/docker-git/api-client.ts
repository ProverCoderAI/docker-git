import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect } from "effect"

import type {
  AuthCodexImportCommand,
  AuthCodexLogoutCommand,
  AuthCodexStatusCommand,
  AuthGithubLoginCommand,
  AuthGithubLogoutCommand,
  AuthGithubStatusCommand,
  CreateCommand
} from "@lib/core/domain"
import { resolvePathFromCwd } from "@lib/usecases/path-helpers"

import { request, requestVoid } from "./api-http.js"
import { asArray, asObject, asString, type JsonRequest, type JsonValue } from "./api-json.js"
import { decodeProjectDetails, decodeProjectSummary } from "./api-project-codec.js"
import { resolveHostSshMaterial, resolveManagedHostSshMaterial } from "./host-ssh-material.js"

export { type JsonObject, type JsonRequest, type JsonValue, renderJsonPayload } from "./api-json.js"
export {
  type ApiProjectDetails,
  type ApiProjectSummary,
  decodeProjectDetails,
  decodeProjectSummary,
  renderProjectSummaryLine
} from "./api-project-codec.js"

const projectPath = (projectId: string, suffix = ""): string => `/projects/${encodeURIComponent(projectId)}${suffix}`

const readProjectOutput = (payload: JsonValue): string => {
  const object = asObject(payload)
  return asString(object?.["output"]) ?? ""
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
    const sshMaterial = yield* _(resolveHostSshMaterial(command))
    const body = {
      repoUrl: config.repoUrl,
      repoRef: config.repoRef,
      targetDir: config.targetDir,
      sshPort: String(config.sshPort),
      sshUser: config.sshUser,
      containerName: config.containerName,
      serviceName: config.serviceName,
      volumeName: config.volumeName,
      cpuLimit: config.cpuLimit,
      ramLimit: config.ramLimit,
      dockerNetworkMode: config.dockerNetworkMode,
      dockerSharedNetworkName: config.dockerSharedNetworkName,
      enableMcpPlaywright: config.enableMcpPlaywright,
      outDir: command.outDir,
      gitTokenLabel: config.gitTokenLabel,
      skipGithubAuth: config.skipGithubAuth,
      authorizedKeysContents: sshMaterial.authorizedKeysContents.length > 0
        ? sshMaterial.authorizedKeysContents
        : undefined,
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
  Effect.gen(function*(_) {
    const sshMaterial = yield* _(resolveManagedHostSshMaterial())
    return yield* _(
      requestVoid("POST", projectPath(projectId, "/up"), {
        authorizedKeysContents: sshMaterial.authorizedKeysContents.length > 0
          ? sshMaterial.authorizedKeysContents
          : undefined
      })
    )
  })

export const downProject = (projectId: string) => requestVoid("POST", projectPath(projectId, "/down"))

export const readProjectPs = (projectId: string) =>
  request("GET", projectPath(projectId, "/ps")).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const readProjectLogs = (projectId: string) =>
  request("GET", projectPath(projectId, "/logs")).pipe(
    Effect.map((payload) => readProjectOutput(payload))
  )

export const applyAllProjects = (activeOnly: boolean) => requestVoid("POST", "/projects/apply-all", { activeOnly })

export const downAllProjects = () => requestVoid("POST", "/projects/down-all")

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

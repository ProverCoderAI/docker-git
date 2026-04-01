import { Effect } from "effect"

import type {
  AuthGithubLoginCommand,
  AuthGithubLogoutCommand,
  AuthGithubStatusCommand,
  CreateCommand
} from "@lib/core/domain"

import { request, requestVoid } from "./api-http.js"
import { asArray, asObject, type JsonRequest } from "./api-json.js"
import { decodeProjectDetails, decodeProjectSummary } from "./api-project-codec.js"

export { type JsonObject, type JsonRequest, type JsonValue, renderJsonPayload } from "./api-json.js"
export {
  type ApiProjectDetails,
  type ApiProjectSummary,
  decodeProjectDetails,
  decodeProjectSummary,
  renderProjectSummaryLine
} from "./api-project-codec.js"

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

export const createProject = (command: CreateCommand) => {
  const config = command.config
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
    codexTokenLabel: config.codexAuthLabel,
    claudeTokenLabel: config.claudeAuthLabel,
    agentAutoMode: config.agentAuto ? (config.agentMode ?? "auto") : undefined,
    up: command.runUp,
    openSsh: false,
    force: command.force,
    forceEnv: command.forceEnv,
    waitForClone: command.waitForClone
  } satisfies JsonRequest

  return request("POST", "/projects", body).pipe(
    Effect.map((payload) => {
      const object = asObject(payload)
      return object === null ? decodeProjectDetails(payload) : decodeProjectDetails(object["project"] ?? payload)
    })
  )
}

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

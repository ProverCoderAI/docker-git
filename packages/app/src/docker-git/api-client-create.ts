import { Effect } from "effect"

import { request } from "./api-http.js"
import { asObject, type JsonRequest, type JsonValue } from "./api-json.js"
import { decodeProjectDetails } from "./api-project-codec.js"
import type { CreateCommand } from "./frontend-lib/core/domain.js"

type ResolvedCreateRequestPaths = {
  readonly authorizedKeysPath: string
  readonly authorizedKeysContents?: string | undefined
}

const projectPath = (projectId: string, suffix = ""): string => `/projects/${encodeURIComponent(projectId)}${suffix}`

export const decodeProjectResponse = (payload: JsonValue) => {
  const object = asObject(payload)
  return object === null
    ? decodeProjectDetails(payload)
    : decodeProjectDetails(object["project"] ?? payload)
}

export const createProjectRequestNeedsFollowUpUp = (
  command: CreateCommand,
  resolvedPaths: ResolvedCreateRequestPaths
): boolean => command.runUp && resolvedPaths.authorizedKeysContents !== undefined

export const createProjectRequestAllowsImmediateUp = (
  command: CreateCommand,
  resolvedPaths: ResolvedCreateRequestPaths
): boolean => command.runUp && resolvedPaths.authorizedKeysContents === undefined

export const buildCreateProjectRequest = (
  command: CreateCommand,
  resolvedPaths: ResolvedCreateRequestPaths,
  shouldRunUpInCreateRequest: boolean
) => {
  const config = command.config
  return {
    repoUrl: config.repoUrl,
    repoRef: config.repoRef,
    targetDir: config.targetDir,
    sshPort: String(config.sshPort),
    sshUser: config.sshUser,
    containerName: config.containerName,
    serviceName: config.serviceName,
    volumeName: config.volumeName,
    authorizedKeysPath: resolvedPaths.authorizedKeysPath,
    authorizedKeysContents: resolvedPaths.authorizedKeysContents,
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
    up: shouldRunUpInCreateRequest,
    openSsh: false,
    force: command.force,
    forceEnv: command.forceEnv,
    waitForClone: command.waitForClone
  } satisfies JsonRequest
}

export const upCreatedProjectWithAuthorizedKeys = (
  projectId: string,
  authorizedKeysContents: string
) =>
  request("POST", projectPath(projectId, "/up"), {
    authorizedKeysContents,
    useManagedAuthorizedKeys: true
  }).pipe(
    Effect.map((payload) => decodeProjectResponse(payload))
  )

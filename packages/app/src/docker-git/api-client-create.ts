import type { JsonRequest } from "./api-json.js"
import { type CreateCommand, defaultTemplateConfig } from "./frontend-lib/core/domain.js"

type ResolvedCreateRequestPaths = {
  readonly authorizedKeysPath: string
  readonly authorizedKeysContents?: string | undefined
}

type CreateProjectRequestOptions = {
  readonly async?: boolean | undefined
}

export const buildCreateProjectRequest = (
  command: CreateCommand,
  resolvedPaths: ResolvedCreateRequestPaths,
  options?: CreateProjectRequestOptions
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
    authorizedKeysPath: resolvedPaths.authorizedKeysContents === undefined
      ? resolvedPaths.authorizedKeysPath
      : defaultTemplateConfig.authorizedKeysPath,
    authorizedKeysContents: resolvedPaths.authorizedKeysContents,
    envGlobalPath: config.envGlobalPath,
    envProjectPath: config.envProjectPath,
    codexAuthPath: config.codexAuthPath,
    codexHome: config.codexHome,
    cpuLimit: config.cpuLimit,
    ramLimit: config.ramLimit,
    gpu: config.gpu,
    dockerNetworkMode: config.dockerNetworkMode,
    dockerSharedNetworkName: config.dockerSharedNetworkName,
    enableMcpPlaywright: config.enableMcpPlaywright,
    outDir: command.outDir,
    gitTokenLabel: config.gitTokenLabel,
    skipGithubAuth: config.skipGithubAuth,
    useManagedAuthorizedKeys: true,
    codexTokenLabel: config.codexAuthLabel,
    claudeTokenLabel: config.claudeAuthLabel,
    geminiTokenLabel: config.geminiAuthLabel,
    grokTokenLabel: config.grokAuthLabel,
    agentAutoMode: config.agentAuto ? (config.agentMode ?? "auto") : undefined,
    up: command.runUp,
    openSsh: false,
    force: command.force,
    forceEnv: command.forceEnv,
    waitForClone: command.waitForClone,
    ...(options?.async === true ? { async: true } : {})
  } satisfies JsonRequest
}

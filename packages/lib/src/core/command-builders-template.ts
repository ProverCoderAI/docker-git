import type { NameConfig, PathConfig, RepoBasics } from "./command-builders.js"
import { type AgentMode, type CreateCommand, defaultTemplateConfig } from "./domain.js"

export type BuildTemplateConfigInput = {
  readonly repo: RepoBasics
  readonly names: NameConfig
  readonly paths: PathConfig
  readonly cpuLimit: string | undefined
  readonly ramLimit: string | undefined
  readonly playwrightCpuLimit: string | undefined
  readonly playwrightRamLimit: string | undefined
  readonly gpu: CreateCommand["config"]["gpu"]
  readonly dockerNetworkMode: CreateCommand["config"]["dockerNetworkMode"]
  readonly dockerSharedNetworkName: string
  readonly gitTokenLabel: string | undefined
  readonly skipGithubAuth: boolean
  readonly codexAuthLabel: string | undefined
  readonly claudeAuthLabel: string | undefined
  readonly geminiAuthLabel: string | undefined
  readonly grokAuthLabel: string | undefined
  readonly enableMcpPlaywright: boolean
  readonly enableMcpAndroid: boolean
  readonly agentMode: AgentMode | undefined
  readonly agentAuto: boolean
  /**
   * Hostname where the source project was cloned.
   *
   * @pure true - immutable template-builder input.
   * @effect none
   * @invariant if present, template config preserves this value without reading OS hostname.
   * @precondition boundary validation rejects malformed hostnames before constructing this input.
   * @postcondition buildTemplateConfig propagates the value into docker-git.json.
   * @complexity O(1)/O(1)
   */
  readonly clonedOnHostname?: string | undefined
}

const buildTemplateConfigBase = (
  input: Pick<BuildTemplateConfigInput, "repo" | "names" | "paths">
): Pick<
  CreateCommand["config"],
  | "containerName"
  | "serviceName"
  | "sshUser"
  | "sshPort"
  | "repoUrl"
  | "repoRef"
  | "targetDir"
  | "volumeName"
  | "dockerGitPath"
  | "authorizedKeysPath"
  | "envGlobalPath"
  | "envProjectPath"
  | "codexAuthPath"
  | "codexSharedAuthPath"
  | "codexHome"
  | "geminiAuthPath"
  | "geminiHome"
  | "grokAuthPath"
  | "grokHome"
> => ({
  containerName: input.names.containerName,
  serviceName: input.names.serviceName,
  sshUser: input.repo.sshUser,
  sshPort: input.repo.sshPort,
  repoUrl: input.repo.repoUrl,
  repoRef: input.repo.repoRef,
  targetDir: input.repo.targetDir,
  volumeName: input.names.volumeName,
  dockerGitPath: input.paths.dockerGitPath,
  authorizedKeysPath: input.paths.authorizedKeysPath,
  envGlobalPath: input.paths.envGlobalPath,
  envProjectPath: input.paths.envProjectPath,
  codexAuthPath: input.paths.codexAuthPath,
  codexSharedAuthPath: input.paths.codexSharedAuthPath,
  codexHome: input.paths.codexHome,
  geminiAuthPath: input.paths.geminiAuthPath,
  geminiHome: input.paths.geminiHome,
  grokAuthPath: input.paths.grokAuthPath,
  grokHome: input.paths.grokHome
})

export const buildTemplateConfig = (input: BuildTemplateConfigInput): CreateCommand["config"] => ({
  ...buildTemplateConfigBase(input),
  gitTokenLabel: input.gitTokenLabel,
  skipGithubAuth: input.skipGithubAuth,
  codexAuthLabel: input.codexAuthLabel,
  claudeAuthLabel: input.claudeAuthLabel,
  geminiAuthLabel: input.geminiAuthLabel,
  grokAuthLabel: input.grokAuthLabel,
  cpuLimit: input.cpuLimit,
  ramLimit: input.ramLimit,
  playwrightCpuLimit: input.playwrightCpuLimit,
  playwrightRamLimit: input.playwrightRamLimit,
  gpu: input.gpu,
  dockerNetworkMode: input.dockerNetworkMode,
  dockerSharedNetworkName: input.dockerSharedNetworkName,
  enableMcpPlaywright: input.enableMcpPlaywright,
  enableMcpAndroid: input.enableMcpAndroid,
  bunVersion: defaultTemplateConfig.bunVersion,
  agentMode: input.agentMode,
  agentAuto: input.agentAuto,
  clonedOnHostname: input.clonedOnHostname
})

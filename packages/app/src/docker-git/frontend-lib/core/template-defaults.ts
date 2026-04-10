/* jscpd:ignore-start */
import type { TemplateConfig } from "./domain.js"

type DefaultTemplateConfig = Pick<
  TemplateConfig,
  | "containerName"
  | "serviceName"
  | "sshUser"
  | "sshPort"
  | "repoRef"
  | "targetDir"
  | "volumeName"
  | "skipGithubAuth"
  | "dockerGitPath"
  | "authorizedKeysPath"
  | "envGlobalPath"
  | "envProjectPath"
  | "codexAuthPath"
  | "codexSharedAuthPath"
  | "codexHome"
  | "geminiAuthPath"
  | "geminiHome"
  | "cpuLimit"
  | "ramLimit"
  | "dockerNetworkMode"
  | "dockerSharedNetworkName"
  | "enableMcpPlaywright"
  | "bunVersion"
>

export const defaultDockerNetworkMode: TemplateConfig["dockerNetworkMode"] = "shared"

export const defaultDockerSharedNetworkName = "docker-git-shared"
export const dockerGitSharedCacheVolumeName = "docker-git-shared-cache"
export const dockerGitSharedCodexVolumeName = "docker-git-shared-codex"

export const defaultCpuLimit = "30%"

export const defaultRamLimit = "30%"

export const defaultTemplateConfig = {
  containerName: "dev-ssh",
  serviceName: "dev",
  sshUser: "dev",
  sshPort: 2222,
  repoRef: "main",
  targetDir: "/home/dev/app",
  volumeName: "dev_home",
  skipGithubAuth: false,
  dockerGitPath: "./.docker-git",
  authorizedKeysPath: "./.docker-git/authorized_keys",
  envGlobalPath: "./.docker-git/.orch/env/global.env",
  envProjectPath: "./.orch/env/project.env",
  codexAuthPath: "./.docker-git/.orch/auth/codex",
  codexSharedAuthPath: "./.docker-git/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  geminiAuthPath: "./.docker-git/.orch/auth/gemini",
  geminiHome: "/home/dev/.gemini",
  cpuLimit: defaultCpuLimit,
  ramLimit: defaultRamLimit,
  dockerNetworkMode: defaultDockerNetworkMode,
  dockerSharedNetworkName: defaultDockerSharedNetworkName,
  enableMcpPlaywright: false,
  bunVersion: "1.3.11"
} satisfies DefaultTemplateConfig
/* jscpd:ignore-end */

/* jscpd:ignore-start */
import type { ProjectConfig } from "../core/domain.js"

export { defaultProjectsRoot, findSshPrivateKey, resolveAuthorizedKeysPath } from "./path-helpers.js"

export const isRepoUrlInput = (input: string): boolean => {
  const trimmed = input.trim().toLowerCase()
  return trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("ssh://") ||
    trimmed.startsWith("git@")
}

type ConnectionInfoOptions = {
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly sshCommand: string
  readonly editorAccessDetails?: string
}

export const formatConnectionInfo = (
  cwd: string,
  config: ProjectConfig,
  options: ConnectionInfoOptions
): string => {
  const hostnameLabel = config.template.clonedOnHostname === undefined
    ? ""
    : `\nCloned on device: ${config.template.clonedOnHostname}`
  const editorAccessLabel = options.editorAccessDetails === undefined ? "" : `\n${options.editorAccessDetails}`
  return `Project directory: ${cwd}
` +
    `Container: ${config.template.containerName}
` +
    `Service: ${config.template.serviceName}
` +
    `SSH command: ${options.sshCommand}
` +
    `Repo: ${config.template.repoUrl} (${config.template.repoRef})
` +
    `Workspace: ${config.template.targetDir}
` +
    `Authorized keys: ${options.authorizedKeysPath}${options.authorizedKeysExists ? "" : " (missing)"}
` +
    `Env global: ${config.template.envGlobalPath}
` +
    `Env project: ${config.template.envProjectPath}
` +
    `Codex auth: ${config.template.codexAuthPath} -> ${config.template.codexHome}` +
    editorAccessLabel +
    hostnameLabel
}
/* jscpd:ignore-end */

import type { ProjectConfig } from "../core/domain.js"

export { defaultProjectsRoot, findSshPrivateKey, resolveAuthorizedKeysPath } from "./path-helpers.js"

export const isRepoUrlInput = (input: string): boolean => {
  const trimmed = input.trim().toLowerCase()
  return trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("ssh://") ||
    trimmed.startsWith("git@")
}

export const formatConnectionInfo = (
  cwd: string,
  config: ProjectConfig,
  authorizedKeysPath: string,
  authorizedKeysExists: boolean,
  sshCommand: string,
  editorAccessDetails?: string
): string => {
  const hostnameLabel = config.template.clonedOnHostname === undefined
    ? ""
    : `\nCloned on device: ${config.template.clonedOnHostname}`
  const editorAccessLabel = editorAccessDetails === undefined ? "" : `\n${editorAccessDetails}`
  return `Project directory: ${cwd}
` +
    `Container: ${config.template.containerName}
` +
    `Service: ${config.template.serviceName}
` +
    `SSH command: ${sshCommand}
` +
    `Repo: ${config.template.repoUrl} (${config.template.repoRef})
` +
    `Workspace: ${config.template.targetDir}
` +
    `Authorized keys: ${authorizedKeysPath}${authorizedKeysExists ? "" : " (missing)"}
` +
    `Env global: ${config.template.envGlobalPath}
` +
    `Env project: ${config.template.envProjectPath}
` +
    `Codex auth: ${config.template.codexAuthPath} -> ${config.template.codexHome}` +
    editorAccessLabel +
    hostnameLabel
}

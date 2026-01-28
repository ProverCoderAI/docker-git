import type { ProjectConfig } from "../core/domain.js"

export { findSshPrivateKey } from "./path-helpers.js"

export const defaultProjectsRoot = (cwd: string): string => {
  const explicit = process.env["DOCKER_GIT_PROJECTS_ROOT"]?.trim()
  if (explicit && explicit.length > 0) {
    return explicit
  }

  return `${cwd}/.docker-git`
}

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
  sshCommand: string
): string =>
  `Project directory: ${cwd}
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
  `Codex auth: ${config.template.codexAuthPath} -> ${config.template.codexHome}`

export { resolveAuthorizedKeysPath } from "./path-helpers.js"

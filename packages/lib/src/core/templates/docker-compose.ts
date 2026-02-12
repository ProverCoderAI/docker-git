import type { TemplateConfig } from "../domain.js"

export const renderDockerCompose = (config: TemplateConfig): string => {
  const networkName = `${config.serviceName}-net`
  const forkRepoUrl = config.forkRepoUrl ?? ""

  const browserServiceName = `${config.serviceName}-browser`
  const browserContainerName = `${config.containerName}-browser`
  const browserVolumeName = `${config.volumeName}-browser`
  const browserDockerfile = "Dockerfile.browser"
  const browserCdpEndpoint = `http://${browserServiceName}:9223`

  const maybeDependsOn = config.enableMcpPlaywright
    ? `    depends_on:\n      - ${browserServiceName}\n`
    : ""
  const maybePlaywrightEnv = config.enableMcpPlaywright
    ? `      MCP_PLAYWRIGHT_ENABLE: "1"\n      MCP_PLAYWRIGHT_CDP_ENDPOINT: "${browserCdpEndpoint}"\n`
    : ""
  const maybeBrowserService = config.enableMcpPlaywright
    ? `\n  ${browserServiceName}:\n    build:\n      context: .\n      dockerfile: ${browserDockerfile}\n    container_name: ${browserContainerName}\n    environment:\n      VNC_NOPW: "1"\n    shm_size: "2gb"\n    expose:\n      - "9223"\n    volumes:\n      - ${browserVolumeName}:/data\n    networks:\n      - ${networkName}\n`
    : ""
  const maybeBrowserVolume = config.enableMcpPlaywright ? `  ${browserVolumeName}:\n` : ""

  return `services:
  ${config.serviceName}:
    build: .
    container_name: ${config.containerName}
    environment:
      REPO_URL: "${config.repoUrl}"
      REPO_REF: "${config.repoRef}"
      FORK_REPO_URL: "${forkRepoUrl}"
      TARGET_DIR: "${config.targetDir}"
      CODEX_HOME: "${config.codexHome}"
${maybePlaywrightEnv}${maybeDependsOn}    env_file:
      - ${config.envGlobalPath}
      - ${config.envProjectPath}
    ports:
      - "127.0.0.1:${config.sshPort}:22"
    volumes:
      - ${config.volumeName}:/home/${config.sshUser}
      - ${config.dockerGitPath}:/home/${config.sshUser}/.docker-git
      - ${config.authorizedKeysPath}:/authorized_keys:ro
      - ${config.codexAuthPath}:${config.codexHome}
      - ${config.codexSharedAuthPath}:${config.codexHome}-shared
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ${networkName}
${maybeBrowserService}

networks:
  ${networkName}:
    driver: bridge

volumes:
  ${config.volumeName}:
${maybeBrowserVolume}`
}

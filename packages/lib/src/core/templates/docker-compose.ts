import type { TemplateConfig } from "../domain.js"

type ComposeFragments = {
  readonly networkName: string
  readonly maybeGitTokenLabelEnv: string
  readonly maybeCodexAuthLabelEnv: string
  readonly maybeClaudeAuthLabelEnv: string
  readonly maybeDependsOn: string
  readonly maybePlaywrightEnv: string
  readonly maybeBrowserService: string
  readonly maybeBrowserVolume: string
  readonly forkRepoUrl: string
}

type PlaywrightFragments = Pick<
  ComposeFragments,
  "maybeDependsOn" | "maybePlaywrightEnv" | "maybeBrowserService" | "maybeBrowserVolume"
>

const renderGitTokenLabelEnv = (gitTokenLabel: string): string =>
  gitTokenLabel.length > 0
    ? `      GITHUB_AUTH_LABEL: "${gitTokenLabel}"\n      GIT_AUTH_LABEL: "${gitTokenLabel}"\n`
    : ""

const renderCodexAuthLabelEnv = (codexAuthLabel: string): string =>
  codexAuthLabel.length > 0
    ? `      CODEX_AUTH_LABEL: "${codexAuthLabel}"\n`
    : ""

const renderClaudeAuthLabelEnv = (claudeAuthLabel: string): string =>
  claudeAuthLabel.length > 0
    ? `      CLAUDE_AUTH_LABEL: "${claudeAuthLabel}"\n`
    : ""

const buildPlaywrightFragments = (
  config: TemplateConfig,
  networkName: string
): PlaywrightFragments => {
  if (!config.enableMcpPlaywright) {
    return {
      maybeDependsOn: "",
      maybePlaywrightEnv: "",
      maybeBrowserService: "",
      maybeBrowserVolume: ""
    }
  }

  const browserServiceName = `${config.serviceName}-browser`
  const browserContainerName = `${config.containerName}-browser`
  const browserVolumeName = `${config.volumeName}-browser`
  const browserDockerfile = "Dockerfile.browser"
  const browserCdpEndpoint = `http://${browserServiceName}:9223`

  return {
    maybeDependsOn: `    depends_on:\n      - ${browserServiceName}\n`,
    maybePlaywrightEnv:
      `      MCP_PLAYWRIGHT_ENABLE: "1"\n      MCP_PLAYWRIGHT_CDP_ENDPOINT: "${browserCdpEndpoint}"\n`,
    maybeBrowserService:
      `\n  ${browserServiceName}:\n    build:\n      context: .\n      dockerfile: ${browserDockerfile}\n    container_name: ${browserContainerName}\n    environment:\n      VNC_NOPW: "1"\n    shm_size: "2gb"\n    expose:\n      - "9223"\n    volumes:\n      - ${browserVolumeName}:/data\n    networks:\n      - ${networkName}\n`,
    maybeBrowserVolume: `  ${browserVolumeName}:\n`
  }
}

const buildComposeFragments = (config: TemplateConfig): ComposeFragments => {
  const networkName = `${config.serviceName}-net`
  const forkRepoUrl = config.forkRepoUrl ?? ""
  const gitTokenLabel = config.gitTokenLabel?.trim() ?? ""
  const codexAuthLabel = config.codexAuthLabel?.trim() ?? ""
  const claudeAuthLabel = config.claudeAuthLabel?.trim() ?? ""
  const maybeGitTokenLabelEnv = renderGitTokenLabelEnv(gitTokenLabel)
  const maybeCodexAuthLabelEnv = renderCodexAuthLabelEnv(codexAuthLabel)
  const maybeClaudeAuthLabelEnv = renderClaudeAuthLabelEnv(claudeAuthLabel)
  const playwright = buildPlaywrightFragments(config, networkName)

  return {
    networkName,
    maybeGitTokenLabelEnv,
    maybeCodexAuthLabelEnv,
    maybeClaudeAuthLabelEnv,
    maybeDependsOn: playwright.maybeDependsOn,
    maybePlaywrightEnv: playwright.maybePlaywrightEnv,
    maybeBrowserService: playwright.maybeBrowserService,
    maybeBrowserVolume: playwright.maybeBrowserVolume,
    forkRepoUrl
  }
}

const renderComposeServices = (config: TemplateConfig, fragments: ComposeFragments): string =>
  `services:
  ${config.serviceName}:
    build: .
    container_name: ${config.containerName}
    environment:
      REPO_URL: "${config.repoUrl}"
      REPO_REF: "${config.repoRef}"
      FORK_REPO_URL: "${fragments.forkRepoUrl}"
${fragments.maybeGitTokenLabelEnv}      # Optional token label selector (maps to GITHUB_TOKEN__<LABEL>/GIT_AUTH_TOKEN__<LABEL>)
${fragments.maybeCodexAuthLabelEnv}      # Optional Codex account label selector (maps to CODEX_AUTH_LABEL)
${fragments.maybeClaudeAuthLabelEnv}      # Optional Claude account label selector (maps to CLAUDE_AUTH_LABEL)
      TARGET_DIR: "${config.targetDir}"
      CODEX_HOME: "${config.codexHome}"
${fragments.maybePlaywrightEnv}${fragments.maybeDependsOn}    env_file:
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
      - ${fragments.networkName}
${fragments.maybeBrowserService}`

const renderComposeNetworks = (networkName: string): string =>
  `networks:
  ${networkName}:
    driver: bridge`

const renderComposeVolumes = (config: TemplateConfig, maybeBrowserVolume: string): string =>
  `volumes:
  ${config.volumeName}:
${maybeBrowserVolume}`

export const renderDockerCompose = (config: TemplateConfig): string => {
  const fragments = buildComposeFragments(config)
  return [
    renderComposeServices(config, fragments),
    renderComposeNetworks(fragments.networkName),
    renderComposeVolumes(config, fragments.maybeBrowserVolume)
  ].join("\n\n")
}

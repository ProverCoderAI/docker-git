import { resolveComposeNetworkName, type TemplateConfig } from "../domain.js"
import type { ResolvedComposeResourceLimits } from "../resource-limits.js"

type ComposeFragments = {
  readonly networkMode: TemplateConfig["dockerNetworkMode"]
  readonly networkName: string
  readonly maybeGitTokenLabelEnv: string
  readonly maybeCodexAuthLabelEnv: string
  readonly maybeClaudeAuthLabelEnv: string
  readonly maybeAgentModeEnv: string
  readonly maybeAgentAutoEnv: string
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

const renderAgentModeEnv = (agentMode: string | undefined): string =>
  agentMode !== undefined && agentMode.length > 0
    ? `      AGENT_MODE: "${agentMode}"\n`
    : ""

const renderAgentAutoEnv = (agentAuto: boolean | undefined): string =>
  agentAuto === true
    ? `      AGENT_AUTO: "1"\n`
    : ""

const renderProjectsRootHostMount = (projectsRoot: string): string =>
  `\${DOCKER_GIT_PROJECTS_ROOT_HOST:-${projectsRoot}}`

const renderSharedCodexHostMount = (projectsRoot: string): string =>
  `\${DOCKER_GIT_PROJECTS_ROOT_HOST:-${projectsRoot}}/.orch/auth/codex`

// CHANGE: render authorized_keys mount with DOCKER_GIT_PROJECTS_ROOT_HOST override
// WHY: in Docker-in-Docker scenarios the relative path resolves on the outer host, not the container;
//      without the host override Docker creates an empty directory instead of mounting the file
// PURITY: CORE
const renderAuthorizedKeysHostMount = (dockerGitPath: string, authorizedKeysPath: string): string => {
  const prefix = `${dockerGitPath}/`
  if (authorizedKeysPath.startsWith(prefix)) {
    const suffix = authorizedKeysPath.slice(prefix.length)
    return `\${DOCKER_GIT_PROJECTS_ROOT_HOST:-${dockerGitPath}}/${suffix}`
  }
  return authorizedKeysPath
}

const renderResourceLimits = (resourceLimits: ResolvedComposeResourceLimits | undefined): string =>
  resourceLimits === undefined
    ? ""
    : `    cpus: ${resourceLimits.cpuLimit}\n    mem_limit: "${resourceLimits.ramLimit}"\n    memswap_limit: "${resourceLimits.ramLimit}"\n`

const buildPlaywrightFragments = (
  config: TemplateConfig,
  networkName: string,
  resourceLimits: ResolvedComposeResourceLimits | undefined
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
    maybeDependsOn: `    depends_on:\n      ${browserServiceName}:\n        condition: service_healthy\n`,
    maybePlaywrightEnv:
      `      MCP_PLAYWRIGHT_ENABLE: "1"\n      MCP_PLAYWRIGHT_CDP_ENDPOINT: "${browserCdpEndpoint}"\n`,
    maybeBrowserService:
      `\n  ${browserServiceName}:\n    build:\n      context: .\n      dockerfile: ${browserDockerfile}\n    container_name: ${browserContainerName}\n    restart: unless-stopped\n${
        renderResourceLimits(resourceLimits)
      }    healthcheck:\n      test: ["CMD", "curl", "-sf", "http://localhost:9223/json/version"]\n      interval: 5s\n      timeout: 3s\n      retries: 10\n      start_period: 15s\n    environment:\n      VNC_NOPW: "1"\n    shm_size: "2gb"\n    expose:\n      - "9223"\n    volumes:\n      - ${browserVolumeName}:/data\n    networks:\n      - ${networkName}\n`,
    maybeBrowserVolume: `  ${browserVolumeName}:\n`
  }
}

const buildComposeFragments = (
  config: TemplateConfig,
  resourceLimits: ResolvedComposeResourceLimits | undefined
): ComposeFragments => {
  const networkMode = config.dockerNetworkMode
  const networkName = resolveComposeNetworkName(config)
  const forkRepoUrl = config.forkRepoUrl ?? ""
  const gitTokenLabel = config.gitTokenLabel?.trim() ?? ""
  const codexAuthLabel = config.codexAuthLabel?.trim() ?? ""
  const claudeAuthLabel = config.claudeAuthLabel?.trim() ?? ""
  const maybeGitTokenLabelEnv = renderGitTokenLabelEnv(gitTokenLabel)
  const maybeCodexAuthLabelEnv = renderCodexAuthLabelEnv(codexAuthLabel)
  const maybeClaudeAuthLabelEnv = renderClaudeAuthLabelEnv(claudeAuthLabel)
  const maybeAgentModeEnv = renderAgentModeEnv(config.agentMode)
  const maybeAgentAutoEnv = renderAgentAutoEnv(config.agentAuto)
  const playwright = buildPlaywrightFragments(config, networkName, resourceLimits)

  return {
    networkMode,
    networkName,
    maybeGitTokenLabelEnv,
    maybeCodexAuthLabelEnv,
    maybeClaudeAuthLabelEnv,
    maybeAgentModeEnv,
    maybeAgentAutoEnv,
    maybeDependsOn: playwright.maybeDependsOn,
    maybePlaywrightEnv: playwright.maybePlaywrightEnv,
    maybeBrowserService: playwright.maybeBrowserService,
    maybeBrowserVolume: playwright.maybeBrowserVolume,
    forkRepoUrl
  }
}

const renderComposeServices = (
  config: TemplateConfig,
  fragments: ComposeFragments,
  resourceLimits: ResolvedComposeResourceLimits | undefined
): string =>
  `services:
  ${config.serviceName}:
    build: .
    container_name: ${config.containerName}
    restart: unless-stopped
    environment:
      REPO_URL: "${config.repoUrl}"
      REPO_REF: "${config.repoRef}"
      FORK_REPO_URL: "${fragments.forkRepoUrl}"
${fragments.maybeGitTokenLabelEnv}      # Optional token label selector (maps to GITHUB_TOKEN__<LABEL>/GIT_AUTH_TOKEN__<LABEL>)
${fragments.maybeCodexAuthLabelEnv}      # Optional Codex account label selector (maps to CODEX_AUTH_LABEL)
${fragments.maybeClaudeAuthLabelEnv}${fragments.maybeAgentModeEnv}${fragments.maybeAgentAutoEnv}      # Optional Claude account label selector (maps to CLAUDE_AUTH_LABEL)
      TARGET_DIR: "${config.targetDir}"
      CODEX_HOME: "${config.codexHome}"
${fragments.maybePlaywrightEnv}${fragments.maybeDependsOn}    env_file:
      - ${config.envGlobalPath}
      - ${config.envProjectPath}
    ports:
      - "127.0.0.1:${config.sshPort}:22"
${renderResourceLimits(resourceLimits)}    volumes:
      - ${config.volumeName}:/home/${config.sshUser}
      - ${renderProjectsRootHostMount(config.dockerGitPath)}:/home/${config.sshUser}/.docker-git
      - ${renderAuthorizedKeysHostMount(config.dockerGitPath, config.authorizedKeysPath)}:/authorized_keys:ro
      - ${config.codexAuthPath}:${config.codexHome}
      - ${renderSharedCodexHostMount(config.dockerGitPath)}:${config.codexHome}-shared
      - /var/run/docker.sock:/var/run/docker.sock
    networks:
      - ${fragments.networkName}
${fragments.maybeBrowserService}`

const renderComposeNetworks = (
  networkMode: TemplateConfig["dockerNetworkMode"],
  networkName: string
): string =>
  networkMode === "shared"
    ? `networks:
  ${networkName}:
    external: true`
    : `networks:
  ${networkName}:
    driver: bridge`

const renderComposeVolumes = (config: TemplateConfig, maybeBrowserVolume: string): string =>
  `volumes:
  ${config.volumeName}:
${maybeBrowserVolume}`

export const renderDockerCompose = (
  config: TemplateConfig,
  resourceLimits?: ResolvedComposeResourceLimits
): string => {
  const fragments = buildComposeFragments(config, resourceLimits)
  return [
    renderComposeServices(config, fragments, resourceLimits),
    renderComposeNetworks(fragments.networkMode, fragments.networkName),
    renderComposeVolumes(config, fragments.maybeBrowserVolume)
  ].join("\n\n")
}

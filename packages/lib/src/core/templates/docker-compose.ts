import {
  dockerGitSharedCacheVolumeName,
  dockerGitSharedCodexVolumeName,
  resolveComposeNetworkName,
  resolveComposeProjectName,
  resolveProjectBootstrapVolumeName,
  type TemplateConfig
} from "../domain.js"
import type { ResolvedComposeResourceLimits } from "../resource-limits.js"

type ComposeFragments = {
  readonly networkMode: TemplateConfig["dockerNetworkMode"]
  readonly networkName: string
  readonly maybeGithubAuthSkipEnv: string
  readonly maybeGitTokenLabelEnv: string
  readonly maybeCodexAuthLabelEnv: string
  readonly maybeClaudeAuthLabelEnv: string
  readonly maybeAgentModeEnv: string
  readonly maybeAgentAutoEnv: string
  readonly maybeDependsOn: string
  readonly maybePlaywrightEnv: string
  readonly maybeBrowserService: string
  readonly maybeBrowserVolume: string
  readonly maybeBootstrapMounts: string
  readonly forkRepoUrl: string
}

type PlaywrightFragments = Pick<
  ComposeFragments,
  "maybeDependsOn" | "maybePlaywrightEnv" | "maybeBrowserService" | "maybeBrowserVolume"
>

export type ComposeResourceLimits = {
  readonly main: ResolvedComposeResourceLimits | undefined
  readonly playwright: ResolvedComposeResourceLimits | undefined
}

const sharedCodexVolumeKey = "docker_git_shared_codex"
const sharedCacheVolumeKey = "docker_git_shared_cache"
const bootstrapVolumeKey = "docker_git_bootstrap"

const renderGitTokenLabelEnv = (gitTokenLabel: string): string =>
  gitTokenLabel.length > 0
    ? `      GITHUB_AUTH_LABEL: "${gitTokenLabel}"\n      GIT_AUTH_LABEL: "${gitTokenLabel}"\n`
    : ""

const renderGithubAuthSkipEnv = (skipGithubAuth: boolean): string =>
  skipGithubAuth
    ? `      GITHUB_AUTH_SKIP: "1"\n`
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

const renderResourceLimits = (resourceLimits: ResolvedComposeResourceLimits | undefined): string =>
  resourceLimits === undefined
    ? ""
    : `    cpus: ${resourceLimits.cpuLimit}\n    mem_limit: "${resourceLimits.ramLimit}"\n    memswap_limit: "${resourceLimits.swapLimit}"\n`

const renderGpu = (gpu: TemplateConfig["gpu"]): string =>
  gpu === "all"
    ? "    gpus: all\n"
    : ""

const renderBootstrapMounts = (): string => `      - ${bootstrapVolumeKey}:/opt/docker-git/bootstrap/source:ro`

const renderEnvFiles = (config: TemplateConfig): string =>
  `    env_file:\n      - ${config.envGlobalPath}\n      - ${config.envProjectPath}\n`

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
    maybeDependsOn: `    depends_on:\n      - ${browserServiceName}\n`,
    maybePlaywrightEnv:
      `      MCP_PLAYWRIGHT_ENABLE: "1"\n      MCP_PLAYWRIGHT_CDP_ENDPOINT: "${browserCdpEndpoint}"\n`,
    maybeBrowserService:
      `\n  ${browserServiceName}:\n    build:\n      context: .\n      dockerfile: ${browserDockerfile}\n    container_name: ${browserContainerName}\n    restart: unless-stopped\n${
        renderResourceLimits(resourceLimits)
      }${
        renderEnvFiles(config)
      }    environment:\n      VNC_NOPW: "1"\n    shm_size: "2gb"\n    expose:\n      - "9223"\n    dns:\n      - 8.8.8.8\n      - 8.8.4.4\n      - 1.1.1.1\n    volumes:\n      - ${browserVolumeName}:/data\n    networks:\n      - ${networkName}\n`,
    maybeBrowserVolume: `  ${browserVolumeName}:`
  }
}

const isResolvedComposeResourceLimits = (
  value: ResolvedComposeResourceLimits | ComposeResourceLimits
): value is ResolvedComposeResourceLimits => "cpuLimit" in value && "ramLimit" in value && "swapLimit" in value

const normalizeComposeResourceLimits = (
  resourceLimits: ResolvedComposeResourceLimits | ComposeResourceLimits | undefined
): ComposeResourceLimits => {
  if (resourceLimits === undefined) {
    return { main: undefined, playwright: undefined }
  }
  if (isResolvedComposeResourceLimits(resourceLimits)) {
    return { main: resourceLimits, playwright: resourceLimits }
  }
  return resourceLimits
}

const buildComposeFragments = (
  config: TemplateConfig,
  resourceLimits: ComposeResourceLimits
): ComposeFragments => {
  const networkMode = config.dockerNetworkMode
  const networkName = resolveComposeNetworkName(config)
  const forkRepoUrl = config.forkRepoUrl ?? ""
  const maybeGithubAuthSkipEnv = renderGithubAuthSkipEnv(config.skipGithubAuth)
  const gitTokenLabel = config.gitTokenLabel?.trim() ?? ""
  const codexAuthLabel = config.codexAuthLabel?.trim() ?? ""
  const claudeAuthLabel = config.claudeAuthLabel?.trim() ?? ""
  const maybeGitTokenLabelEnv = renderGitTokenLabelEnv(gitTokenLabel)
  const maybeCodexAuthLabelEnv = renderCodexAuthLabelEnv(codexAuthLabel)
  const maybeClaudeAuthLabelEnv = renderClaudeAuthLabelEnv(claudeAuthLabel)
  const maybeAgentModeEnv = renderAgentModeEnv(config.agentMode)
  const maybeAgentAutoEnv = renderAgentAutoEnv(config.agentAuto)
  const playwright = buildPlaywrightFragments(config, networkName, resourceLimits.playwright)

  return {
    networkMode,
    networkName,
    maybeGithubAuthSkipEnv,
    maybeGitTokenLabelEnv,
    maybeCodexAuthLabelEnv,
    maybeClaudeAuthLabelEnv,
    maybeAgentModeEnv,
    maybeAgentAutoEnv,
    maybeDependsOn: playwright.maybeDependsOn,
    maybePlaywrightEnv: playwright.maybePlaywrightEnv,
    maybeBrowserService: playwright.maybeBrowserService,
    maybeBrowserVolume: playwright.maybeBrowserVolume,
    maybeBootstrapMounts: renderBootstrapMounts(),
    forkRepoUrl
  }
}

const renderComposeServices = (
  config: TemplateConfig,
  fragments: ComposeFragments,
  resourceLimits: ComposeResourceLimits
): string =>
  `services:
  ${config.serviceName}:
    build: .
    container_name: ${config.containerName}
    restart: unless-stopped
${renderGpu(config.gpu)}${
    renderEnvFiles(config)
  }    # runtime auth/env must be loaded into the container process, not only bootstrap scripts
    environment:
      REPO_URL: "${config.repoUrl}"
      REPO_REF: "${config.repoRef}"
      FORK_REPO_URL: "${fragments.forkRepoUrl}"
${fragments.maybeGithubAuthSkipEnv}      # Optional anonymous public GitHub clone override
${fragments.maybeGitTokenLabelEnv}      # Optional token label selector (maps to GITHUB_TOKEN__<LABEL>/GIT_AUTH_TOKEN__<LABEL>)
${fragments.maybeCodexAuthLabelEnv}      # Optional Codex account label selector (maps to CODEX_AUTH_LABEL)
${fragments.maybeClaudeAuthLabelEnv}${fragments.maybeAgentModeEnv}${fragments.maybeAgentAutoEnv}      # Optional Claude account label selector (maps to CLAUDE_AUTH_LABEL)
      # Optional isolated Docker daemon endpoint injected by the API controller.
      DOCKER_GIT_PROJECT_DOCKER_HOST: "\${DOCKER_GIT_PROJECT_DOCKER_HOST:-}"
      TARGET_DIR: "${config.targetDir}"
      CODEX_HOME: "${config.codexHome}"
${fragments.maybePlaywrightEnv}${fragments.maybeDependsOn}    # bootstrap auth/env arrives through docker_git_bootstrap
    ports:
      - "\${DOCKER_GIT_PROJECT_SSH_BIND_HOST:-127.0.0.1}:${config.sshPort}:22"
${renderResourceLimits(resourceLimits.main)}    volumes:
      - ${config.volumeName}:/home/${config.sshUser}
      - ${sharedCacheVolumeKey}:/home/${config.sshUser}/.docker-git/.cache
      - ${sharedCodexVolumeKey}:${config.codexHome}-shared
${fragments.maybeBootstrapMounts}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    dns:
      - 8.8.8.8
      - 8.8.4.4
      - 1.1.1.1
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
  [
    "volumes:",
    `  ${config.volumeName}:`,
    `  ${bootstrapVolumeKey}:`,
    `    name: ${resolveProjectBootstrapVolumeName(config)}`,
    `  ${sharedCacheVolumeKey}:`,
    "    external: true",
    `    name: ${dockerGitSharedCacheVolumeName}`,
    `  ${sharedCodexVolumeKey}:`,
    "    external: true",
    `    name: ${dockerGitSharedCodexVolumeName}`,
    maybeBrowserVolume
  ].filter((entry) => entry.length > 0).join("\n")

export const renderDockerCompose = (
  config: TemplateConfig,
  resourceLimits?: ResolvedComposeResourceLimits | ComposeResourceLimits
): string => {
  const limits = normalizeComposeResourceLimits(resourceLimits)
  const fragments = buildComposeFragments(config, limits)
  return [
    `name: ${resolveComposeProjectName(config)}`,
    renderComposeServices(config, fragments, limits),
    renderComposeNetworks(fragments.networkMode, fragments.networkName),
    renderComposeVolumes(config, fragments.maybeBrowserVolume)
  ].join("\n\n")
}

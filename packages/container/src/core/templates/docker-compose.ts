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
  readonly maybeGeminiAuthLabelEnv: string
  readonly maybeGrokAuthLabelEnv: string
  readonly maybeAgentModeEnv: string
  readonly maybeAgentAutoEnv: string
  readonly maybeDependsOn: string
  readonly maybeDockerSocketMount: string
  readonly maybePlaywrightEnv: string
  readonly maybeBrowserVolume: string
  readonly maybeAndroidEnv: string
  readonly maybeAndroidService: string
  readonly maybeAndroidVolume: string
  readonly maybeBootstrapMounts: string
  readonly forkRepoUrl: string
}

type PlaywrightFragments = Pick<
  ComposeFragments,
  | "maybeDependsOn"
  | "maybeDockerSocketMount"
  | "maybePlaywrightEnv"
  | "maybeBrowserVolume"
>

type AndroidFragments = Pick<
  ComposeFragments,
  | "maybeAndroidEnv"
  | "maybeAndroidService"
  | "maybeAndroidVolume"
>

type AuthEnvFragments = Pick<
  ComposeFragments,
  | "maybeGitTokenLabelEnv"
  | "maybeCodexAuthLabelEnv"
  | "maybeClaudeAuthLabelEnv"
  | "maybeGeminiAuthLabelEnv"
  | "maybeGrokAuthLabelEnv"
>

type AgentEnvFragments = Pick<
  ComposeFragments,
  "maybeAgentModeEnv" | "maybeAgentAutoEnv"
>

export type DockerComposeRenderOptions = {
  readonly enableLocalDockerSocket: boolean
}

export type ComposeResourceLimits = {
  readonly main: ResolvedComposeResourceLimits | undefined
  readonly playwright: ResolvedComposeResourceLimits | undefined
}

const defaultDockerComposeRenderOptions: DockerComposeRenderOptions = {
  enableLocalDockerSocket: false
}
const sharedCodexVolumeKey = "docker_git_shared_codex"
const sharedCacheVolumeKey = "docker_git_shared_cache"
const bootstrapVolumeKey = "docker_git_bootstrap"

const renderGitTokenLabelEnv = (gitTokenLabel: string): string =>
  gitTokenLabel.length > 0
    ? `      GITHUB_AUTH_LABEL: "${gitTokenLabel}"\n      GIT_AUTH_LABEL: "${gitTokenLabel}"\n`
    : ""

const renderGithubAuthSkipEnv = (shouldSkipGithubAuth: boolean): string =>
  shouldSkipGithubAuth ? `      GITHUB_AUTH_SKIP: "1"\n` : ""

const renderCodexAuthLabelEnv = (codexAuthLabel: string): string =>
  codexAuthLabel.length > 0
    ? `      CODEX_AUTH_LABEL: "${codexAuthLabel}"\n`
    : ""

const renderClaudeAuthLabelEnv = (claudeAuthLabel: string): string =>
  claudeAuthLabel.length > 0
    ? `      CLAUDE_AUTH_LABEL: "${claudeAuthLabel}"\n`
    : ""

const renderGeminiAuthLabelEnv = (geminiAuthLabel: string): string =>
  geminiAuthLabel.length > 0
    ? `      GEMINI_AUTH_LABEL: "${geminiAuthLabel}"\n`
    : ""

const renderGrokAuthLabelEnv = (grokAuthLabel: string): string =>
  grokAuthLabel.length > 0 ? `      GROK_AUTH_LABEL: "${grokAuthLabel}"\n` : ""

const renderAgentModeEnv = (agentMode: string | undefined): string =>
  agentMode !== undefined && agentMode.length > 0
    ? `      AGENT_MODE: "${agentMode}"\n`
    : ""

const renderAgentAutoEnv = (agentAuto: boolean | undefined): string =>
  agentAuto === true ? `      AGENT_AUTO: "1"\n` : ""

const renderResourceLimits = (
  resourceLimits: ResolvedComposeResourceLimits | undefined
): string =>
  resourceLimits === undefined
    ? ""
    : `    cpus: ${resourceLimits.cpuLimit}\n    mem_limit: "${resourceLimits.ramLimit}"\n    memswap_limit: "${resourceLimits.swapLimit}"\n`

const renderGpu = (gpu: TemplateConfig["gpu"]): string => gpu === "all" ? "    gpus: all\n" : ""

const renderBootstrapMounts = (): string => `      - ${bootstrapVolumeKey}:/opt/docker-git/bootstrap/source:ro`

const renderYamlSingleQuoted = (value: string): string => `'${value.replaceAll("'", "''")}'`

const renderOptionalDockerSocketMount = (
  shouldEnableLocalDockerSocket: boolean
): string =>
  shouldEnableLocalDockerSocket
    ? `      - /var/run/docker.sock:/var/run/docker.sock`
    : ""

const renderEnvFiles = (config: TemplateConfig): string =>
  `    env_file:\n      - ${renderYamlSingleQuoted(config.envGlobalPath)}\n      - ${
    renderYamlSingleQuoted(
      config.envProjectPath
    )
  }\n`

const optionalTrimmed = (value: string | undefined): string => value?.trim() ?? ""

const buildAuthEnvFragments = (config: TemplateConfig): AuthEnvFragments => ({
  maybeGitTokenLabelEnv: renderGitTokenLabelEnv(
    optionalTrimmed(config.gitTokenLabel)
  ),
  maybeCodexAuthLabelEnv: renderCodexAuthLabelEnv(
    optionalTrimmed(config.codexAuthLabel)
  ),
  maybeClaudeAuthLabelEnv: renderClaudeAuthLabelEnv(
    optionalTrimmed(config.claudeAuthLabel)
  ),
  maybeGeminiAuthLabelEnv: renderGeminiAuthLabelEnv(
    optionalTrimmed(config.geminiAuthLabel)
  ),
  maybeGrokAuthLabelEnv: renderGrokAuthLabelEnv(
    optionalTrimmed(config.grokAuthLabel)
  )
})

const buildAgentEnvFragments = (config: TemplateConfig): AgentEnvFragments => ({
  maybeAgentModeEnv: renderAgentModeEnv(config.agentMode),
  maybeAgentAutoEnv: renderAgentAutoEnv(config.agentAuto)
})

const renderBrowserLimitEnv = (
  key: string,
  value: number | string | undefined
): string => `      ${key}: "\${${key}:-${value ?? ""}}"\n`

const buildPlaywrightFragments = (
  config: TemplateConfig,
  resourceLimits: ResolvedComposeResourceLimits | undefined,
  options: DockerComposeRenderOptions
): PlaywrightFragments => {
  if (!config.enableMcpPlaywright) {
    return {
      maybeDependsOn: "",
      maybeDockerSocketMount: "",
      maybePlaywrightEnv: "",
      maybeBrowserVolume: ""
    }
  }

  const browserContainerName = `${config.containerName}-browser`
  const browserVolumeName = `${config.volumeName}-browser`
  const browserImageName = `${browserContainerName}:docker-git-browser`

  return {
    maybeDependsOn: "",
    maybeDockerSocketMount: renderOptionalDockerSocketMount(
      options.enableLocalDockerSocket
    ),
    maybePlaywrightEnv:
      `      MCP_PLAYWRIGHT_ENABLE: "1"\n      DOCKER_GIT_PROJECT_CONTAINER_NAME: "${config.containerName}"\n      DOCKER_GIT_BROWSER_CONTAINER_NAME: "${browserContainerName}"\n      DOCKER_GIT_BROWSER_IMAGE_NAME: "${browserImageName}"\n      DOCKER_GIT_BROWSER_VOLUME_NAME: "${browserVolumeName}"\n${
        renderBrowserLimitEnv(
          "DOCKER_GIT_BROWSER_CPU_LIMIT",
          resourceLimits?.cpuLimit
        )
      }${renderBrowserLimitEnv("DOCKER_GIT_BROWSER_RAM_LIMIT", resourceLimits?.ramLimit)}`,
    maybeBrowserVolume: `  ${browserVolumeName}:`
  }
}

// CHANGE: render an Android emulator sidecar service mirroring the Playwright MCP wiring
// WHY: issue-436 asks to connect mcp-android "the same way" Playwright MCP works, exposing
//      a docker-android emulator as a service reachable over ADB for the mobile-mcp server
// QUOTE(ТЗ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: https://github.com/budtmo/docker-android
// PURITY: CORE
// INVARIANT: only emitted when config.enableMcpAndroid === true; image/ports are env-overridable
const defaultAndroidEmulatorImage = "budtmo/docker-android:emulator_14.0"

const buildAndroidFragments = (
  config: TemplateConfig,
  resourceLimits: ResolvedComposeResourceLimits | undefined
): AndroidFragments => {
  if (config.enableMcpAndroid !== true) {
    return {
      maybeAndroidEnv: "",
      maybeAndroidService: "",
      maybeAndroidVolume: ""
    }
  }

  const androidContainerName = `${config.containerName}-android`
  const androidVolumeName = `${config.volumeName}-android`
  const androidImageRef = `\${DOCKER_GIT_ANDROID_EMULATOR_IMAGE:-${defaultAndroidEmulatorImage}}`
  const networkName = resolveComposeNetworkName(config)

  const maybeAndroidEnv =
    `      MCP_ANDROID_ENABLE: "1"\n      DOCKER_GIT_ANDROID_CONTAINER_NAME: "${androidContainerName}"\n      DOCKER_GIT_ANDROID_ADB_ENDPOINT: "\${DOCKER_GIT_ANDROID_ADB_ENDPOINT:-${androidContainerName}:5555}"\n      DOCKER_GIT_ANDROID_EMULATOR_IMAGE: "${androidImageRef}"\n`

  const maybeAndroidService = `
  ${config.serviceName}-android:
    image: "${androidImageRef}"
    container_name: ${androidContainerName}
    privileged: true
    environment:
      EMULATOR_DEVICE: "\${DOCKER_GIT_ANDROID_DEVICE:-Samsung Galaxy S10}"
      WEB_VNC: "\${DOCKER_GIT_ANDROID_WEB_VNC:-true}"
      EMULATOR_HEADLESS: "\${DOCKER_GIT_ANDROID_HEADLESS:-true}"
    devices:
      - /dev/kvm
    ports:
      - "\${DOCKER_GIT_ANDROID_ADB_BIND_HOST:-127.0.0.1}:\${DOCKER_GIT_ANDROID_ADB_PORT:-5555}:5555"
      - "\${DOCKER_GIT_ANDROID_NOVNC_BIND_HOST:-127.0.0.1}:\${DOCKER_GIT_ANDROID_NOVNC_PORT:-6080}:6080"
${renderResourceLimits(resourceLimits)}    volumes:
      - ${androidVolumeName}:/root/.android
    networks:
      - ${networkName}
`

  return {
    maybeAndroidEnv,
    maybeAndroidService,
    maybeAndroidVolume: `  ${androidVolumeName}:`
  }
}

const isResolvedComposeResourceLimits = (
  value: ResolvedComposeResourceLimits | ComposeResourceLimits
): value is ResolvedComposeResourceLimits => "cpuLimit" in value && "ramLimit" in value && "swapLimit" in value

const normalizeComposeResourceLimits = (
  resourceLimits:
    | ResolvedComposeResourceLimits
    | ComposeResourceLimits
    | undefined
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
  resourceLimits: ComposeResourceLimits,
  options: DockerComposeRenderOptions
): ComposeFragments => {
  const networkMode = config.dockerNetworkMode
  const networkName = resolveComposeNetworkName(config)
  const forkRepoUrl = config.forkRepoUrl ?? ""
  const maybeGithubAuthSkipEnv = renderGithubAuthSkipEnv(config.skipGithubAuth)
  const authEnv = buildAuthEnvFragments(config)
  const agentEnv = buildAgentEnvFragments(config)
  const playwright = buildPlaywrightFragments(
    config,
    resourceLimits.playwright,
    options
  )
  const android = buildAndroidFragments(config, resourceLimits.playwright)

  return {
    networkMode,
    networkName,
    maybeGithubAuthSkipEnv,
    ...authEnv,
    ...agentEnv,
    maybeDependsOn: playwright.maybeDependsOn,
    maybeDockerSocketMount: playwright.maybeDockerSocketMount,
    maybePlaywrightEnv: playwright.maybePlaywrightEnv,
    maybeBrowserVolume: playwright.maybeBrowserVolume,
    maybeAndroidEnv: android.maybeAndroidEnv,
    maybeAndroidService: android.maybeAndroidService,
    maybeAndroidVolume: android.maybeAndroidVolume,
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
${renderGpu(config.gpu)}${
    renderEnvFiles(
      config
    )
  }    # runtime auth/env must be loaded into the container process, not only bootstrap scripts
    environment:
      REPO_URL: "${config.repoUrl}"
      REPO_REF: "${config.repoRef}"
      FORK_REPO_URL: "${fragments.forkRepoUrl}"
${fragments.maybeGithubAuthSkipEnv}      # Optional anonymous public GitHub clone override
${fragments.maybeGitTokenLabelEnv}      # Optional token label selector (maps to GITHUB_TOKEN__<LABEL>/GIT_AUTH_TOKEN__<LABEL>)
${fragments.maybeCodexAuthLabelEnv}      # Optional Codex account label selector (maps to CODEX_AUTH_LABEL)
${fragments.maybeClaudeAuthLabelEnv}      # Optional Claude account label selector (maps to CLAUDE_AUTH_LABEL)
${fragments.maybeGeminiAuthLabelEnv}      # Optional Gemini account label selector (maps to GEMINI_AUTH_LABEL)
${fragments.maybeGrokAuthLabelEnv}${fragments.maybeAgentModeEnv}${fragments.maybeAgentAutoEnv}      # Optional Grok account label selector (maps to GROK_AUTH_LABEL)
      # Optional isolated Docker daemon endpoint injected by the API controller.
      DOCKER_GIT_PROJECT_DOCKER_HOST: "\${DOCKER_GIT_PROJECT_DOCKER_HOST:-}"
      TARGET_DIR: "${config.targetDir}"
      CODEX_HOME: "${config.codexHome}"
${fragments.maybePlaywrightEnv}${fragments.maybeAndroidEnv}${fragments.maybeDependsOn}    # bootstrap auth/env arrives through docker_git_bootstrap
    ports:
      - "\${DOCKER_GIT_PROJECT_SSH_BIND_HOST:-127.0.0.1}:${config.sshPort}:22"
${renderResourceLimits(resourceLimits.main)}    volumes:
      - ${config.volumeName}:/home/${config.sshUser}
      - ${sharedCacheVolumeKey}:/home/${config.sshUser}/.docker-git/.cache
      - ${sharedCodexVolumeKey}:${config.codexHome}-shared
${fragments.maybeBootstrapMounts}
${fragments.maybeDockerSocketMount}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    dns:
      - 8.8.8.8
      - 8.8.4.4
      - 1.1.1.1
    networks:
      - ${fragments.networkName}
${fragments.maybeAndroidService}`

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

const renderComposeVolumes = (
  config: TemplateConfig,
  maybeBrowserVolume: string,
  maybeAndroidVolume: string
): string =>
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
    maybeBrowserVolume,
    maybeAndroidVolume
  ]
    .filter((entry) => entry.length > 0)
    .join("\n")

export const renderDockerCompose = (
  config: TemplateConfig,
  resourceLimits?: ResolvedComposeResourceLimits | ComposeResourceLimits,
  options: DockerComposeRenderOptions = defaultDockerComposeRenderOptions
): string => {
  const limits = normalizeComposeResourceLimits(resourceLimits)
  const fragments = buildComposeFragments(config, limits, options)
  return [
    `name: ${resolveComposeProjectName(config)}`,
    renderComposeServices(config, fragments, limits),
    renderComposeNetworks(fragments.networkMode, fragments.networkName),
    renderComposeVolumes(
      config,
      fragments.maybeBrowserVolume,
      fragments.maybeAndroidVolume
    )
  ].join("\n\n")
}

import type { TemplateConfig } from "../domain.js"
import type { ResolvedComposeResourceLimits } from "../resource-limits.js"
import type { DockerComposeRenderOptions } from "./docker-compose.js"

// CHANGE: house the Playwright MCP sidecar fragment builder in its own module
// WHY: docker-compose.ts hosts the optional Android sidecar (issue-436) too; moving both
//      optional-sidecar builders into sibling modules keeps docker-compose.ts under the
//      max-lines lint budget while grouping the parallel Playwright/Android wiring together
// REF: issue-436
export type PlaywrightFragments = {
  readonly maybeDependsOn: string
  readonly maybeDockerSocketMount: string
  readonly maybePlaywrightEnv: string
  readonly maybeBrowserVolume: string
}

const renderBrowserLimitEnv = (
  key: string,
  value: number | string | undefined
): string => `      ${key}: "\${${key}:-${value ?? ""}}"\n`

const renderOptionalDockerSocketMount = (
  shouldEnableLocalDockerSocket: boolean
): string =>
  shouldEnableLocalDockerSocket
    ? `      - /var/run/docker.sock:/var/run/docker.sock`
    : ""

export const buildPlaywrightFragments = (
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

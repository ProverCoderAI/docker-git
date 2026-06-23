import { resolveComposeNetworkName, type TemplateConfig } from "../domain.js"

// CHANGE: render an Android emulator sidecar service mirroring the Playwright MCP wiring
// WHY: issue-436 asks to connect mcp-android "the same way" Playwright MCP works, exposing
//      a docker-android emulator as a service reachable over ADB for the mobile-mcp server.
//      Extracted into its own module so docker-compose.ts stays under the max-lines budget.
// QUOTE(ТЗ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: https://github.com/budtmo/docker-android
// PURITY: CORE
// INVARIANT: only emitted when config.enableMcpAndroid === true; image/ports are env-overridable
export type AndroidFragments = {
  readonly maybeAndroidEnv: string
  readonly maybeAndroidService: string
  readonly maybeAndroidVolume: string
}

const defaultAndroidEmulatorImage = "budtmo/docker-android:emulator_14.0"

export const buildAndroidFragments = (
  config: TemplateConfig,
  resourceLimitsBlock: string
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
${resourceLimitsBlock}    volumes:
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

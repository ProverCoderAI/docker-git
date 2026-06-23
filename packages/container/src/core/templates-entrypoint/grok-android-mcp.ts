// CHANGE: extract the Grok Android MCP config sync into its own module
// WHY: issue-436 wires mcp-android "the same way" Playwright MCP works; keeping the
//      render helper in a dedicated file keeps grok.ts under the max-lines lint budget
// QUOTE(ТЗ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: n/a
export const renderGrokMcpAndroidConfig = (): string =>
  String.raw`# Grok CLI: keep Android MCP config in sync with container settings
docker_git_sync_grok_android_mcp() {
  local android_project="${"$"}{DOCKER_GIT_ANDROID_PROJECT:-${"$"}{DOCKER_GIT_PROJECT_CONTAINER_NAME:-}}"
  if [[ -z "$android_project" ]]; then
    android_project="$(hostname)"
  fi
  local android_network="${"$"}{DOCKER_GIT_ANDROID_NETWORK:-container:$android_project}"
  local adb_endpoint="${"$"}{DOCKER_GIT_ANDROID_ADB_ENDPOINT:-}"
  if [[ -z "$adb_endpoint" ]]; then
    adb_endpoint="$android_project-android:5555"
  fi
  GROK_CONFIG_SETTINGS_FILE="$GROK_CONFIG_SETTINGS_FILE" MCP_ANDROID_ENABLE="${"$"}{MCP_ANDROID_ENABLE:-0}" DOCKER_GIT_ANDROID_PROJECT="$android_project" DOCKER_GIT_ANDROID_NETWORK="$android_network" DOCKER_GIT_ANDROID_ADB_ENDPOINT="$adb_endpoint" TARGET_DIR="${"$"}{TARGET_DIR:-}" node - <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const settingsPath = process.env.GROK_CONFIG_SETTINGS_FILE
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
if (typeof settingsPath !== "string" || settingsPath.length === 0) process.exit(0)

let settings = {}
try {
  const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"))
  if (isRecord(parsed)) settings = parsed
} catch {}

const androidProject = process.env.DOCKER_GIT_ANDROID_PROJECT || ""
const androidNetwork = process.env.DOCKER_GIT_ANDROID_NETWORK || (androidProject.length > 0 ? "container:" + androidProject : "")
const adbEndpoint = process.env.DOCKER_GIT_ANDROID_ADB_ENDPOINT || ""
const workspace = process.env.TARGET_DIR || ""
const androidArgs = androidProject.length > 0 && adbEndpoint.length > 0
  ? ["--project", androidProject, "--network", androidNetwork, "--endpoint", adbEndpoint]
  : []
if (workspace.length > 0) androidArgs.push("--workspace", workspace)
const nextServers = { ...(isRecord(settings.mcpServers) ? settings.mcpServers : {}) }
if (process.env.MCP_ANDROID_ENABLE === "1") {
  nextServers.android = { command: "android-connection", args: androidArgs, trust: true }
} else {
  delete nextServers.android
}

const nextSettings = { ...settings }
Object.keys(nextServers).length > 0 ? nextSettings.mcpServers = nextServers : delete nextSettings.mcpServers

if (JSON.stringify(settings) === JSON.stringify(nextSettings)) process.exit(0)

fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + "\n", { mode: 0o600 })
NODE
}

docker_git_sync_grok_android_mcp`

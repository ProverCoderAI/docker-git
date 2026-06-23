// CHANGE: extract the Grok Android MCP config sync into its own module
// WHY: issue-436 wires mcp-android "the same way" Playwright MCP works; keeping the
//      render helper in a dedicated file keeps grok.ts under the max-lines lint budget
// QUOTE(ТЗ): "Подключить mcp-android так же как работает MCP PLAYRIGHT"
// REF: issue-436
// SOURCE: https://github.com/mobile-next/mobile-mcp
export const renderGrokMcpAndroidConfig = (): string =>
  String.raw`# Grok CLI: keep Android MCP config in sync with container settings
docker_git_sync_grok_android_mcp() {
  local adb_endpoint="${"$"}{DOCKER_GIT_ANDROID_ADB_ENDPOINT:-}"
  GROK_CONFIG_SETTINGS_FILE="$GROK_CONFIG_SETTINGS_FILE" MCP_ANDROID_ENABLE="${"$"}{MCP_ANDROID_ENABLE:-0}" DOCKER_GIT_ANDROID_ADB_ENDPOINT="$adb_endpoint" node - <<'NODE'
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

const adbEndpoint = process.env.DOCKER_GIT_ANDROID_ADB_ENDPOINT || ""
const connectPrefix = adbEndpoint.length > 0 ? "adb connect " + adbEndpoint + " >/dev/null 2>&1 || true; " : ""
const nextServers = { ...(isRecord(settings.mcpServers) ? settings.mcpServers : {}) }
if (process.env.MCP_ANDROID_ENABLE === "1") {
  nextServers.android = { command: "bash", args: ["-lc", connectPrefix + "exec npx -y @mobilenext/mobile-mcp@latest"], trust: true }
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

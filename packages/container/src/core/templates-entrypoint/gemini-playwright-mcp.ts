// CHANGE: house the Gemini Playwright MCP config sync in its own module
// WHY: gemini.ts also wires the Android MCP sidecar (issue-436); moving both optional MCP
//      config helpers into sibling modules keeps gemini.ts under the max-lines lint budget
// REF: issue-436
export const renderGeminiMcpPlaywrightConfig = (): string =>
  String.raw`# Gemini CLI: keep Playwright MCP config in sync with container settings
docker_git_sync_gemini_playwright_mcp() {
  local browser_project="${"$"}{DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"; [[ -n "$browser_project" ]] || browser_project="$(hostname)"
  local browser_network="container:$browser_project"
  GEMINI_CONFIG_SETTINGS_FILE="$GEMINI_CONFIG_SETTINGS_FILE" MCP_PLAYWRIGHT_ENABLE="${"$"}{MCP_PLAYWRIGHT_ENABLE:-0}" DOCKER_GIT_BROWSER_PROJECT="$browser_project" DOCKER_GIT_BROWSER_NETWORK="$browser_network" node - <<'NODE'
const fs = require("node:fs")
const path = require("node:path")
const settingsPath = process.env.GEMINI_CONFIG_SETTINGS_FILE
const isRecord = (value) => typeof value === "object" && value !== null && !Array.isArray(value)
if (typeof settingsPath !== "string" || settingsPath.length === 0) process.exit(0)

let settings = {}
try {
  const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"))
  if (isRecord(parsed)) settings = parsed
} catch {}

const browserProject = process.env.DOCKER_GIT_BROWSER_PROJECT || ""
const browserArgs = browserProject.length > 0 ? ["--project", browserProject, "--network", process.env.DOCKER_GIT_BROWSER_NETWORK || "container:" + browserProject] : []
const nextServers = { ...(isRecord(settings.mcpServers) ? settings.mcpServers : {}) }
if (process.env.MCP_PLAYWRIGHT_ENABLE === "1") {
  nextServers.playwright = { command: "browser-connection", args: browserArgs, trust: true }
} else {
  delete nextServers.playwright
}

const nextSettings = { ...settings }
Object.keys(nextServers).length > 0 ? nextSettings.mcpServers = nextServers : delete nextSettings.mcpServers

if (JSON.stringify(settings) === JSON.stringify(nextSettings)) process.exit(0)

fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2) + "\n", { mode: 0o600 })
NODE
}

docker_git_sync_gemini_playwright_mcp`

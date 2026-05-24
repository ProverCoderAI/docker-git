// CHANGE: isolate the long Playwright MCP wrapper from the primary Dockerfile renderer.
// WHY: generated shell must stay readable while TypeScript lint keeps functions and files small enough for review.
// QUOTE(ТЗ): "без TS-дублирования"
// REF: issue-347
// SOURCE: n/a
// FORMAT THEOREM: enableMcpPlaywright -> dockerfile_contains(docker-git-playwright-mcp)
// PURITY: CORE
// INVARIANT: wrapper content is rendered exactly once and still delegates CDP to the Rust-created browser endpoint.
// COMPLEXITY: O(n) where n is wrapper length
const dockerfilePlaywrightMcpBlock = String.raw`ARG PLAYWRIGHT_MCP_VERSION=0.0.75
RUN npm install -g "@playwright/mcp@${"$"}{PLAYWRIGHT_MCP_VERSION}"

# docker-git: wrapper that launches the MCP stdio server without blocking initialize on CDP readiness.
RUN cat <<'EOF' > /usr/local/bin/docker-git-playwright-mcp
#!/usr/bin/env bash
set -euo pipefail

# Fast-path for help/version (avoid waiting for the nested browser runtime).
for arg in "$@"; do
  case "$arg" in
    -h|--help|-V|--version)
      exec playwright-mcp "$@"
      ;;
  esac
done

CDP_ENDPOINT="http://127.0.0.1:9223"

# CHANGE: keep MCP initialize independent from nested browser readiness
# WHY: Codex starts MCP servers during boot; blocking here closes stdio before initialize when CDP is slow.
# QUOTE(issue-319): "handshaking with MCP server failed: connection closed: initialize response"
# REF: issue-319
# SOURCE: https://playwright.dev/mcp/configuration/options
# FORMAT THEOREM: guarded_cdp(fixed_nested_browser_endpoint) -> mcp_stdio_ready_before_browser_connection
# PURITY: SHELL
# INVARIANT: guarded mode never exits before handing stdio to playwright-mcp
# COMPLEXITY: O(1)
MCP_PLAYWRIGHT_RETRY_ATTEMPTS="\${MCP_PLAYWRIGHT_RETRY_ATTEMPTS:-10}"
MCP_PLAYWRIGHT_RETRY_DELAY="\${MCP_PLAYWRIGHT_RETRY_DELAY:-2}"
MCP_PLAYWRIGHT_CDP_GUARD="\${MCP_PLAYWRIGHT_CDP_GUARD:-1}"
MCP_PLAYWRIGHT_CDP_TIMEOUT="\${MCP_PLAYWRIGHT_CDP_TIMEOUT:-60000}"

EXTRA_ARGS=()
if [[ "\${MCP_PLAYWRIGHT_ISOLATED:-0}" == "1" ]]; then
  EXTRA_ARGS+=(--isolated)
fi

# The guarded endpoint is the nested browser opened by docker-git Open browser.
# Passing the fixed HTTP URL lets Playwright MCP
# re-resolve /json/version instead of pinning itself to one stale /devtools/browser/<id>.
if [[ "$MCP_PLAYWRIGHT_CDP_GUARD" == "1" ]]; then
  exec playwright-mcp --cdp-endpoint "$CDP_ENDPOINT" --cdp-timeout "$MCP_PLAYWRIGHT_CDP_TIMEOUT" "\${EXTRA_ARGS[@]}" "$@"
fi

# Unified Rust browser (docker-git-browser-connection) now provides the single
# dg-$PROJECT-browser container with CDP on :9223 (reachable by name when --network is passed).
# MCP Playwright connects directly to ws://dg-...-browser:9223 — no more separate browser-vnc or cdp-guard duplication (per #347).
fetch_cdp_version() {
  curl -sSf --connect-timeout 3 --max-time 10 -H 'Host: 127.0.0.1:9222' "\${CDP_ENDPOINT%/}/json/version" 2>/dev/null
}

JSON=""
for attempt in $(seq 1 "$MCP_PLAYWRIGHT_RETRY_ATTEMPTS"); do
  if JSON="$(fetch_cdp_version)"; then
    break
  fi
  if [[ "$attempt" -lt "$MCP_PLAYWRIGHT_RETRY_ATTEMPTS" ]]; then
    echo "docker-git-playwright-mcp: waiting for nested browser runtime (attempt $attempt/$MCP_PLAYWRIGHT_RETRY_ATTEMPTS)..." >&2
    sleep "$MCP_PLAYWRIGHT_RETRY_DELAY"
  fi
done

if [[ -z "$JSON" ]]; then
  echo "docker-git-playwright-mcp: failed to connect to CDP endpoint $CDP_ENDPOINT after $MCP_PLAYWRIGHT_RETRY_ATTEMPTS attempts" >&2
  exit 1
fi

WS_URL="$(printf "%s" "$JSON" | node -e 'const fs=require("fs"); const j=JSON.parse(fs.readFileSync(0,"utf8")); process.stdout.write(j.webSocketDebuggerUrl || "")')"
if [[ -z "$WS_URL" ]]; then
  echo "docker-git-playwright-mcp: webSocketDebuggerUrl missing" >&2
  exit 1
fi

# Rewrite ws origin to match the CDP endpoint origin (docker DNS).
BASE_WS="$(CDP_ENDPOINT="$CDP_ENDPOINT" node -e 'const { URL } = require("url"); const u=new URL(process.env.CDP_ENDPOINT); const proto=u.protocol==="https:"?"wss:":"ws:"; process.stdout.write(proto + "//" + u.host)')"
WS_REWRITTEN="$(BASE_WS="$BASE_WS" WS_URL="$WS_URL" node -e 'const { URL } = require("url"); const base=new URL(process.env.BASE_WS); const ws=new URL(process.env.WS_URL); ws.protocol=base.protocol; ws.host=base.host; process.stdout.write(ws.toString())')"

exec playwright-mcp --cdp-endpoint "$WS_REWRITTEN" --cdp-timeout "$MCP_PLAYWRIGHT_CDP_TIMEOUT" "\${EXTRA_ARGS[@]}" "$@"
EOF
RUN chmod +x /usr/local/bin/docker-git-playwright-mcp`

export const renderDockerfilePlaywrightMcp = (): string => dockerfilePlaywrightMcpBlock.replaceAll("\\${", "${")

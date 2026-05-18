export const renderPlaywrightBrowserDockerfile = (): string =>
  `FROM kechangdev/browser-vnc:latest

# bash for noVNC startup, procps for ps -p used by novnc_proxy, socat for CDP fallback
# nodejs/npm/ws for the CDP guard, python3/net-tools for diagnostics
RUN apk add --no-cache bash procps socat nodejs npm python3 net-tools
RUN npm install --omit=dev --prefix /opt/docker-git-cdp-guard ws@8.18.3

RUN cat <<'EOF' > /usr/local/bin/docker-git-cdp-guard
${cdpGuardScript}
EOF
RUN chmod +x /usr/local/bin/docker-git-cdp-guard

COPY mcp-playwright-start-extra.sh /usr/local/bin/mcp-playwright-start-extra.sh
RUN chmod +x /usr/local/bin/mcp-playwright-start-extra.sh

# Start extra services in background, keep base stack in foreground
# Clear stale Chromium profile locks before boot
ENTRYPOINT ["/bin/sh", "-lc", "rm -f /data/SingletonLock /data/SingletonCookie /data/SingletonSocket || true; /usr/local/bin/mcp-playwright-start-extra.sh & exec /start.sh"]`

const cdpGuardScript = String.raw`#!/usr/bin/env node
"use strict";

const http = require("node:http");
const { URL } = require("node:url");
const { WebSocket, WebSocketServer } = require("/opt/docker-git-cdp-guard/node_modules/ws");

const upstreamHost = process.env.MCP_PLAYWRIGHT_UPSTREAM_CDP_HOST || "127.0.0.1";
const upstreamPort = Number.parseInt(process.env.MCP_PLAYWRIGHT_UPSTREAM_CDP_PORT || "9222", 10);
const listenHost = process.env.MCP_PLAYWRIGHT_CDP_GUARD_HOST || "0.0.0.0";
const listenPort = Number.parseInt(process.env.MCP_PLAYWRIGHT_CDP_GUARD_PORT || "9223", 10);
const blockedMethods = new Set(["Browser.close", "Browser.crash", "Browser.crashGpuProcess"]);

const log = (message) => process.stderr.write("[docker-git-cdp-guard] " + message + "\n");

const shouldBlockBrowserClose = () => process.env.MCP_PLAYWRIGHT_BLOCK_BROWSER_CLOSE !== "0";

const requestHost = (request) => {
  const host = request.headers.host;
  return typeof host === "string" && host.length > 0 ? host : "127.0.0.1:" + listenPort;
};

const rewriteWebSocketUrl = (value, host) => {
  try {
    const url = new URL(value);
    url.protocol = "ws:";
    url.host = host;
    return url.toString();
  } catch {
    return value;
  }
};

const rewriteDebuggerUrls = (value, host) => {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteDebuggerUrls(item, host));
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      key === "webSocketDebuggerUrl" && typeof child === "string"
        ? rewriteWebSocketUrl(child, host)
        : rewriteDebuggerUrls(child, host)
    ])
  );
};

const rewriteJsonBody = (body, host) => {
  try {
    return Buffer.from(JSON.stringify(rewriteDebuggerUrls(JSON.parse(body.toString("utf8")), host)));
  } catch {
    return body;
  }
};

const proxyHttp = (request, response) => {
  const chunks = [];
  request.on("data", (chunk) => chunks.push(chunk));
  request.on("end", () => {
    const headers = { ...request.headers, host: upstreamHost + ":" + upstreamPort };
    delete headers.connection;
    delete headers["content-length"];
    const upstream = http.request(
      {
        hostname: upstreamHost,
        port: upstreamPort,
        method: request.method,
        path: request.url || "/",
        headers
      },
      (upstreamResponse) => {
        const upstreamChunks = [];
        upstreamResponse.on("data", (chunk) => upstreamChunks.push(chunk));
        upstreamResponse.on("end", () => {
          const rawBody = Buffer.concat(upstreamChunks);
          const body = (request.url || "/").startsWith("/json")
            ? rewriteJsonBody(rawBody, requestHost(request))
            : rawBody;
          const responseHeaders = { ...upstreamResponse.headers };
          delete responseHeaders["content-length"];
          delete responseHeaders["content-encoding"];
          response.writeHead(upstreamResponse.statusCode || 502, responseHeaders);
          response.end(body);
        });
      }
    );
    upstream.on("error", (error) => {
      response.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      response.end("CDP upstream unavailable: " + error.message + "\n");
    });
    upstream.end(Buffer.concat(chunks));
  });
};

const fetchCurrentBrowserPath = () =>
  new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: upstreamHost,
        port: upstreamPort,
        path: "/json/version",
        headers: { host: upstreamHost + ":" + upstreamPort }
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const raw = typeof parsed.webSocketDebuggerUrl === "string" ? parsed.webSocketDebuggerUrl : "";
            const path = raw.length > 0 ? new URL(raw).pathname : "";
            path.length > 0 ? resolve(path) : reject(new Error("webSocketDebuggerUrl missing"));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    request.on("error", reject);
  });

const upstreamPathFor = async (rawPath) => {
  const path = rawPath || "/";
  return path.startsWith("/devtools/browser/") ? await fetchCurrentBrowserPath() : path;
};

const parseMessage = (data) => JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : String(data));

const isBlockedCdpMessage = (data) => {
  if (!shouldBlockBrowserClose()) {
    return false;
  }
  try {
    const message = parseMessage(data);
    return message !== null && typeof message === "object" && blockedMethods.has(message.method);
  } catch {
    return false;
  }
};

const blockedCdpResponse = (data) => {
  try {
    const message = parseMessage(data);
    return Object.prototype.hasOwnProperty.call(message, "id")
      ? JSON.stringify({ id: message.id, result: {} })
      : "";
  } catch {
    return "";
  }
};

const handleWebSocket = async (client, request) => {
  const pending = [];
  let upstream = null;
  const forwardToUpstream = (data, isBinary) => {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      pending.push([data, isBinary]);
      return;
    }
    if (!isBinary && isBlockedCdpMessage(data)) {
      const response = blockedCdpResponse(data);
      if (response.length > 0 && client.readyState === WebSocket.OPEN) {
        client.send(response);
      }
      return;
    }
    upstream.send(data, { binary: isBinary });
  };

  client.on("message", forwardToUpstream);

  try {
    const upstreamPath = await upstreamPathFor(request.url || "/");
    upstream = new WebSocket("ws://" + upstreamHost + ":" + upstreamPort + upstreamPath, {
      headers: { host: upstreamHost + ":" + upstreamPort }
    });
    upstream.on("open", () => {
      for (const [data, isBinary] of pending.splice(0)) {
        forwardToUpstream(data, isBinary);
      }
    });
    upstream.on("message", (data, isBinary) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data, { binary: isBinary });
      }
    });
    upstream.on("close", (code, reason) => {
      if (client.readyState === WebSocket.OPEN) {
        client.close(code, reason);
      }
    });
    upstream.on("error", (error) => {
      log("upstream websocket error: " + error.message);
      if (client.readyState === WebSocket.OPEN) {
        client.close(1011, "CDP upstream websocket error");
      }
    });
    client.on("close", () => {
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.close();
      }
    });
  } catch (error) {
    log("websocket setup failed: " + error.message);
    client.close(1011, "CDP upstream unavailable");
  }
};

const server = http.createServer(proxyHttp);
const wss = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (client) => {
    handleWebSocket(client, request);
  });
});

server.listen(listenPort, listenHost, () => {
  log("listening on " + listenHost + ":" + listenPort + " -> " + upstreamHost + ":" + upstreamPort);
});
`

export const renderPlaywrightStartExtra = (): string =>
  `#!/bin/sh
set -eu

# Clear stale Chromium locks from previous container runs
rm -f /data/SingletonLock /data/SingletonCookie /data/SingletonSocket || true

# Wait for chromium/x11vnc/noVNC to come up
sleep 2

# CDP guard: expose 9223 on the docker network and block browser-level destructive CDP methods
if [ "\${MCP_PLAYWRIGHT_CDP_GUARD:-1}" = "1" ]; then
  docker-git-cdp-guard >/var/log/docker-git-cdp-guard.log 2>&1 &
else
  socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/var/log/socat-9223.log 2>&1 &
fi

# Optional VNC password disabling (useful if you publish VNC/noVNC ports)
if [ "\${VNC_NOPW:-1}" = "1" ]; then
  pkill x11vnc || true
  x11vnc -display :99 -rfbport 5900 -nopw -forever -shared -bg -o /var/log/x11vnc-nopw.log
fi

echo "extra services started"
exit 0
`

// CHANGE: manage the Playwright browser as a nested Docker container owned by the project container.
// WHY: issue #306 follow-up requires browser containers to inherit project lifecycle while keeping separate limits.
// QUOTE(ТЗ): "пусть он поднимается внутри dg-issues1 а не где-то из вне"
// REF: issue-306-browser-nested-runtime
// SOURCE: n/a
// FORMAT THEOREM: start(main) -> running(browser) with network(browser) = container:main OR logged_warning
// PURITY: SHELL
// EFFECT: shell commands executed by generated entrypoint
// INVARIANT: browser data volume is preserved; runtime cleanup removes only the browser container
// COMPLEXITY: O(build + docker-run)/O(1)
export const renderPlaywrightBrowserRuntime = (): string =>
  String.raw`#!/usr/bin/env bash
set -euo pipefail

docker_git_browser_log() {
  printf '%s\n' "[docker-git-browser] $*" >&2
}

docker_git_browser_has_docker() {
  command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1
}

docker_git_browser_context_dir() {
  printf '%s\n' "\${DOCKER_GIT_BROWSER_CONTEXT_DIR:-/opt/docker-git/browser}"
}

docker_git_stop_playwright_browser() {
  local container_name="\${DOCKER_GIT_BROWSER_CONTAINER_NAME:-}"
  if [[ -z "$container_name" ]]; then
    return 0
  fi
  if ! docker_git_browser_has_docker; then
    return 0
  fi
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}

docker_git_start_playwright_browser() {
  if [[ "\${MCP_PLAYWRIGHT_ENABLE:-0}" != "1" ]]; then
    docker_git_stop_playwright_browser || true
    return 0
  fi

  local container_name="\${DOCKER_GIT_BROWSER_CONTAINER_NAME:-}"
  local image_name="\${DOCKER_GIT_BROWSER_IMAGE_NAME:-}"
  local volume_name="\${DOCKER_GIT_BROWSER_VOLUME_NAME:-}"
  local main_container="\${DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"
  local context_dir
  context_dir="$(docker_git_browser_context_dir)"

  if [[ -z "$container_name" || -z "$image_name" || -z "$volume_name" || -z "$main_container" ]]; then
    docker_git_browser_log "missing browser runtime configuration; skipping nested browser start"
    return 0
  fi
  if ! docker_git_browser_has_docker; then
    docker_git_browser_log "Docker API is unavailable; skipping nested browser start"
    return 0
  fi
  if [[ ! -f "$context_dir/Dockerfile.browser" ]]; then
    docker_git_browser_log "browser Dockerfile is missing at $context_dir/Dockerfile.browser"
    return 0
  fi

  docker_git_browser_log "building $image_name"
  docker build -t "$image_name" -f "$context_dir/Dockerfile.browser" "$context_dir" >/var/log/docker-git-browser-build.log 2>&1 || {
    docker_git_browser_log "browser image build failed; see /var/log/docker-git-browser-build.log"
    return 0
  }

  docker_git_stop_playwright_browser || true
  docker volume create "$volume_name" >/dev/null

  local args=(
    run
    -d
    --name "$container_name"
    --label "docker-git.browser=1"
    --label "docker-git.project-container=$main_container"
    --network "container:$main_container"
    --shm-size "2g"
    -e "VNC_NOPW=1"
    -e "MCP_PLAYWRIGHT_CDP_GUARD=\${MCP_PLAYWRIGHT_CDP_GUARD:-1}"
    -e "MCP_PLAYWRIGHT_BLOCK_BROWSER_CLOSE=\${MCP_PLAYWRIGHT_BLOCK_BROWSER_CLOSE:-1}"
    -v "$volume_name:/data"
  )

  if [[ -n "\${DOCKER_GIT_BROWSER_CPU_LIMIT:-}" ]]; then
    args+=(--cpus "$DOCKER_GIT_BROWSER_CPU_LIMIT")
  fi
  if [[ -n "\${DOCKER_GIT_BROWSER_RAM_LIMIT:-}" ]]; then
    args+=(--memory "$DOCKER_GIT_BROWSER_RAM_LIMIT" --memory-swap "$DOCKER_GIT_BROWSER_RAM_LIMIT")
  fi

  docker_git_browser_log "starting $container_name inside $main_container network namespace"
  docker "\${args[@]}" "$image_name" >/dev/null || {
    docker_git_browser_log "failed to start $container_name"
    return 0
  }
}
`

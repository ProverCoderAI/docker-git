/* jscpd:ignore-start */
export const renderPlaywrightBrowserDockerfile = (): string =>
  `FROM kechangdev/browser-vnc:latest

# bash for noVNC startup, procps for ps -p used by novnc_proxy, socat for CDP fallback
# nodejs/npm/ws for the CDP guard, python3/net-tools for diagnostics
RUN apk add --no-cache bash procps socat nodejs npm python3 net-tools
RUN npm install --omit=dev --prefix /opt/docker-git-cdp-guard ws@8.18.3

COPY docker-git-cdp-guard /usr/local/bin/docker-git-cdp-guard
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

export const renderPlaywrightCdpGuard = (): string => cdpGuardScript

export const renderPlaywrightStartExtra = (): string =>
  `#!/bin/sh
set -eu

# Clear stale Chromium locks from previous container runs
rm -f /data/SingletonLock /data/SingletonCookie /data/SingletonSocket || true

# Wait for chromium/x11vnc/noVNC to come up
sleep 2

start_cdp_fallback() {
  socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222 >/var/log/socat-9223.log 2>&1 &
}

# CDP guard: expose 9223 on the docker network and block browser-level destructive CDP methods
if [ "\${MCP_PLAYWRIGHT_CDP_GUARD:-1}" = "1" ]; then
  docker-git-cdp-guard >/var/log/docker-git-cdp-guard.log 2>&1 &
  guard_pid="$!"
  sleep 1
  if ! kill -0 "$guard_pid" 2>/dev/null; then
    echo "docker-git-cdp-guard exited during startup; falling back to socat" >&2
    sed -n '1,120p' /var/log/docker-git-cdp-guard.log 2>/dev/null >&2 || true
    start_cdp_fallback
  fi
else
  start_cdp_fallback
fi

# Optional VNC password disabling (useful if you publish VNC/noVNC ports)
if [ "\${VNC_NOPW:-1}" = "1" ]; then
  pkill x11vnc || true
  x11vnc -display :99 -rfbport 5900 -nopw -forever -shared -bg -o /var/log/x11vnc-nopw.log
fi

echo "extra services started"
exit 0
`
/* jscpd:ignore-end */

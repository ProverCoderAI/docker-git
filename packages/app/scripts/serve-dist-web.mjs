import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs"
import { createServer, request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { networkInterfaces } from "node:os"
import { dirname, extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

import { WebSocket, WebSocketServer } from "ws"

import { shouldProxyHttpPath } from "./serve-dist-web-routing.mjs"

const appRoot = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."))
const staticRoot = join(appRoot, "dist-web")
const trimTrailingSlashes = (value) => value.replace(/\/+$/u, "")
const configuredApiUrl = process.env["DOCKER_GIT_API_URL"]?.trim()
const apiBaseUrl = trimTrailingSlashes(
  configuredApiUrl && configuredApiUrl.length > 0
    ? configuredApiUrl
    : `http://${process.env["DOCKER_GIT_API_HOST"]?.trim() || "127.0.0.1"}:${process.env["DOCKER_GIT_API_PORT"]?.trim() || "3334"}`
)
const apiUrl = new URL(apiBaseUrl)
// CHANGE: bind the browser runtime to all host interfaces unless explicitly overridden.
// WHY: the browser shell proxies API calls, so LAN users need only the web port reachable.
// QUOTE(ТЗ): "Я хочу подключить"
// REF: user-request-2026-04-21-browser-lan-bind
// SOURCE: n/a
// FORMAT THEOREM: default(bindHost) = 0.0.0.0 -> forall h in HostIPv4Interfaces: listens(h, webPort), firewall permitting
// PURITY: SHELL
// EFFECT: reads process.env and host network interfaces.
// INVARIANT: explicit DOCKER_GIT_WEB_HOST still narrows the exposed interface.
// COMPLEXITY: O(i)/O(i), where i = number of host network interfaces.
const defaultWebHost = "0.0.0.0"
const host = process.env["DOCKER_GIT_WEB_HOST"]?.trim() || defaultWebHost
const port = Number(process.env["DOCKER_GIT_WEB_PORT"]?.trim() || "4191")
const webRevision = process.env["DOCKER_GIT_WEB_REVISION"]?.trim()
const webStatePath = process.env["DOCKER_GIT_WEB_STATE_PATH"]?.trim()

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml"
}

const noStoreHeaders = {
  "cache-control": "no-store"
}

const wildcardHosts = new Set(["0.0.0.0", "::"])

const hostNetworkUrls = (port) =>
  Object.values(networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => `http://${entry.address}:${port}`)

const reachableUrls = (host, port) =>
  wildcardHosts.has(host)
    ? [`http://127.0.0.1:${port}`, ...hostNetworkUrls(port)]
    : [`http://${host}:${port}`]

const resolveStaticPath = (pathname) => {
  const normalized = normalize(pathname)
  return normalized.startsWith(staticRoot)
    ? normalized
    : join(staticRoot, normalized)
}

const serveFile = (
  pathname,
  response
) => {
  const filePath = resolveStaticPath(pathname)
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, noStoreHeaders)
    response.end("Not found")
    return
  }

  response.writeHead(200, {
    ...noStoreHeaders,
    "content-type": contentTypes[extname(filePath)] ?? "application/octet-stream"
  })
  createReadStream(filePath).pipe(response)
}

const resolveUpstreamPath = (url) => {
  const parsed = new URL(url, "http://localhost")
  const pathname = parsed.pathname.replace(/^\/api/u, "") || "/"
  return `${pathname}${parsed.search}`
}

const firstHeader = (value) => Array.isArray(value) ? value[0] : value

const proxyForwardHeaders = (request, forwardedPrefix) => {
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]) ?? request.headers.host
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]) ?? "http"
  return {
    ...request.headers,
    host: apiUrl.host,
    ...(forwardedHost === undefined ? {} : { "x-forwarded-host": forwardedHost }),
    "x-forwarded-prefix": forwardedPrefix,
    "x-forwarded-proto": forwardedProto
  }
}

const parseWebSocketProtocols = (value) => {
  const header = firstHeader(value)
  if (header === undefined) {
    return []
  }
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const proxyWebSocketForwardHeaders = (request, forwardedPrefix) => {
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]) ?? request.headers.host
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]) ?? "http"
  return {
    ...(forwardedHost === undefined ? {} : { "x-forwarded-host": forwardedHost }),
    "x-forwarded-prefix": forwardedPrefix,
    "x-forwarded-proto": forwardedProto
  }
}

const connectUpstreamWebSocket = (
  url,
  request,
  forwardedPrefix
) => {
  const protocols = parseWebSocketProtocols(request.headers["sec-websocket-protocol"])
  const options = { headers: proxyWebSocketForwardHeaders(request, forwardedPrefix) }
  return protocols.length === 0
    ? new WebSocket(url, options)
    : new WebSocket(url, protocols, options)
}

const proxyHttp = (
  request,
  response
) => {
  const forwardedPrefix = request.url?.startsWith("/api/") ? "/api" : ""
  const upstreamRequest = apiUrl.protocol === "https:" ? httpsRequest : httpRequest
  const upstream = upstreamRequest(
    {
      headers: proxyForwardHeaders(request, forwardedPrefix),
      hostname: apiUrl.hostname,
      method: request.method,
      path: resolveUpstreamPath(request.url ?? "/"),
      port: apiUrl.port || (apiUrl.protocol === "https:" ? 443 : 80)
    },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode ?? 502, {
        ...upstreamResponse.headers,
        ...noStoreHeaders
      })
      upstreamResponse.pipe(response)
    }
  )

  upstream.on("error", (error) => {
    response.writeHead(502, {
      ...noStoreHeaders,
      "content-type": "text/plain; charset=utf-8"
    })
    response.end(String(error))
  })

  request.pipe(upstream)
}

const webSocketServer = new WebSocketServer({ noServer: true })
const webSocketHeartbeatIntervalMs = 25_000

const attachWebSocketHeartbeat = (socket) => {
  let alive = true
  const interval = setInterval(() => {
    if (socket.readyState !== WebSocket.OPEN) {
      return
    }
    if (!alive) {
      socket.terminate()
      return
    }
    alive = false
    socket.ping()
  }, webSocketHeartbeatIntervalMs)

  socket.on("pong", () => {
    alive = true
  })
  socket.on("close", () => {
    clearInterval(interval)
  })
  socket.on("error", () => {
    clearInterval(interval)
  })
}

const bridgeWebSockets = (clientSocket, upstream) => {
  const pending = []
  const sendWhenOpen = (socket, data, isBinary) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary })
    }
  }
  attachWebSocketHeartbeat(clientSocket)
  attachWebSocketHeartbeat(upstream)
  const flushPending = () => {
    for (const message of pending.splice(0)) {
      sendWhenOpen(upstream, message.data, message.isBinary)
    }
  }
  clientSocket.on("message", (data, isBinary) => {
    if (upstream.readyState === WebSocket.OPEN) {
      sendWhenOpen(upstream, data, isBinary)
      return
    }
    pending.push({ data, isBinary })
  })
  clientSocket.on("close", () => {
    upstream.close()
  })
  upstream.on("open", flushPending)
  upstream.on("message", (data, isBinary) => {
    sendWhenOpen(clientSocket, data, isBinary)
  })
  upstream.on("close", () => {
    clientSocket.close()
  })
  upstream.on("error", () => {
    clientSocket.close()
  })
}

const server = createServer((request, response) => {
  const parsed = new URL(request.url ?? "/", "http://localhost")
  if (shouldProxyHttpPath(parsed.pathname)) {
    proxyHttp(request, response)
    return
  }

  if (parsed.pathname === "/" || parsed.pathname === "/index.html") {
    serveFile(join(staticRoot, "index.html"), response)
    return
  }

  const candidate = join(staticRoot, parsed.pathname)
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    serveFile(candidate, response)
    return
  }

  serveFile(join(staticRoot, "index.html"), response)
})

server.on("upgrade", (request, socket, head) => {
  const parsed = new URL(request.url ?? "/", "http://localhost")
  const terminalWebSocket = parsed.pathname.startsWith("/api/") && parsed.pathname.endsWith("/ws")
  const browserWebSocket = parsed.pathname.startsWith("/b/")
  const databaseWebSocket = parsed.pathname.startsWith("/d/")
  if (!terminalWebSocket && !browserWebSocket && !databaseWebSocket) {
    socket.destroy()
    return
  }

  webSocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
    const forwardedPrefix = request.url?.startsWith("/api/") ? "/api" : ""
    const upstream = connectUpstreamWebSocket(
      `${apiUrl.protocol === "https:" ? "wss" : "ws"}://${apiUrl.host}${resolveUpstreamPath(request.url ?? "/")}`,
      request,
      forwardedPrefix
    )
    bridgeWebSockets(clientSocket, upstream)
  })
})

const writeRuntimeState = () => {
  if (webStatePath === undefined || webStatePath.length === 0 || webRevision === undefined || webRevision.length === 0) {
    return
  }

  const state = {
    schemaVersion: 1,
    revision: webRevision,
    pid: String(process.pid),
    host,
    port: String(port),
    apiBaseUrl,
    startedAtIso: new Date().toISOString()
  }

  try {
    mkdirSync(dirname(webStatePath), { recursive: true })
    writeFileSync(webStatePath, `${JSON.stringify(state, null, 2)}\n`)
  } catch (error) {
    console.warn(`docker-git web runtime could not write state to ${webStatePath}: ${String(error)}`)
  }
}

server.listen(port, host, () => {
  writeRuntimeState()
  console.log(`docker-git web runtime listening on http://${host}:${port}`)
  console.log(`docker-git web runtime reachable at ${reachableUrls(host, port).join(", ")}`)
})

import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer, request as httpRequest } from "node:http"
import { request as httpsRequest } from "node:https"
import { extname, join, normalize } from "node:path"
import { fileURLToPath } from "node:url"

import { WebSocket, WebSocketServer } from "ws"

const appRoot = normalize(join(fileURLToPath(new URL(".", import.meta.url)), ".."))
const staticRoot = join(appRoot, "dist-web")
const configuredApiUrl = process.env["DOCKER_GIT_API_URL"]?.trim()
const apiUrl = new URL(
  configuredApiUrl && configuredApiUrl.length > 0
    ? configuredApiUrl
    : `http://${process.env["DOCKER_GIT_API_HOST"]?.trim() || "127.0.0.1"}:${process.env["DOCKER_GIT_API_PORT"]?.trim() || "3334"}`
)
const host = process.env["DOCKER_GIT_WEB_HOST"]?.trim() || "127.0.0.1"
const port = Number(process.env["DOCKER_GIT_WEB_PORT"]?.trim() || "4191")

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

const dbGateOwnedPathPrefixes = [
  "/admin",
  "/admin-license",
  "/build/",
  "/bulma.css",
  "/connections",
  "/database-connections",
  "/dimensions.css",
  "/favicon.ico",
  "/forgot-password",
  "/global.css",
  "/icon-colors.css",
  "/license",
  "/login",
  "/manifest.json",
  "/oauth",
  "/plugins",
  "/redirect",
  "/reset-password",
  "/runners",
  "/scheduler",
  "/set-admin-password",
  "/storage",
  "/tokens.css"
]

const isDbGateOwnedPath = (pathname) =>
  dbGateOwnedPathPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix))

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

const bridgeWebSockets = (clientSocket, upstream) => {
  const pending = []
  const sendWhenOpen = (socket, data, isBinary) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary })
    }
  }
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
  if (
    parsed.pathname === "/api" ||
    parsed.pathname.startsWith("/api/") ||
    parsed.pathname.startsWith("/p/") ||
    parsed.pathname.startsWith("/b/") ||
    parsed.pathname.startsWith("/d/") ||
    isDbGateOwnedPath(parsed.pathname)
  ) {
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

server.listen(port, host, () => {
  console.log(`docker-git web runtime listening on http://${host}:${port}`)
})

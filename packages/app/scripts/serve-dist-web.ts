import { createReadStream, existsSync, statSync } from "node:fs"
import { createServer, request as httpRequest } from "node:http"
import { extname, join, normalize } from "node:path"

import { WebSocket, WebSocketServer } from "ws"

const appRoot = "/home/dev/workspaces/provercoderai/docker-git/packages/app"
const staticRoot = join(appRoot, "dist-web")
const apiHost = process.env["DOCKER_GIT_API_HOST"]?.trim() || "127.0.0.1"
const apiPort = Number(process.env["DOCKER_GIT_API_PORT"]?.trim() || "3334")
const host = process.env["DOCKER_GIT_WEB_HOST"]?.trim() || "127.0.0.1"
const port = Number(process.env["DOCKER_GIT_WEB_PORT"]?.trim() || "4191")

const contentTypes: Readonly<Record<string, string>> = {
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

const resolveStaticPath = (pathname: string): string => {
  const normalized = normalize(pathname)
  return normalized.startsWith(staticRoot)
    ? normalized
    : join(staticRoot, normalized)
}

const serveFile = (
  pathname: string,
  response: import("node:http").ServerResponse
): void => {
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

const resolveUpstreamPath = (url: string): string => {
  const parsed = new URL(url, "http://localhost")
  const pathname = parsed.pathname.replace(/^\/api/u, "") || "/"
  return `${pathname}${parsed.search}`
}

const proxyHttp = (
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse
): void => {
  const upstream = httpRequest(
    {
      headers: { ...request.headers, host: `${apiHost}:${apiPort}` },
      host: apiHost,
      method: request.method,
      path: resolveUpstreamPath(request.url ?? "/"),
      port: apiPort
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

const server = createServer((request, response) => {
  const parsed = new URL(request.url ?? "/", "http://localhost")
  if (parsed.pathname.startsWith("/api/")) {
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
  if (!parsed.pathname.startsWith("/api/") || !parsed.pathname.endsWith("/ws")) {
    socket.destroy()
    return
  }

  const upstream = new WebSocket(`ws://${apiHost}:${apiPort}${resolveUpstreamPath(request.url ?? "/")}`)

  upstream.on("open", () => {
    webSocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
      clientSocket.on("message", (data, isBinary) => {
        upstream.send(data, { binary: isBinary })
      })
      clientSocket.on("close", () => {
        upstream.close()
      })
      upstream.on("message", (data, isBinary) => {
        clientSocket.send(data, { binary: isBinary })
      })
      upstream.on("close", () => {
        clientSocket.close()
      })
      upstream.on("error", () => {
        clientSocket.close()
      })
    })
  })

  upstream.on("error", () => {
    socket.destroy()
  })
})

server.listen(port, host, () => {
  console.log(`docker-git web runtime listening on http://${host}:${port}`)
})

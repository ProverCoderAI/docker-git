import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { fileURLToPath } from "node:url"

import { gridlandWebPlugin } from "@gridland/web/vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type PluginOption } from "vite"
import { type RawData, WebSocket, WebSocketServer } from "ws"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const defaultApiTarget = "http://127.0.0.1:3334"
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache"
}
const webSocketHeartbeatIntervalMs = 25_000

const createProxy = (apiTarget: string) => ({
  "/b": {
    target: apiTarget,
    changeOrigin: false,
    xfwd: true,
    ws: false
  },
  "/api": {
    target: apiTarget,
    changeOrigin: false,
    xfwd: true,
    ws: false,
    rewrite: (requestPath: string) => requestPath.replace(/^\/api/u, "")
  }
})

const resolveUpstreamPath = (requestUrl: string | undefined): string => {
  const parsed = new URL(requestUrl ?? "/", "http://localhost")
  const pathname = parsed.pathname.replace(/^\/api/u, "") || "/"
  return `${pathname}${parsed.search}`
}

const isApiTerminalWebSocketRequest = (request: IncomingMessage): boolean => {
  const parsed = new URL(request.url ?? "/", "http://localhost")
  return parsed.pathname.startsWith("/api/") && parsed.pathname.endsWith("/ws")
}

const isBrowserWebSocketRequest = (request: IncomingMessage): boolean => {
  const parsed = new URL(request.url ?? "/", "http://localhost")
  return parsed.pathname.startsWith("/b/")
}

const firstHeader = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : value?.[0]

const proxyForwardHeaders = (request: IncomingMessage): Record<string, string> => {
  const forwardedHost = firstHeader(request.headers["x-forwarded-host"]) ?? firstHeader(request.headers.host)
  const forwardedProto = firstHeader(request.headers["x-forwarded-proto"]) ?? "http"
  return {
    ...(forwardedHost === undefined ? {} : { "x-forwarded-host": forwardedHost }),
    "x-forwarded-proto": forwardedProto
  }
}

const attachWebSocketHeartbeat = (socket: WebSocket): void => {
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

const bridgeWebSockets = (clientSocket: WebSocket, upstream: WebSocket): void => {
  const pending: Array<{ readonly data: RawData; readonly isBinary: boolean }> = []
  const sendWhenOpen = (socket: WebSocket, data: RawData, isBinary: boolean): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary })
    }
  }
  attachWebSocketHeartbeat(clientSocket)
  attachWebSocketHeartbeat(upstream)
  const flushPending = (): void => {
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

const proxyWebSocket = (
  apiTarget: string,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  webSocketServer: WebSocketServer
): void => {
  const apiUrl = new URL(apiTarget)
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:"
  webSocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
    const upstream = new WebSocket(
      `${apiUrl.origin}${resolveUpstreamPath(request.url)}`,
      { headers: proxyForwardHeaders(request) }
    )
    bridgeWebSockets(clientSocket, upstream)
  })
}

const terminalWebSocketProxyPlugin = (apiTarget: string): PluginOption => ({
  name: "docker-git-terminal-websocket-proxy",
  configureServer(server) {
    const webSocketServer = new WebSocketServer({ noServer: true })
    server.httpServer?.prependListener("upgrade", (request, socket, head) => {
      if (!isApiTerminalWebSocketRequest(request) && !isBrowserWebSocketRequest(request)) {
        return
      }
      proxyWebSocket(apiTarget, request, socket, head, webSocketServer)
    })
  }
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "")
  const apiTarget = env["DOCKER_GIT_API_URL"]?.trim() || defaultApiTarget

  return {
    plugins: [
      terminalWebSocketProxyPlugin(apiTarget),
      ...gridlandWebPlugin(),
      react()
    ],
    publicDir: false,
    resolve: {
      alias: [
        {
          find: /^@lib\/(.*)$/u,
          replacement: path.resolve(__dirname, "src/lib") + "/$1.ts"
        },
        {
          find: "@lib",
          replacement: path.resolve(__dirname, "src/lib/index.ts")
        },
        {
          find: /^@\/(.*)$/u,
          replacement: path.resolve(__dirname, "src") + "/$1"
        },
        {
          find: "@",
          replacement: path.resolve(__dirname, "src")
        }
      ]
    },
    server: {
      host: "127.0.0.1",
      port: 4174,
      allowedHosts: [".trycloudflare.com"],
      headers: noStoreHeaders,
      proxy: createProxy(apiTarget)
    },
    preview: {
      host: "127.0.0.1",
      port: 4174,
      headers: noStoreHeaders
    },
    build: {
      target: "esnext",
      outDir: "dist-web",
      sourcemap: true
    },
    esbuild: {
      target: "esnext"
    },
    optimizeDeps: {
      esbuildOptions: {
        target: "esnext"
      }
    }
  }
})

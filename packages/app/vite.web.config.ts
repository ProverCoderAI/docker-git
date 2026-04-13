import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { fileURLToPath } from "node:url"

import { gridlandWebPlugin } from "@gridland/web/vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type PluginOption } from "vite"
import { WebSocket, WebSocketServer } from "ws"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const defaultApiTarget = "http://127.0.0.1:3334"
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache"
}

const createProxy = (apiTarget: string) => ({
  "/api": {
    target: apiTarget,
    changeOrigin: true,
    ws: false,
    rewrite: (requestPath: string) => requestPath.replace(/^\/api/u, "")
  }
})

const resolveUpstreamPath = (requestUrl: string | undefined): string => {
  const parsed = new URL(requestUrl ?? "/", "http://localhost")
  const pathname = parsed.pathname.replace(/^\/api/u, "") || "/"
  return `${pathname}${parsed.search}`
}

const isTerminalWebSocketRequest = (request: IncomingMessage): boolean => {
  const parsed = new URL(request.url ?? "/", "http://localhost")
  return parsed.pathname.startsWith("/api/") && parsed.pathname.endsWith("/ws")
}

const proxyTerminalWebSocket = (
  apiTarget: string,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  webSocketServer: WebSocketServer
): void => {
  const apiUrl = new URL(apiTarget)
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:"
  const upstream = new WebSocket(`${apiUrl.origin}${resolveUpstreamPath(request.url)}`)

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
}

const terminalWebSocketProxyPlugin = (apiTarget: string): PluginOption => ({
  name: "docker-git-terminal-websocket-proxy",
  configureServer(server) {
    const webSocketServer = new WebSocketServer({ noServer: true })
    server.httpServer?.prependListener("upgrade", (request, socket, head) => {
      if (!isTerminalWebSocketRequest(request)) {
        return
      }
      proxyTerminalWebSocket(apiTarget, request, socket, head, webSocketServer)
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

import path from "node:path"
import { fileURLToPath } from "node:url"

import { gridlandWebPlugin } from "@gridland/web/vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv } from "vite"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const defaultApiTarget = "http://127.0.0.1:3334"
const terminalWsProxyPath = "^/api/projects/.+/terminal-sessions/.+/ws$"
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
  Pragma: "no-cache"
}

const createProxy = (apiTarget: string, apiWsTarget: string) => ({
  [terminalWsProxyPath]: {
    target: apiWsTarget,
    changeOrigin: true,
    ws: true,
    rewrite: (requestPath: string) => requestPath.replace(/^\/api/u, "")
  },
  "/api": {
    target: apiTarget,
    changeOrigin: true,
    ws: true,
    rewrite: (requestPath: string) => requestPath.replace(/^\/api/u, "")
  }
})

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "")
  const apiTarget = env["DOCKER_GIT_API_URL"]?.trim() || defaultApiTarget
  const apiWsTarget = apiTarget.replace(/^http/u, "ws")

  return {
    plugins: [
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
      proxy: createProxy(apiTarget, apiWsTarget)
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

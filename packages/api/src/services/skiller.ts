import { spawn, type ChildProcess } from "node:child_process"
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync } from "node:fs"
import { createServer } from "node:net"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import type * as HttpServerError from "@effect/platform/HttpServerError"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import { Effect } from "effect"
import * as Stream from "effect/Stream"

import { ApiConflictError, ApiInternalError, ApiNotFoundError } from "../api/errors.js"

export type SkillerLaunch = {
  readonly alreadyRunning: boolean
  readonly appPath: string
  readonly logPath: string
  readonly pid: number | null
  readonly startedAtIso: string
  readonly trpcBasePath: string
  readonly trpcPort: number
}

type SkillerProcess = {
  readonly appPath: string
  readonly logPath: string
  readonly process: ChildProcess
  readonly startedAtIso: string
  readonly trpcBasePath: string
  readonly trpcPort: number
}

type SkillerRoute =
  | { readonly _tag: "App"; readonly relativePath: string }
  | { readonly _tag: "Trpc"; readonly upstreamPath: string }

const submoduleRelativePath = join("third_party", "skiller-desktop-skills-manager")
const launchLogPath = join(homedir(), ".docker-git", "logs", "skiller.log")
const skillerAppPath = "/api/skiller/app/"
const skillerTrpcBasePath = "/api/skiller"
const skillerPreferredTrpcPort = 17888

let currentProcess: SkillerProcess | null = null

const isRunning = (process: ChildProcess): boolean =>
  process.exitCode === null && process.signalCode === null && !process.killed

const findWorkspaceRoot = (startDir: string): string | null => {
  let current = resolve(startDir)
  for (;;) {
    if (existsSync(join(current, ".gitmodules")) && existsSync(join(current, submoduleRelativePath))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) {
      return null
    }
    current = parent
  }
}

const resolveSkillerDir = (): Effect.Effect<string, ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const root = findWorkspaceRoot(process.cwd())
    if (root === null) {
      return yield* _(Effect.fail(new ApiNotFoundError({
        message: "docker-git workspace root with Skiller submodule was not found."
      })))
    }
    const skillerDir = join(root, submoduleRelativePath)
    if (!existsSync(join(skillerDir, "package.json"))) {
      return yield* _(Effect.fail(new ApiNotFoundError({
        message: `Skiller submodule is not initialized at ${skillerDir}. Run bun run skiller:init first.`
      })))
    }
    return skillerDir
  })

const toLaunch = (process: SkillerProcess, alreadyRunning: boolean): SkillerLaunch => ({
  alreadyRunning,
  appPath: process.appPath,
  logPath: process.logPath,
  pid: process.process.pid ?? null,
  startedAtIso: process.startedAtIso,
  trpcBasePath: process.trpcBasePath,
  trpcPort: process.trpcPort
})

const isPortAvailable = (port: number): Promise<boolean> =>
  new Promise((resolve) => {
    const server = createServer()
    server.once("error", () => {
      resolve(false)
    })
    server.once("listening", () => {
      server.close(() => {
        resolve(true)
      })
    })
    server.listen({ host: "127.0.0.1", port })
  })

const findAvailablePort = async (preferredPort: number): Promise<number> => {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (await isPortAvailable(port)) {
      return port
    }
  }
  throw new Error(`No available Skiller tRPC port in range ${preferredPort}-${preferredPort + 99}.`)
}

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, durationMs)
  })

const waitForSkillerReady = (trpcPort: number): Effect.Effect<void, ApiInternalError> =>
  Effect.tryPromise({
    catch: (cause) => new ApiInternalError({
      message: "Skiller started but did not become ready.",
      cause
    }),
    try: async () => {
      const deadline = Date.now() + 60_000
      let lastError: unknown = null
      while (Date.now() < deadline) {
        try {
          const response = await fetch(`http://127.0.0.1:${trpcPort}/trpc/get_app_version`)
          if (response.ok) {
            return
          }
          lastError = new Error(`HTTP ${response.status}`)
        } catch (error) {
          lastError = error
        }
        await sleep(1_000)
      }
      throw lastError ?? new Error("Timed out waiting for Skiller tRPC.")
    }
  })

const launchScript = [
  "set -euo pipefail",
  "if [ ! -d node_modules ]; then bun install --frozen-lockfile; fi",
  "bun run build",
  "ln -sf index.mjs out/preload/index.js",
  "if [ -z \"${DISPLAY:-}\" ] && command -v xvfb-run >/dev/null 2>&1; then",
  "  exec xvfb-run -a ./node_modules/electron/dist/electron --no-sandbox out/main/index.js",
  "fi",
  "exec ./node_modules/electron/dist/electron --no-sandbox out/main/index.js"
].join("\n")

const launchSkillerProcess = (skillerDir: string, trpcPort: number): SkillerLaunch => {
  mkdirSync(dirname(launchLogPath), { recursive: true })
  const logFd = openSync(launchLogPath, "a")
  try {
    const child = spawn("bash", ["-lc", launchScript], {
      cwd: skillerDir,
      detached: true,
      env: {
        ...process.env,
        AGENTSKILLS_TRPC_PORT: String(trpcPort),
        ELECTRON_ENABLE_LOGGING: "1"
      },
      stdio: ["ignore", logFd, logFd]
    })
    const startedAtIso = new Date().toISOString()
    currentProcess = {
      appPath: skillerAppPath,
      logPath: launchLogPath,
      process: child,
      startedAtIso,
      trpcBasePath: skillerTrpcBasePath,
      trpcPort
    }
    child.once("exit", () => {
      if (currentProcess?.process.pid === child.pid) {
        currentProcess = null
      }
    })
    child.unref()
    return toLaunch(currentProcess, false)
  } finally {
    closeSync(logFd)
  }
}

export const openSkiller = (): Effect.Effect<SkillerLaunch, ApiInternalError | ApiNotFoundError> =>
  Effect.gen(function*(_) {
    if (currentProcess !== null && isRunning(currentProcess.process)) {
      return toLaunch(currentProcess, true)
    }
    const skillerDir = yield* _(resolveSkillerDir())
    const trpcPort = yield* _(Effect.tryPromise({
      catch: (cause) => new ApiInternalError({
        message: "Failed to reserve Skiller tRPC port.",
        cause
      }),
      try: () => findAvailablePort(skillerPreferredTrpcPort)
    }))
    const launch = yield* _(Effect.try({
      catch: (cause) => new ApiInternalError({
        message: "Failed to launch Skiller.",
        cause
      }),
      try: () => launchSkillerProcess(skillerDir, trpcPort)
    }))
    yield* _(waitForSkillerReady(trpcPort))
    return launch
  })

export const parseSkillerRoute = (pathname: string): SkillerRoute | null => {
  const normalized = pathname.startsWith("/api/skiller") ? pathname.slice("/api".length) : pathname
  if (normalized === "/skiller/app" || normalized === "/skiller/app/") {
    return { _tag: "App", relativePath: "/" }
  }
  if (normalized.startsWith("/skiller/app/")) {
    return { _tag: "App", relativePath: normalized.slice("/skiller/app".length) }
  }
  if (normalized === "/skiller/trpc" || normalized.startsWith("/skiller/trpc/")) {
    return { _tag: "Trpc", upstreamPath: normalized.slice("/skiller".length) || "/trpc" }
  }
  return null
}

const contentTypeForPath = (path: string): string => {
  if (path.endsWith(".css")) {
    return "text/css; charset=utf-8"
  }
  if (path.endsWith(".js")) {
    return "application/javascript; charset=utf-8"
  }
  if (path.endsWith(".png")) {
    return "image/png"
  }
  if (path.endsWith(".svg")) {
    return "image/svg+xml"
  }
  if (path.endsWith(".html")) {
    return "text/html; charset=utf-8"
  }
  return "application/octet-stream"
}

const browserTrpcBaseBootstrap = [
  "<script>",
  "(() => {",
  "  const apiPrefix = window.location.pathname.startsWith('/api/') ? '/api' : '';",
  "  window.__SKILLER_TRPC_BASE_URL__ = `${window.location.origin}${apiPrefix}/skiller`;",
  "})();",
  "</script>"
].join("")

const injectBrowserTrpcBase = (html: string): string =>
  html.includes("<head>")
    ? html.replace("<head>", `<head>${browserTrpcBaseBootstrap}`)
    : `${browserTrpcBaseBootstrap}${html}`

const safeRendererPath = (skillerDir: string, relativePath: string): string => {
  const rendererDir = resolve(skillerDir, "out", "renderer")
  const rawRelativePath = relativePath === "/" ? "/index.html" : relativePath
  const decoded = decodeURIComponent(rawRelativePath)
  const target = resolve(rendererDir, `.${decoded}`)
  if (target !== rendererDir && !target.startsWith(`${rendererDir}/`)) {
    throw new Error("Skiller asset path escapes renderer directory.")
  }
  const stats = statSync(target)
  return stats.isDirectory() ? join(target, "index.html") : target
}

export const serveSkillerApp = (
  route: Extract<SkillerRoute, { readonly _tag: "App" }>
): Effect.Effect<HttpServerResponse.HttpServerResponse, ApiInternalError | ApiNotFoundError> =>
  Effect.gen(function*(_) {
    const skillerDir = yield* _(resolveSkillerDir())
    const filePath = yield* _(Effect.try({
      catch: () => new ApiNotFoundError({
        message: "Skiller app asset was not found. Open Skiller once and wait for the build to finish."
      }),
      try: () => safeRendererPath(skillerDir, route.relativePath)
    }))
    const content = yield* _(Effect.try({
      catch: (cause) => new ApiInternalError({
        message: "Failed to read Skiller app asset.",
        cause
      }),
      try: () => readFileSync(filePath)
    }))
    if (filePath.endsWith(".html")) {
      return HttpServerResponse.text(injectBrowserTrpcBase(content.toString("utf8")), {
        contentType: "text/html; charset=utf-8",
        headers: { "cache-control": "no-store" }
      })
    }
    return HttpServerResponse.uint8Array(new Uint8Array(content), {
      contentType: contentTypeForPath(filePath),
      headers: { "cache-control": "no-store" }
    })
  })

const hopByHopHeaders = new Set([
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
])

const copyRequestHeaders = (request: HttpServerRequest.HttpServerRequest): Headers => {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    if (typeof value === "string" && !hopByHopHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  return headers
}

const copyResponseHeaders = (response: Response): Record<string, string> => {
  const headers: Record<string, string> = { "cache-control": "no-store" }
  response.headers.forEach((value, key) => {
    if (!hopByHopHeaders.has(key.toLowerCase())) {
      headers[key] = value
    }
  })
  return headers
}

export const proxySkillerTrpc = (
  request: HttpServerRequest.HttpServerRequest,
  route: Extract<SkillerRoute, { readonly _tag: "Trpc" }>
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  ApiConflictError | ApiInternalError | HttpServerError.RequestError
> =>
  Effect.gen(function*(_) {
    if (currentProcess === null || !isRunning(currentProcess.process)) {
      return yield* _(Effect.fail(new ApiConflictError({
        message: "Skiller is not running. Click the Skiller button first."
      })))
    }
    const parsed = new URL(request.url, "http://localhost")
    const upstreamUrl = new URL(
      `${route.upstreamPath}${parsed.search}`,
      `http://127.0.0.1:${currentProcess.trpcPort}`
    )
    const body = request.method === "GET" || request.method === "HEAD"
      ? undefined
      : yield* _(request.arrayBuffer)
    const upstreamResponse = yield* _(Effect.tryPromise({
      catch: (cause) => new ApiInternalError({
        message: "Failed to proxy Skiller tRPC.",
        cause
      }),
      try: () => fetch(upstreamUrl, {
        ...(body === undefined ? {} : { body }),
        headers: copyRequestHeaders(request),
        method: request.method
      })
    }))
    const headers = copyResponseHeaders(upstreamResponse)
    if (request.method === "HEAD" || upstreamResponse.body === null) {
      return HttpServerResponse.empty({ headers, status: upstreamResponse.status })
    }
    return HttpServerResponse.stream(
      Stream.fromReadableStream(
        () => upstreamResponse.body as ReadableStream<Uint8Array>,
        (cause) => new ApiInternalError({ message: "Failed to read Skiller tRPC response.", cause })
      ),
      {
        headers,
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText
      }
    )
  })

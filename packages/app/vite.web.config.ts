import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { Duplex } from "node:stream"
import { fileURLToPath } from "node:url"

import { gridlandWebPlugin } from "@gridland/web/vite-plugin"
import react from "@vitejs/plugin-react"
import { defineConfig, loadEnv, type HookHandler, type Plugin, type PluginOption, type UserConfig } from "vite"
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
  "/.well-known/webfinger": {
    target: apiTarget,
    changeOrigin: false,
    xfwd: true,
    ws: false
  },
  "/b": {
    target: apiTarget,
    changeOrigin: false,
    xfwd: true,
    ws: false
  },
  "/federation": {
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

type VitePluginConfig = Omit<UserConfig, "plugins">
type ViteConfigHook = HookHandler<NonNullable<Plugin["config"]>>
type ViteConfigObjectHook = Exclude<NonNullable<Plugin["config"]>, ViteConfigHook>
type ViteConfigHookResult = ReturnType<ViteConfigHook>

/**
 * Removes the deprecated dependency optimizer esbuild bridge from optional Vite optimizeDeps config.
 *
 * @param optimizeDeps - Optional Vite dependency optimizer config emitted by a plugin.
 * @returns `undefined` when no config exists; otherwise a shallow copy without `esbuildOptions`.
 * @pure true
 * @precondition `optimizeDeps` is either undefined or a Vite optimizeDeps object.
 * @postcondition The result is undefined iff the input is undefined; otherwise `esbuildOptions` is absent.
 * @invariant Every non-`esbuildOptions` own field is preserved by key and value.
 * @complexity O(k) time / O(k) space, where k is the number of own optimizeDeps fields.
 * @throws Never.
 */
// CHANGE: Strip only the deprecated optimizeDeps.esbuildOptions field.
// WHY: Vite 8 warns on that bridge while all other optimizer settings remain valid input.
// QUOTE(ТЗ): "Что бы оно не писалось"
// REF: PR #356 review 4388758572
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/356#pullrequestreview-4388758572
// FORMAT THEOREM: ∀o ∈ OptimizeDeps: strip(o) = o \ {esbuildOptions}
// PURITY: CORE
// EFFECT: none
// INVARIANT: ∀key ≠ esbuildOptions: result[key] = optimizeDeps[key]
// COMPLEXITY: O(k) time / O(k) space
const removeDeprecatedOptimizeDepsOptions = (
  optimizeDeps: UserConfig["optimizeDeps"]
): UserConfig["optimizeDeps"] => {
  if (optimizeDeps === undefined) {
    return undefined
  }

  const { esbuildOptions: _esbuildOptions, ...remainingOptions } = optimizeDeps
  return remainingOptions
}

/**
 * Removes deprecated top-level and nested Gridland Vite config options from an optional plugin config.
 *
 * @param config - Optional Vite config fragment returned by the Gridland aliases plugin.
 * @returns The original nullish value, or a shallow config copy without deprecated esbuild fields.
 * @pure true
 * @precondition `config` is nullish or a Vite plugin config fragment without a `plugins` field.
 * @postcondition Returned object has no top-level `esbuild`; nested `optimizeDeps.esbuildOptions` is absent.
 * @invariant All non-deprecated config fields are preserved by key and value.
 * @complexity O(k + n) time / O(k + n) space, where k is config fields and n is optimizeDeps fields.
 * @throws Never.
 */
// CHANGE: Normalize Gridland config fragments before Vite consumes them.
// WHY: The deprecated fields are warning-only compatibility options, not required for web build semantics.
// QUOTE(ТЗ): "Что бы оно не писалось"
// REF: PR #356 review 4388758572
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/356#pullrequestreview-4388758572
// FORMAT THEOREM: ∀c ∈ Config: normalize(c).esbuild = undefined ∧ normalize(c).optimizeDeps.esbuildOptions = undefined
// PURITY: CORE
// EFFECT: none
// INVARIANT: ∀key ∉ {esbuild,optimizeDeps.esbuildOptions}: normalize(c)[key] = c[key]
// COMPLEXITY: O(k + n) time / O(k + n) space
const removeDeprecatedGridlandOptions = (
  config: VitePluginConfig | null | void
): VitePluginConfig | null | void => {
  if (config === undefined || config === null) {
    return config
  }

  const { esbuild: _esbuild, optimizeDeps, ...remainingConfig } = config
  const sanitizedOptimizeDeps = removeDeprecatedOptimizeDepsOptions(optimizeDeps)
  return sanitizedOptimizeDeps === undefined
    ? remainingConfig
    : {
      ...remainingConfig,
      optimizeDeps: sanitizedOptimizeDeps
    }
}

/**
 * Tests whether a Vite plugin option is a concrete plugin object with a name.
 *
 * @param plugin - Vite plugin option produced by a plugin factory.
 * @returns True when the option is an object plugin; false for arrays, null, booleans, and functions.
 * @pure true
 * @precondition `plugin` is any value accepted by Vite as PluginOption.
 * @postcondition A true result narrows `plugin` to `Plugin` for property-safe access.
 * @invariant The predicate has no side effects and does not mutate the inspected value.
 * @complexity O(1) time / O(1) space.
 * @throws Never.
 */
// CHANGE: Provide a pure predicate for concrete Vite plugin objects.
// WHY: The wrapper must only inspect named object plugins and preserve every other plugin option shape.
// QUOTE(ТЗ): "Что бы оно не писалось"
// REF: PR #356 review 4388758572
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/356#pullrequestreview-4388758572
// FORMAT THEOREM: ∀p ∈ PluginOption: isVitePlugin(p) → "name" ∈ keys(p)
// PURITY: CORE
// EFFECT: none
// INVARIANT: isVitePlugin(p) is a deterministic boolean predicate over p's runtime shape.
// COMPLEXITY: O(1) time / O(1) space
const isVitePlugin = (plugin: PluginOption): plugin is Plugin =>
  typeof plugin === "object" && plugin !== null && !Array.isArray(plugin) && "name" in plugin

/**
 * Tests whether a Vite config hook is declared in object-hook form.
 *
 * @param hook - Concrete Vite config hook from a plugin.
 * @returns True when the hook has a callable `handler` property.
 * @pure true
 * @precondition `hook` is a non-null Vite config hook.
 * @postcondition A true result narrows `hook` to object-hook form.
 * @invariant The predicate does not call or mutate the hook.
 * @complexity O(1) time / O(1) space.
 * @throws Never.
 */
// CHANGE: Recognize Vite object-hook config declarations.
// WHY: Sanitization should be stable if Gridland changes from function hook to object hook.
// QUOTE(ТЗ): "Что бы оно не писалось"
// REF: PR #356 review 4388758572
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/356#pullrequestreview-4388758572
// FORMAT THEOREM: ∀h ∈ ConfigHook: isObjectHook(h) → callable(h.handler)
// PURITY: CORE
// EFFECT: none
// INVARIANT: isViteConfigObjectHook(h) is deterministic over h's runtime shape.
// COMPLEXITY: O(1) time / O(1) space
const isViteConfigObjectHook = (
  hook: NonNullable<Plugin["config"]>
): hook is ViteConfigObjectHook =>
  typeof hook === "object" && hook !== null && "handler" in hook && typeof hook.handler === "function"

/**
 * Sanitizes either synchronous or asynchronous Gridland config hook output.
 *
 * @param result - Result returned by the original Gridland aliases config hook.
 * @returns The same sync/async shape with deprecated options removed from the resolved config.
 * @pure true
 * @precondition `result` is a valid Vite config hook result.
 * @postcondition Nullish results remain nullish; config objects are normalized after resolution.
 * @invariant Promise shape is preserved: Promise input yields Promise output; sync input yields sync output.
 * @complexity O(k + n) time / O(k + n) space after the hook result resolves.
 * @throws Never.
 */
// CHANGE: Centralize sync and async Gridland config result normalization.
// WHY: Function and object Vite hooks must share the same warning-suppression invariant.
// QUOTE(ТЗ): "Что бы оно не писалось"
// REF: PR #356 review 4388758572
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/356#pullrequestreview-4388758572
// FORMAT THEOREM: ∀r ∈ HookResult: sanitize(r) resolves to normalize(r)
// PURITY: CORE
// EFFECT: none
// INVARIANT: Sync/async result shape is preserved while resolved config is normalized.
// COMPLEXITY: O(k + n) time / O(k + n) space
const sanitizeGridlandConfigResult = (result: ViteConfigHookResult): ViteConfigHookResult =>
  result instanceof Promise
    ? result.then(removeDeprecatedGridlandOptions)
    : removeDeprecatedGridlandOptions(result)

/**
 * Produces Gridland web plugins with the aliases config hook wrapped to suppress deprecated Vite output.
 *
 * @returns Plugin options from `gridlandWebPlugin` with only `gridland-web-aliases` config sanitized.
 * @pure true
 * @precondition `gridlandWebPlugin` returns Vite plugin options.
 * @postcondition Non-object plugins and non-target plugins are preserved; target config output is normalized.
 * @invariant Plugin order and non-target plugin identity are preserved.
 * @complexity O(p) time / O(p) space, where p is the number of Gridland plugin options.
 * @throws Never.
 */
// CHANGE: Wrap only the Gridland aliases plugin config hook.
// WHY: The build warning source is localized to that plugin; unrelated plugins must retain their behavior.
// QUOTE(ТЗ): "Что бы оно не писалось"
// REF: PR #356 review 4388758572
// SOURCE: https://github.com/ProverCoderAI/docker-git/pull/356#pullrequestreview-4388758572
// FORMAT THEOREM: ∀p ≠ aliases: wrap(p) = p; aliases config output is normalized.
// PURITY: CORE
// EFFECT: none
// INVARIANT: Plugin array length and order are unchanged.
// COMPLEXITY: O(p) time / O(p) space
const gridlandWebPluginWithoutDeprecatedOptions = (): ReadonlyArray<PluginOption> =>
  gridlandWebPlugin().map((plugin) => {
    if (!isVitePlugin(plugin) || plugin.name !== "gridland-web-aliases" || plugin.config === undefined) {
      return plugin
    }

    const gridlandConfig = plugin.config
    if (typeof gridlandConfig === "function") {
      return {
        ...plugin,
        config(config, env) {
          return sanitizeGridlandConfigResult(gridlandConfig.call(this, config, env))
        }
      }
    }

    if (!isViteConfigObjectHook(gridlandConfig)) {
      return plugin
    }

    const resolveGridlandConfig = gridlandConfig.handler
    return {
      ...plugin,
      config: {
        ...gridlandConfig,
        handler(config, env) {
          return sanitizeGridlandConfigResult(resolveGridlandConfig.call(this, config, env))
        }
      }
    }
  })

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, "")
  const apiTarget = env["DOCKER_GIT_API_URL"]?.trim() || defaultApiTarget

  return {
    plugins: [
      terminalWebSocketProxyPlugin(apiTarget),
      ...gridlandWebPluginWithoutDeprecatedOptions(),
      react()
    ],
    publicDir: false,
    resolve: {
      alias: [
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
      sourcemap: true,
      chunkSizeWarningLimit: 1200,
      rolldownOptions: {
        checks: {
          invalidAnnotation: false
        }
      }
    }
  }
})

import { recordProjectRuntimeActivity } from "@effect-template/lib"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { parseInspectNetworkEntry } from "@effect-template/lib/shell/docker-inspect-parse"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { loadProjectIndex, loadProjectStatus } from "@effect-template/lib/usecases/projects-core"
import type { ListProjectsContext } from "@effect-template/lib/usecases/projects-list"
import { NodeContext } from "@effect/platform-node"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as HttpServerError from "@effect/platform/HttpServerError"
import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import type { IncomingMessage, Server as HttpServer } from "node:http"
import { createConnection, type Socket } from "node:net"
import { dirname } from "node:path"
import type { Duplex } from "node:stream"
import { type RawData, WebSocket, WebSocketServer } from "ws"

import type { ProjectBrowserSession, ProjectBrowserStatus } from "../api/contracts.js"
import { ApiBadRequestError, ApiConflictError, ApiInternalError, ApiNotFoundError } from "../api/errors.js"
import {
  browserCdpPort,
  browserNoVncPort,
  browserVncPort,
  parseProjectBrowserProxyPath,
  renderExternalUrl,
  renderProjectBrowserCdpPath,
  renderProjectBrowserNoVncPath,
  rewriteCdpVersionPayload,
  type ProjectBrowserProxyPath
} from "./project-browser-core.js"
import { getProjectItemById } from "./projects.js"
import { normalizeForwardedPrefix, projectShortKey, rewriteProxyLocation } from "./project-port-proxy-core.js"

type BrowserApiError =
  | ApiBadRequestError
  | ApiConflictError
  | ApiInternalError
  | ApiNotFoundError

type BrowserContainerState = {
  readonly id: string
  readonly running: boolean
  readonly status: ProjectBrowserStatus
}

type ContainerNetworkEntry = {
  readonly ipAddress: string
  readonly name: string
}

type BrowserNetworkInspection = {
  readonly networkMode: string
  readonly networks: ReadonlyArray<ContainerNetworkEntry>
}

type BrowserProxyUpstream = {
  readonly headers: Record<string, string>
  readonly projectId: string
  readonly projectKey: string
  readonly proxyPath: string
  readonly target: ProjectBrowserProxyPath
  readonly upstreamOrigin: string
  readonly upstreamUrl: URL
}

type BrowserProjectLookup = {
  readonly containerName: string
  readonly projectDir: string
  readonly projectId: string
}

type BrowserWebSocketUpstream =
  | {
    readonly _tag: "Tcp"
    readonly host: string
    readonly port: number
    readonly projectId: string
  }
  | {
    readonly _tag: "WebSocket"
    readonly headers: Record<string, string>
    readonly projectId: string
    readonly url: string
  }

type PendingWebSocketMessage = {
  readonly data: RawData
  readonly isBinary: boolean
}

const dockerOkExit = [0]
const cdpHostHeader = "127.0.0.1:9222"
const browserActivityWriteIntervalMs = 30_000
const browserActivityWrites = new Map<string, number>()
const browserWebSocketCounts = new Map<string, number>()

const hopByHopRequestHeaders = new Set([
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

const hopByHopResponseHeaders = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
])

const dockerGitApiContainerName = (): string => process.env["DOCKER_GIT_API_CONTAINER_NAME"]?.trim() || "docker-git-api"

const touchProjectBrowserActivity = (projectId: string): void => {
  const now = Date.now()
  const lastWrite = browserActivityWrites.get(projectId) ?? 0
  if (now - lastWrite < browserActivityWriteIntervalMs) {
    return
  }
  browserActivityWrites.set(projectId, now)
  Effect.runFork(
    recordProjectRuntimeActivity(projectId, "interactive").pipe(
      Effect.provide(NodeContext.layer),
      Effect.catchAll((error) =>
        Effect.logWarning(
          `[project-browser] Failed to record browser activity for project ${projectId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      )
    )
  )
}

const incrementBrowserWebSocket = (projectId: string): void => {
  browserWebSocketCounts.set(projectId, (browserWebSocketCounts.get(projectId) ?? 0) + 1)
  touchProjectBrowserActivity(projectId)
}

const decrementBrowserWebSocket = (projectId: string): void => {
  const next = Math.max(0, (browserWebSocketCounts.get(projectId) ?? 0) - 1)
  if (next === 0) {
    browserWebSocketCounts.delete(projectId)
    return
  }
  browserWebSocketCounts.set(projectId, next)
}

const dockerCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  command: string,
  okExitCodes: ReadonlyArray<number> = dockerOkExit
) =>
  runCommandCapture(
    {
      args,
      command: "docker",
      cwd
    },
    okExitCodes,
    (exitCode) => new CommandFailedError({ command, exitCode })
  )

const browserContainerName = (projectContainerName: string): string => `${projectContainerName}-browser`

const statusFromDockerState = (running: boolean, state: string): ProjectBrowserStatus => {
  const normalized = state.trim().toLowerCase()
  if (running) {
    return "running"
  }
  if (normalized === "missing") {
    return "missing"
  }
  if (normalized === "created" || normalized === "dead" || normalized === "exited" || normalized === "removing") {
    return "stopped"
  }
  return "unknown"
}

const parseBrowserContainerState = (output: string): BrowserContainerState => {
  const [id = "", rawRunning = "", rawState = ""] = output.trim().split("\t")
  const running = rawRunning === "true"
  return {
    id,
    running,
    status: statusFromDockerState(running, rawState)
  }
}

const missingBrowserContainerState: BrowserContainerState = {
  id: "",
  running: false,
  status: "missing"
}

const inspectBrowserContainerState = (
  cwd: string,
  containerName: string
) =>
  dockerCapture(
    cwd,
    ["inspect", "-f", "{{.Id}}\t{{.State.Running}}\t{{.State.Status}}", containerName],
    "docker inspect browser"
  ).pipe(
    Effect.map(parseBrowserContainerState),
    Effect.catchAll(() => Effect.succeed(missingBrowserContainerState))
  )

const parseContainerNetworkEntries = (output: string): ReadonlyArray<ContainerNetworkEntry> =>
  output
    .trim()
    .split(/\r?\n/u)
    .flatMap((line) => parseInspectNetworkEntry(line))
    .map(([name, ipAddress]) => ({ name, ipAddress }))

const inspectContainerNetworks = (
  cwd: string,
  containerName: string
) =>
  dockerCapture(
    cwd,
    [
      "inspect",
      "-f",
      String.raw`{{range $k,$v := .NetworkSettings.Networks}}{{printf "%s=%s\n" $k $v.IPAddress}}{{end}}`,
      containerName
    ],
    "docker inspect browser networks"
  ).pipe(
    Effect.map(parseContainerNetworkEntries),
    Effect.mapError((error) => new ApiInternalError({ message: `Failed to inspect browser networks: ${containerName}`, cause: error }))
  )

const inspectContainerNetworkMode = (
  cwd: string,
  containerName: string
) =>
  dockerCapture(
    cwd,
    ["inspect", "-f", "{{.HostConfig.NetworkMode}}", containerName],
    "docker inspect network mode"
  ).pipe(
    Effect.map((output) => output.trim()),
    Effect.mapError((error) => new ApiInternalError({ message: `Failed to inspect container network mode: ${containerName}`, cause: error }))
  )

const inspectBrowserNetwork = (
  cwd: string,
  containerName: string
) =>
  Effect.all({
    networkMode: inspectContainerNetworkMode(cwd, containerName),
    networks: inspectContainerNetworks(cwd, containerName)
  })

const connectContainerToNetwork = (
  cwd: string,
  networkName: string,
  containerName: string
) =>
  networkName === "bridge"
    ? Effect.void
    : dockerCapture(
      cwd,
      ["network", "connect", networkName, containerName],
      `docker network connect ${networkName}`
    ).pipe(
      Effect.asVoid,
      Effect.orElseSucceed(() => void 0)
    )

const selectReachableNetwork = (
  entries: ReadonlyArray<ContainerNetworkEntry>
): ContainerNetworkEntry | null => entries.find((entry) => entry.name !== "bridge") ?? entries[0] ?? null

const containerNetworkModeTarget = (networkMode: string): string | null => {
  const prefix = "container:"
  return networkMode.startsWith(prefix) ? networkMode.slice(prefix.length) : null
}

const shouldProxyBrowserViaProjectContainer = (
  projectContainerName: string,
  inspection: BrowserNetworkInspection
): boolean =>
  inspection.networks.length === 0 || containerNetworkModeTarget(inspection.networkMode) === projectContainerName

const ensureReachableIpFromNetworks = (
  cwd: string,
  containerName: string,
  entries: ReadonlyArray<ContainerNetworkEntry>
): Effect.Effect<string, ApiInternalError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    yield* _(
      Effect.forEach(
        entries.filter((entry) => entry.name !== "bridge"),
        (entry) => connectContainerToNetwork(cwd, entry.name, dockerGitApiContainerName()),
        { discard: true }
      )
    )
    const selected = selectReachableNetwork(entries)
    if (selected === null || selected.ipAddress.length === 0) {
      return yield* _(Effect.fail(new ApiInternalError({ message: `Container has no reachable IP: ${containerName}` })))
    }
    return selected.ipAddress
  })

const ensureBrowserReachableIp = (
  cwd: string,
  browserContainerNameValue: string,
  projectContainerName: string
): Effect.Effect<string, ApiInternalError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const browserNetwork = yield* _(inspectBrowserNetwork(cwd, browserContainerNameValue))
    if (shouldProxyBrowserViaProjectContainer(projectContainerName, browserNetwork)) {
      const projectNetworks = yield* _(inspectContainerNetworks(cwd, projectContainerName))
      return yield* _(ensureReachableIpFromNetworks(cwd, projectContainerName, projectNetworks))
    }
    return yield* _(ensureReachableIpFromNetworks(cwd, browserContainerNameValue, browserNetwork.networks))
  })

const resolveProjectByKey = (
  projectKey: string
): Effect.Effect<BrowserProjectLookup, BrowserApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const index = yield* _(loadProjectIndex())
    if (index === null) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
    }
    const matches = index.configPaths
      .map((configPath) => ({ configPath, projectDir: dirname(configPath) }))
      .filter((project) => projectShortKey(project.projectDir) === projectKey)
    if (matches.length === 0) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
    }
    if (matches.length > 1) {
      return yield* _(Effect.fail(new ApiConflictError({ message: `Project key is ambiguous: ${projectKey}` })))
    }
    const match = matches[0]
    if (match === undefined) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
    }
    const status = yield* _(
      loadProjectStatus(match.configPath).pipe(
        Effect.mapError((cause) =>
          new ApiInternalError({
            message: `Failed to load project config for key: ${projectKey}`,
            cause
          })
        )
      )
    )
    return status === undefined
      ? yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
      : {
        containerName: status.config.template.containerName,
        projectDir: status.projectDir,
        projectId: status.projectDir
      }
  })

const browserSessionFromState = (
  projectId: string,
  containerName: string,
  state: BrowserContainerState,
  externalOrigin: string
): ProjectBrowserSession => {
  const noVncPath = renderProjectBrowserNoVncPath(projectId)
  const cdpPath = renderProjectBrowserCdpPath(projectId)
  return {
    cdpPath,
    cdpUrl: renderExternalUrl(externalOrigin, cdpPath),
    containerName,
    noVncPath,
    noVncUrl: renderExternalUrl(externalOrigin, noVncPath),
    projectId,
    projectKey: projectShortKey(projectId),
    status: state.status
  }
}

export const readProjectBrowserSession = (
  projectId: string,
  externalOrigin: string
): Effect.Effect<ProjectBrowserSession, BrowserApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(getProjectItemById(projectId))
    const containerName = browserContainerName(project.containerName)
    const state = yield* _(inspectBrowserContainerState(project.projectDir, containerName))
    return browserSessionFromState(projectId, containerName, state, externalOrigin)
  })

const copyProxyRequestHeaders = (
  request: HttpServerRequest.HttpServerRequest,
  target: ProjectBrowserProxyPath,
  proxyPath: string
): Headers => {
  const headers = new Headers()
  for (const [key, value] of Object.entries(request.headers)) {
    const normalized = key.toLowerCase()
    if (typeof value === "string" && !hopByHopRequestHeaders.has(normalized)) {
      headers.set(key, value)
    }
  }
  headers.set("accept-encoding", "identity")
  headers.set("x-forwarded-prefix", proxyPath)
  if (target._tag === "Cdp") {
    headers.set("host", cdpHostHeader)
  } else if (typeof request.headers["host"] === "string") {
    headers.set("x-forwarded-host", request.headers["host"])
  }
  return headers
}

const copyProxyResponseHeaders = (
  response: Response,
  proxyPath: string,
  upstreamOrigin: string,
  externalPrefix: string
): Record<string, string> => {
  const headers: Record<string, string> = {}
  for (const [key, value] of response.headers.entries()) {
    const normalized = key.toLowerCase()
    if (!hopByHopResponseHeaders.has(normalized)) {
      headers[key] = normalized === "location"
        ? rewriteProxyLocation(value, proxyPath, upstreamOrigin, externalPrefix)
        : value
    }
  }
  headers["cache-control"] = headers["cache-control"] ?? "no-store"
  return headers
}

const hasRequestBody = (method: string): boolean => method !== "GET" && method !== "HEAD"

const resolveBrowserProxyUpstream = (
  target: ProjectBrowserProxyPath,
  requestUrl: string
): Effect.Effect<BrowserProxyUpstream, BrowserApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const project = yield* _(resolveProjectByKey(target.projectKey))
    const containerName = browserContainerName(project.containerName)
    const state = yield* _(inspectBrowserContainerState(project.projectDir, containerName))
    if (state.status !== "running") {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: `Browser container is not running: ${containerName}` })))
    }
    const ipAddress = yield* _(ensureBrowserReachableIp(project.projectDir, containerName, project.containerName))
    const port = target._tag === "Cdp" ? browserCdpPort : browserNoVncPort
    const proxyPath = target._tag === "Cdp"
      ? `/b/${target.projectKey}/cdp/`
      : `/b/${target.projectKey}/`
    const search = new URL(requestUrl, "http://localhost").search
    const upstreamUrl = new URL(`${target.upstreamPath}${search}`, `http://${ipAddress}:${port}`)
    return {
      headers: target._tag === "Cdp" ? { host: cdpHostHeader } : {},
      projectId: project.projectId,
      projectKey: target.projectKey,
      proxyPath,
      target,
      upstreamOrigin: upstreamUrl.origin,
      upstreamUrl
    }
  })

const fetchBrowserUpstream = (
  request: HttpServerRequest.HttpServerRequest,
  upstream: BrowserProxyUpstream
) =>
  Effect.gen(function*(_) {
    const requestBody = hasRequestBody(request.method)
      ? yield* _(request.arrayBuffer)
      : undefined
    const init = {
      headers: copyProxyRequestHeaders(request, upstream.target, upstream.proxyPath),
      method: request.method,
      redirect: "manual" as const,
      ...(requestBody !== undefined && requestBody.byteLength > 0
        ? { body: new Uint8Array(requestBody) }
        : {})
    }
    return yield* _(
      Effect.tryPromise({
        try: () => fetch(upstream.upstreamUrl, init),
        catch: (cause) =>
          new ApiInternalError({
            message: `Failed to proxy browser ${upstream.target._tag}.`,
            cause
          })
      })
    )
  })

const browserRedirectResponse = (
  projectId: string
): HttpServerResponse.HttpServerResponse =>
  HttpServerResponse.empty({
    headers: {
      "cache-control": "no-store",
      location: renderProjectBrowserNoVncPath(projectId)
    },
    status: 302
  })

const readResponseText = (
  response: Response
) =>
  Effect.tryPromise({
    try: () => response.text(),
    catch: (cause) => new ApiInternalError({ message: "Failed to read browser proxy response.", cause })
  })

const cdpVersionResponse = (
  response: Response,
  upstream: BrowserProxyUpstream,
  externalOrigin: string,
  headers: Record<string, string>
) =>
  readResponseText(response).pipe(
    Effect.map((payload) =>
      HttpServerResponse.setStatus(
        HttpServerResponse.text(
          rewriteCdpVersionPayload(payload, externalOrigin, upstream.projectId),
          { contentType: headers["content-type"] ?? "application/json; charset=utf-8", headers }
        ),
        response.status
      )
    )
  )

export const proxyProjectBrowser = (
  request: HttpServerRequest.HttpServerRequest,
  target: ProjectBrowserProxyPath,
  externalOrigin: string
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  BrowserApiError | HttpServerError.RequestError | PlatformError,
  ListProjectsContext
> =>
  Effect.gen(function*(_) {
    const upstream = yield* _(resolveBrowserProxyUpstream(target, request.url))
    yield* _(Effect.sync(() => touchProjectBrowserActivity(upstream.projectId)))
    if (target._tag === "NoVnc" && target.upstreamPath === "/") {
      return browserRedirectResponse(upstream.projectId)
    }
    const upstreamResponse = yield* _(fetchBrowserUpstream(request, upstream))
    const headers = copyProxyResponseHeaders(
      upstreamResponse,
      upstream.proxyPath,
      upstream.upstreamOrigin,
      normalizeForwardedPrefix(request.headers["x-forwarded-prefix"])
    )
    if (target._tag === "Cdp" && target.upstreamPath === "/json/version" && upstreamResponse.body !== null) {
      return yield* _(cdpVersionResponse(upstreamResponse, upstream, externalOrigin, headers))
    }
    if (request.method === "HEAD" || upstreamResponse.body === null) {
      return HttpServerResponse.empty({ headers, status: upstreamResponse.status })
    }
    return HttpServerResponse.stream(
      Stream.fromReadableStream(
        () => upstreamResponse.body as ReadableStream<Uint8Array>,
        (cause) => new ApiInternalError({ message: "Failed to read browser proxy body.", cause })
      ),
      {
        headers,
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText
      }
    )
  })

const resolveBrowserWebSocketUpstream = (
  request: IncomingMessage
): Effect.Effect<BrowserWebSocketUpstream | null, BrowserApiError | PlatformError, ListProjectsContext> => {
  const url = request.url
  if (url === undefined) {
    return Effect.succeed(null)
  }
  const parsed = new URL(url, "http://localhost")
  const target = parseProjectBrowserProxyPath(parsed.pathname)
  if (target === null) {
    return Effect.succeed(null)
  }
  if (target._tag === "NoVnc" && target.upstreamPath !== "/websockify") {
    return Effect.succeed(null)
  }
  return resolveBrowserProxyUpstream(target, url).pipe(
    Effect.map((upstream) => {
      if (target._tag === "NoVnc") {
        return {
          _tag: "Tcp" as const,
          host: upstream.upstreamUrl.hostname,
          port: browserVncPort,
          projectId: upstream.projectId
        }
      }
      const wsUrl = new URL(upstream.upstreamUrl.toString())
      wsUrl.protocol = "ws:"
      return {
        _tag: "WebSocket" as const,
        headers: upstream.headers,
        projectId: upstream.projectId,
        url: wsUrl.toString()
      }
    })
  )
}

const denyUpgrade = (socket: Duplex): void => {
  socket.write("HTTP/1.1 404 Not Found\r\n\r\n")
  socket.destroy()
}

const firstHeader = (value: string | ReadonlyArray<string> | undefined): string | undefined =>
  typeof value === "string" ? value : value?.[0]

const parseWebSocketProtocols = (request: IncomingMessage): Array<string> => {
  const header = firstHeader(request.headers["sec-websocket-protocol"])
  if (header === undefined) {
    return []
  }
  return header
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

const connectUpstreamWebSocket = (
  request: IncomingMessage,
  target: Extract<BrowserWebSocketUpstream, { readonly _tag: "WebSocket" }>
): WebSocket => {
  const protocols = parseWebSocketProtocols(request)
  const options = { headers: target.headers }
  return protocols.length === 0
    ? new WebSocket(target.url, options)
    : new WebSocket(target.url, protocols, options)
}

const rawDataToBuffer = (data: RawData): Buffer =>
  Array.isArray(data)
    ? Buffer.concat(data)
    : Buffer.isBuffer(data)
      ? data
      : Buffer.from(data)

const bridgeSocketToTcp = (
  clientSocket: WebSocket,
  upstream: Socket
): void => {
  const pending: Array<Buffer> = []
  const writeWhenOpen = (data: Buffer): void => {
    if (upstream.readyState === "open") {
      upstream.write(data)
      return
    }
    pending.push(data)
  }
  const flushPending = (): void => {
    for (const message of pending.splice(0)) {
      upstream.write(message)
    }
  }
  clientSocket.on("message", (data) => {
    writeWhenOpen(rawDataToBuffer(data))
  })
  upstream.on("connect", flushPending)
  upstream.on("data", (data) => {
    if (clientSocket.readyState === WebSocket.OPEN) {
      clientSocket.send(data, { binary: true })
    }
  })
  clientSocket.on("close", () => {
    upstream.destroy()
  })
  upstream.on("close", () => {
    clientSocket.close()
  })
  upstream.on("error", () => {
    clientSocket.close()
  })
}

const bridgeSockets = (
  clientSocket: WebSocket,
  upstream: WebSocket
): void => {
  const pending: Array<PendingWebSocketMessage> = []
  const sendWhenOpen = (socket: WebSocket, data: RawData, isBinary: boolean): void => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(data, { binary: isBinary })
    }
  }
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
  upstream.on("message", (data, isBinary) => {
    sendWhenOpen(clientSocket, data, isBinary)
  })
  upstream.on("open", () => {
    flushPending()
  })
  clientSocket.on("close", () => {
    upstream.close()
  })
  upstream.on("close", () => {
    clientSocket.close()
  })
  upstream.on("error", () => {
    clientSocket.close()
  })
}

const connectBrowserWebSocket = (
  webSocketServer: WebSocketServer,
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
  target: BrowserWebSocketUpstream
): void => {
  webSocketServer.handleUpgrade(request, socket, head, (clientSocket) => {
    incrementBrowserWebSocket(target.projectId)
    clientSocket.on("close", () => {
      decrementBrowserWebSocket(target.projectId)
    })
    if (target._tag === "Tcp") {
      const upstream = createConnection({ host: target.host, port: target.port })
      bridgeSocketToTcp(clientSocket, upstream)
      return
    }
    const upstream = connectUpstreamWebSocket(request, target)
    upstream.on("error", () => {
      clientSocket.close()
    })
    upstream.on("close", () => {
      clientSocket.close()
    })
    try {
      bridgeSockets(clientSocket, upstream)
    } catch {
      clientSocket.close()
      upstream.close()
    }
  })
}

export const hasLiveProjectBrowserSession = (projectId: string): boolean =>
  (browserWebSocketCounts.get(projectId) ?? 0) > 0

export const attachProjectBrowserWebSocketServer = (server: HttpServer): void => {
  const webSocketServer = new WebSocketServer({ noServer: true })
  server.on("upgrade", (request, socket, head) => {
    const parsed = new URL(request.url ?? "/", "http://localhost")
    if (parseProjectBrowserProxyPath(parsed.pathname) === null) {
      return
    }
    Effect.runFork(
      resolveBrowserWebSocketUpstream(request).pipe(
        Effect.provide(NodeContext.layer),
        Effect.match({
          onFailure: () => {
            denyUpgrade(socket)
          },
          onSuccess: (target) => {
            if (target === null) {
              denyUpgrade(socket)
              return
            }
            connectBrowserWebSocket(webSocketServer, request, socket, head, target)
          }
        })
      )
    )
  })
}

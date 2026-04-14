import { existsSync, readFileSync } from "node:fs"

import * as HttpServerRequest from "@effect/platform/HttpServerRequest"
import * as HttpServerError from "@effect/platform/HttpServerError"
import * as HttpServerResponse from "@effect/platform/HttpServerResponse"
import type { PlatformError } from "@effect/platform/Error"
import type { ListProjectsContext } from "@effect-template/lib/usecases/projects-list"
import { Effect } from "effect"
import * as Stream from "effect/Stream"

import { ApiBadRequestError, ApiConflictError, ApiInternalError, ApiNotFoundError } from "../api/errors.js"
import { listProjectPortForwards } from "./project-port-forwards.js"
import { listProjects } from "./projects.js"
import {
  normalizeForwardedPrefix,
  parseLinuxDefaultGatewayIp,
  projectShortKey,
  type ProjectPortProxyPath,
  renderForwardProxyPath,
  rewriteProxyLocation
} from "./project-port-proxy-core.js"

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

const hasRequestBody = (method: string): boolean => method !== "GET" && method !== "HEAD"

const readRouteGateway = (): string | null => {
  try {
    return parseLinuxDefaultGatewayIp(readFileSync("/proc/net/route", "utf8"))
  } catch {
    return null
  }
}

const defaultProxyHost = (): string =>
  existsSync("/.dockerenv") ? readRouteGateway() ?? "172.17.0.1" : "127.0.0.1"

const portProxyHostFromEnv = (): string =>
  process.env["DOCKER_GIT_PORT_PROXY_HOST"]?.trim() || defaultProxyHost()

const copyProxyRequestHeaders = (
  request: HttpServerRequest.HttpServerRequest,
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
  const host = request.headers["host"]
  if (typeof host === "string") {
    headers.set("x-forwarded-host", host)
  }
  headers.set("x-forwarded-prefix", proxyPath)
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

const fetchUpstream = (
  request: HttpServerRequest.HttpServerRequest,
  target: ProjectPortProxyPath,
  upstreamUrl: URL,
  proxyPath: string
) =>
  Effect.gen(function*(_) {
    const requestBody = hasRequestBody(request.method)
      ? yield* _(request.arrayBuffer)
      : undefined
    const init = {
      headers: copyProxyRequestHeaders(request, proxyPath),
      method: request.method,
      redirect: "manual" as const,
      ...(requestBody !== undefined && requestBody.byteLength > 0
        ? { body: new Uint8Array(requestBody) }
        : {})
    }
    return yield* _(
      Effect.tryPromise({
        try: () =>
          fetch(upstreamUrl, init),
        catch: (cause) =>
          new ApiInternalError({
            message: `Failed to proxy project port ${target.targetPort}.`,
            cause
          })
      })
    )
  })

const resolveProxyProjectId = (
  target: ProjectPortProxyPath
): Effect.Effect<string, ApiConflictError | ApiNotFoundError, ListProjectsContext> => {
  if (target._tag === "ProjectId") {
    return Effect.succeed(target.projectId)
  }

  return Effect.gen(function*(_) {
    const projects = yield* _(listProjects())
    const matches = projects.filter((project) => projectShortKey(project.id) === target.projectKey)
    if (matches.length === 0) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${target.projectKey}` })))
    }
    if (matches.length > 1) {
      return yield* _(Effect.fail(new ApiConflictError({ message: `Project key is ambiguous: ${target.projectKey}` })))
    }
    return matches[0]!.id
  })
}

export const proxyProjectPortForward = (
  request: HttpServerRequest.HttpServerRequest,
  target: ProjectPortProxyPath
): Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  | ApiBadRequestError
  | ApiConflictError
  | ApiInternalError
  | ApiNotFoundError
  | HttpServerError.RequestError
  | PlatformError,
  ListProjectsContext
> =>
  Effect.gen(function*(_) {
    const projectId = yield* _(resolveProxyProjectId(target))
    const forwards = yield* _(listProjectPortForwards(projectId))
    const forward = forwards.find((item) => item.targetPort === target.targetPort)
    if (forward === undefined) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Port forward not found: ${target.targetPort}` })))
    }
    if (forward.status !== "running") {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: `Port forward is not running: ${target.targetPort}` })))
    }

    const search = new URL(request.url, "http://localhost").search
    const upstreamUrl = new URL(`${target.upstreamPath}${search}`, `http://${portProxyHostFromEnv()}:${forward.hostPort}`)
    const proxyPath = renderForwardProxyPath(projectId, target.targetPort)
    const upstreamResponse = yield* _(fetchUpstream(request, target, upstreamUrl, proxyPath))
    const headers = copyProxyResponseHeaders(
      upstreamResponse,
      proxyPath,
      upstreamUrl.origin,
      normalizeForwardedPrefix(request.headers["x-forwarded-prefix"])
    )

    if (request.method === "HEAD" || upstreamResponse.body === null) {
      return HttpServerResponse.empty({ headers, status: upstreamResponse.status })
    }

    return HttpServerResponse.stream(
      Stream.fromReadableStream(
        () => upstreamResponse.body as ReadableStream<Uint8Array>,
        (cause) => new ApiInternalError({ message: "Failed to read proxied response body.", cause })
      ),
      {
        headers,
        status: upstreamResponse.status,
        statusText: upstreamResponse.statusText
      }
    )
  })

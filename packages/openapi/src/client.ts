import * as ParseResult from "@effect/schema/ParseResult"
import type * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { createClientEffect } from "@prover-coder-ai/openapi-effect"
import type { BoundaryError, ClientOptions, Middleware } from "@prover-coder-ai/openapi-effect"
import { Effect, Either, Match } from "effect"

import type { paths } from "./openapi-paths.js"

type DockerGitOpenApiTransportClient = ReturnType<typeof createClientEffect<paths>>

type DockerGitOpenApiMiddleware = Middleware

export type ApiTransportValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<ApiTransportValue>
  | { readonly [key: string]: ApiTransportValue }

type OpenApiSuccess = {
  readonly status: number | string
  readonly contentType: string
  readonly body: unknown
}

type OpenApiHttpError = OpenApiSuccess & {
  readonly _tag: "HttpError"
}

type OpenApiFailure = OpenApiHttpError | BoundaryError

type OpenApiRequestResult = Effect.Effect<OpenApiSuccess, OpenApiFailure>

type OpenApiRequest = (client: DockerGitOpenApiTransportClient) => OpenApiRequestResult

export type DockerGitOpenApiClientOptions = {
  readonly fetch?: ClientOptions["fetch"]
  readonly resolveBaseUrl: () => string
}

export type DockerGitOpenApiClient = {
  readonly openApiJsonSchema: <A, I>(
    schema: Schema.Schema<A, I>,
    request: OpenApiRequest
  ) => Effect.Effect<A, string>
  readonly openApiVoid: (request: OpenApiRequest) => Effect.Effect<void, string>
}

type RunOpenApi = (request: OpenApiRequest) => Effect.Effect<OpenApiSuccess, OpenApiFailure>

const noCacheHeaders: Readonly<Record<string, string>> = {
  accept: "application/json",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache"
}

const stringifyJson = (value: unknown): Effect.Effect<string, null> =>
  Effect.try({
    try: () => JSON.stringify(value, null, 2),
    catch: () => null
  })

const safeJson = (value: unknown): Effect.Effect<string> =>
  stringifyJson(value).pipe(
    Effect.orElseSucceed(() => "unrenderable response payload")
  )

const renderTransportValue = (value: unknown): Effect.Effect<string> => {
  if (typeof value === "string") {
    return Effect.succeed(value)
  }
  if (typeof value === "object" && value !== null && "message" in value) {
    const message = value["message"]
    if (typeof message === "string") {
      return Effect.succeed(message)
    }
  }
  return safeJson(value)
}

const isApiTransportValue = (value: unknown): value is ApiTransportValue => {
  if (
    value === undefined
    || value === null
    || typeof value === "boolean"
    || typeof value === "number"
    || typeof value === "string"
  ) {
    return true
  }
  if (Array.isArray(value)) {
    return value.every(isApiTransportValue)
  }
  if (typeof value !== "object") {
    return false
  }
  return Object.values(value).every(isApiTransportValue)
}

const decodeTransportValue = (value: unknown): Effect.Effect<ApiTransportValue, string> =>
  isApiTransportValue(value)
    ? Effect.succeed(value)
    : renderTransportValue(value).pipe(
      Effect.flatMap((rendered) => Effect.fail(`Invalid JSON response payload: ${rendered}`))
    )

const renderOpenApiHttpError = (
  error: OpenApiHttpError
): Effect.Effect<string> => {
  if (String(error.status) === "429") {
    return Effect.succeed("HTTP 429: tunnel or proxy rate limited the request. Retry or request a fresh tunnel URL.")
  }
  return error.body === undefined ? Effect.succeed(`HTTP ${error.status}`) : renderTransportValue(error.body)
}

const noCacheGetMiddleware: DockerGitOpenApiMiddleware = {
  onRequest: ({ request }) => {
    if (request.method !== "GET") {
      return
    }
    const url = new URL(request.url)
    url.searchParams.set("_", String(Date.now()))
    return new Request(url, request)
  }
}

/**
 * Creates a typed openapi-effect transport client for the docker-git JSON REST API.
 *
 * @param baseUrl - Absolute API base URL.
 * @param fetch - Optional fetch implementation for tests or custom runtimes.
 * @returns Typed Effect OpenAPI transport client with no-cache headers and GET cache-busting middleware.
 *
 * @pure false - constructs a browser/Fetch API HTTP client adapter.
 * @effect none - client construction only; returned methods describe network IO as Effect.
 * @invariant client paths are constrained by generated DockerGit OpenAPI paths.
 * @precondition baseUrl points at a docker-git API server or compatible proxy.
 * @postcondition returned client sends no-cache headers on JSON requests.
 * @complexity O(1)/O(1)
 * @throws Never.
 */
const createTransportClient = (
  baseUrl: string,
  fetch?: ClientOptions["fetch"]
): DockerGitOpenApiTransportClient => {
  const clientOptions: ClientOptions = fetch === undefined
    ? {
      baseUrl,
      headers: noCacheHeaders
    }
    : {
      baseUrl,
      fetch,
      headers: noCacheHeaders
    }
  const client = createClientEffect<paths>(clientOptions)
  client.use(noCacheGetMiddleware)
  return client
}

const renderOpenApiFailure = (failure: OpenApiFailure): Effect.Effect<string> =>
  Match.value(failure).pipe(
    Match.when({ _tag: "HttpError" }, renderOpenApiHttpError),
    Match.when({ _tag: "TransportError" }, (error) => Effect.succeed(error.error.message)),
    Match.when({ _tag: "UnexpectedStatus" }, (error) => Effect.succeed(`HTTP ${error.status}: ${error.body}`)),
    Match.when({ _tag: "UnexpectedContentType" }, (error) =>
      Effect.succeed(`HTTP ${error.status}: unexpected content type ${error.actual ?? "none"}: ${error.body}`)
    ),
    Match.when({ _tag: "ParseError" }, (error) =>
      Effect.succeed(`HTTP ${error.status}: invalid ${error.contentType} response: ${error.error.message}`)
    ),
    Match.when({ _tag: "DecodeError" }, (error) =>
      Effect.succeed(`HTTP ${error.status}: invalid decoded response: ${error.error.message}`)
    ),
    Match.exhaustive
  )

const failRenderedOpenApiFailure = (failure: OpenApiFailure): Effect.Effect<never, string> =>
  renderOpenApiFailure(failure).pipe(
    Effect.flatMap((message) => Effect.fail(message))
  )

const openApiJsonWithRunner = (
  runner: RunOpenApi,
  request: OpenApiRequest
): Effect.Effect<ApiTransportValue, string> =>
  runner(request).pipe(
    Effect.catchAll(failRenderedOpenApiFailure),
    Effect.flatMap((success) =>
      success.body === undefined
        ? Effect.fail(`HTTP ${success.status}: empty response`)
        : decodeTransportValue(success.body)
    )
  )

const decodeSchema = <A, I>(schema: Schema.Schema<A, I>, value: unknown): Effect.Effect<A, string> =>
  Either.match(ParseResult.decodeUnknownEither(schema)(value), {
    onLeft: (error) => Effect.fail(TreeFormatter.formatIssueSync(error)),
    onRight: (decoded) => Effect.succeed(decoded)
  })

const openApiJsonSchemaWithRunner = <A, I>(
  runner: RunOpenApi,
  schema: Schema.Schema<A, I>,
  request: OpenApiRequest
): Effect.Effect<A, string> =>
  openApiJsonWithRunner(runner, request).pipe(
    Effect.flatMap((data) => decodeSchema(schema, data))
  )

const openApiVoidWithRunner = (
  runner: RunOpenApi,
  request: OpenApiRequest
): Effect.Effect<void, string> =>
  runner(request).pipe(
    Effect.asVoid,
    Effect.catchAll(failRenderedOpenApiFailure)
  )

/**
 * Creates a reusable Effect OpenAPI client backed by a base URL resolver.
 *
 * @param options - Client configuration containing a base URL resolver.
 * @returns OpenAPI client with a baseUrl-keyed transport cache.
 *
 * @pure false - closes over mutable client cache for client reuse in a shell boundary.
 * @effect none during construction; returned helpers perform HTTP IO when their Effects run.
 * @invariant cache is keyed only by resolved baseUrl and invalidated on baseUrl change.
 * @precondition resolveBaseUrl is deterministic for the duration of a single request Effect.
 * @postcondition consumers can share one configured OpenAPI client without importing transport details.
 * @complexity O(1)/O(1) for client lookup, excluding request execution.
 * @throws Never.
 */
export const createClient = (
  options: DockerGitOpenApiClientOptions
): DockerGitOpenApiClient => {
  const clientCache: {
    baseUrl: string | null
    client: DockerGitOpenApiTransportClient | null
  } = {
    baseUrl: null,
    client: null
  }

  const getOpenApiClient = (): DockerGitOpenApiTransportClient => {
    const baseUrl = options.resolveBaseUrl()
    if (clientCache.client === null || clientCache.baseUrl !== baseUrl) {
      clientCache.baseUrl = baseUrl
      clientCache.client = createTransportClient(baseUrl, options.fetch)
    }
    return clientCache.client
  }

  const runRuntimeOpenApi = (request: OpenApiRequest): Effect.Effect<OpenApiSuccess, OpenApiFailure> =>
    request(getOpenApiClient())

  return {
    openApiJsonSchema: (schema, request) => openApiJsonSchemaWithRunner(runRuntimeOpenApi, schema, request),
    openApiVoid: (request) => openApiVoidWithRunner(runRuntimeOpenApi, request)
  }
}

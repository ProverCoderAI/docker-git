import * as ParseResult from "@effect/schema/ParseResult"
import type * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { createClientEffect } from "@prover-coder-ai/openapi-effect"
import type { ClientOptions, Middleware } from "@prover-coder-ai/openapi-effect"
import { Effect, Either, Option } from "effect"

import type { paths } from "./openapi-paths.js"

export type DockerGitOpenApiTransportClient = ReturnType<typeof createClientEffect<paths>>

type DockerGitOpenApiMiddleware = Middleware

export type ApiTransportValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<ApiTransportValue>
  | { readonly [key: string]: ApiTransportValue }

export type OpenApiResponse<A> = {
  readonly data?: A
  readonly error?: unknown
  readonly response: Response
}

export type OpenApiRequestResult = Effect.Effect<OpenApiResponse<unknown>, Error>

export type OpenApiRequest = (client: DockerGitOpenApiTransportClient) => OpenApiRequestResult

export type DockerGitOpenApiClientOptions = {
  readonly fetch?: ClientOptions["fetch"]
  readonly resolveBaseUrl: () => string
}

export type DockerGitOpenApiClient = {
  readonly openApiJson: (request: OpenApiRequest) => Effect.Effect<ApiTransportValue, string>
  readonly openApiJsonSchema: <A, I>(
    schema: Schema.Schema<A, I>,
    request: OpenApiRequest
  ) => Effect.Effect<A, string>
  readonly openApiVoid: (request: OpenApiRequest) => Effect.Effect<void, string>
}

type RunOpenApi = (request: OpenApiRequest) => Effect.Effect<OpenApiResponse<unknown>, string>

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

const renderOpenApiError = (
  response: Response,
  error: unknown
): Effect.Effect<string> => {
  if (response.status === 429) {
    return Effect.succeed("HTTP 429: tunnel or proxy rate limited the request. Retry or request a fresh tunnel URL.")
  }
  return error === undefined ? Effect.succeed(`HTTP ${response.status}`) : renderTransportValue(error)
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
export const createTransportClient = (
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

/**
 * Runs a typed OpenAPI request with a provided client through Effect.
 *
 * @param client - Typed docker-git OpenAPI transport client.
 * @param request - Deferred openapi-effect request.
 * @returns Effect containing raw transport response data or a string failure.
 *
 * @pure false - executes an Effect-producing openapi-effect request when the Effect is run.
 * @effect Network request represented directly as Effect.
 * @invariant no Promise interop is required at this boundary.
 * @precondition request was built against the same generated OpenAPI path map as client.
 * @postcondition transport failures are represented in the Effect error channel.
 * @complexity O(1)/O(1) excluding network and response body costs.
 * @throws Never.
 */
export const runOpenApi = (
  client: DockerGitOpenApiTransportClient,
  request: OpenApiRequest
): Effect.Effect<OpenApiResponse<unknown>, string> =>
  request(client).pipe(
    Effect.mapError(String)
  )

const failRenderedOpenApiError = (
  response: Response,
  error: unknown
): Effect.Effect<never, string> =>
  renderOpenApiError(response, error).pipe(
    Effect.flatMap((message) => Effect.fail(message))
  )

const openApiJsonWithRunner = (
  runner: RunOpenApi,
  request: OpenApiRequest
): Effect.Effect<ApiTransportValue, string> =>
  runner(request).pipe(
    Effect.flatMap(({ data, error, response }) =>
      Option.match(Option.fromNullable(error), {
        onNone: () =>
          response.ok
            ? data === undefined
              ? Effect.fail(`HTTP ${response.status}: empty response`)
              : decodeTransportValue(data)
            : failRenderedOpenApiError(response, error),
        onSome: (apiError) => failRenderedOpenApiError(response, apiError)
      })
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
    Effect.flatMap(({ error, response }) =>
      response.ok
        ? Option.match(Option.fromNullable(error), {
          onNone: () => Effect.void,
          onSome: (apiError) => failRenderedOpenApiError(response, apiError)
        })
        : failRenderedOpenApiError(response, error)
    )
  )

/**
 * Executes a typed OpenAPI JSON request through a provided client.
 *
 * @param client - Typed docker-git OpenAPI transport client.
 * @param request - Deferred typed openapi-effect request.
 * @returns Effect containing raw 2xx response data or a rendered API error.
 *
 * @pure false - performs browser HTTP IO when the Effect is run.
 * @effect Network request via openapi-effect.
 * @invariant request execution remains Effect-native at this boundary.
 * @precondition request uses a static path from generated OpenAPI paths.
 * @postcondition successful Effect contains only the 2xx data branch as a transport value.
 * @complexity O(n) local response rendering where n is the error payload size.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiJson = (
  client: DockerGitOpenApiTransportClient,
  request: OpenApiRequest
): Effect.Effect<ApiTransportValue, string> =>
  openApiJsonWithRunner((nextRequest) => runOpenApi(client, nextRequest), request)

/**
 * Executes a typed OpenAPI request and decodes the data with an Effect Schema.
 *
 * @param client - Typed docker-git OpenAPI transport client.
 * @param schema - Boundary decoder preserving the consumer DTO type.
 * @param request - Deferred typed openapi-effect request.
 * @returns Effect containing schema-decoded response data.
 *
 * @pure false - performs browser HTTP IO and boundary decoding when the Effect is run.
 * @effect openapi-effect request plus synchronous Effect Schema decoding.
 * @invariant transport typing comes from OpenAPI; exported data typing comes from Schema.
 * @precondition schema matches the endpoint success response documented in DockerGitApi.
 * @postcondition no generated optional/default representation leaks into existing consumers.
 * @complexity O(n) where n is the decoded response size.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiJsonSchema = <A, I>(
  client: DockerGitOpenApiTransportClient,
  schema: Schema.Schema<A, I>,
  request: OpenApiRequest
): Effect.Effect<A, string> =>
  openApiJsonSchemaWithRunner((nextRequest) => runOpenApi(client, nextRequest), schema, request)

/**
 * Executes a typed OpenAPI request whose successful response has no body.
 *
 * @param client - Typed docker-git OpenAPI transport client.
 * @param request - Deferred typed openapi-effect request.
 * @returns Effect that succeeds with void for successful empty responses.
 *
 * @pure false - performs browser HTTP IO when the Effect is run.
 * @effect Network request via openapi-effect.
 * @invariant only response status determines success for empty endpoints.
 * @precondition request targets an endpoint whose OpenAPI success response has no content.
 * @postcondition successful Effect returns void and never exposes transport details.
 * @complexity O(n) local response rendering where n is the error payload size.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiVoid = (
  client: DockerGitOpenApiTransportClient,
  request: OpenApiRequest
): Effect.Effect<void, string> =>
  openApiVoidWithRunner((nextRequest) => runOpenApi(client, nextRequest), request)

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

  const runRuntimeOpenApi = (request: OpenApiRequest): Effect.Effect<OpenApiResponse<unknown>, string> =>
    request(getOpenApiClient()).pipe(
      Effect.mapError(String)
    )

  return {
    openApiJson: (request) => openApiJsonWithRunner(runRuntimeOpenApi, request),
    openApiJsonSchema: (schema, request) => openApiJsonSchemaWithRunner(runRuntimeOpenApi, schema, request),
    openApiVoid: (request) => openApiVoidWithRunner(runRuntimeOpenApi, request)
  }
}

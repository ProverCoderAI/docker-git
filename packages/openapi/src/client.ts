import * as ParseResult from "@effect/schema/ParseResult"
import type * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { Effect, Either, Option } from "effect"
import createClient, { type Client, type Middleware } from "openapi-fetch"

import type { paths } from "./openapi-paths.js"

export type DockerGitOpenApiClient = Client<paths>

export type ApiTransportValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<ApiTransportValue>
  | { readonly [key: string]: ApiTransportValue }

export type ApiTransportError = ApiTransportValue | object

export type OpenApiResponse<A> = {
  readonly data?: A
  readonly error?: ApiTransportError
  readonly response: Response
}

export type OpenApiRequestResult = PromiseLike<OpenApiResponse<ApiTransportValue>>

export type OpenApiRequest = (client: DockerGitOpenApiClient) => OpenApiRequestResult

export type DockerGitOpenApiRuntimeOptions = {
  readonly resolveBaseUrl: () => string
}

export type DockerGitOpenApiRuntime = {
  readonly openApiJson: (request: OpenApiRequest) => Effect.Effect<ApiTransportValue, string>
  readonly openApiJsonSchema: <A, I>(
    schema: Schema.Schema<A, I>,
    request: OpenApiRequest
  ) => Effect.Effect<A, string>
  readonly openApiVoid: (request: OpenApiRequest) => Effect.Effect<void, string>
}

type RunOpenApi = (request: OpenApiRequest) => Effect.Effect<OpenApiResponse<ApiTransportValue>, string>

const noCacheHeaders: Readonly<Record<string, string>> = {
  accept: "application/json",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache"
}

const stringifyJson = (value: ApiTransportError): Effect.Effect<string, null> =>
  Effect.try({
    try: () => JSON.stringify(value, null, 2),
    catch: () => null
  })

const safeJson = (value: ApiTransportError): Effect.Effect<string> =>
  stringifyJson(value).pipe(
    Effect.orElseSucceed(() => "unrenderable response payload")
  )

const renderTransportValue = (value: ApiTransportError): Effect.Effect<string> => {
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

const renderOpenApiError = (
  response: Response,
  error: ApiTransportError | undefined
): Effect.Effect<string> => {
  if (response.status === 429) {
    return Effect.succeed("HTTP 429: tunnel or proxy rate limited the request. Retry or request a fresh tunnel URL.")
  }
  return error === undefined ? Effect.succeed(`HTTP ${response.status}`) : renderTransportValue(error)
}

const noCacheGetMiddleware: Middleware = {
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
 * Creates a typed openapi-fetch client for the docker-git JSON REST API.
 *
 * @param baseUrl - Absolute API base URL.
 * @returns Typed OpenAPI client with no-cache headers and GET cache-busting middleware.
 *
 * @pure false - constructs a browser/Fetch API HTTP client adapter.
 * @effect none - client construction only; network IO happens when request methods are executed.
 * @invariant client paths are constrained by generated DockerGit OpenAPI paths.
 * @precondition baseUrl points at a docker-git API server or compatible proxy.
 * @postcondition returned client sends no-cache headers on JSON requests.
 * @complexity O(1)/O(1)
 * @throws Never.
 */
export const createDockerGitOpenApiClient = (baseUrl: string): DockerGitOpenApiClient => {
  const client = createClient<paths>({
    baseUrl,
    headers: noCacheHeaders
  })
  client.use(noCacheGetMiddleware)
  return client
}

/**
 * Runs a typed OpenAPI request with a provided client through Effect.
 *
 * @param client - Typed docker-git OpenAPI client.
 * @param request - Deferred openapi-fetch request.
 * @returns Effect containing raw transport response data or a string failure.
 *
 * @pure false - executes Promise-producing openapi-fetch request when the Effect is run.
 * @effect Promise interop isolated through Effect.tryPromise.
 * @invariant no Promise escapes the function boundary.
 * @precondition request was built against the same generated OpenAPI path map as client.
 * @postcondition transport failures are represented in the Effect error channel.
 * @complexity O(1)/O(1) excluding network and response body costs.
 * @throws Never.
 */
export const runOpenApi = (
  client: DockerGitOpenApiClient,
  request: OpenApiRequest
): Effect.Effect<OpenApiResponse<ApiTransportValue>, string> =>
  Effect.tryPromise({
    try: () => request(client),
    catch: String
  })

const failRenderedOpenApiError = (
  response: Response,
  error: ApiTransportError | undefined
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
            ? Option.match(Option.fromNullable(data), {
              onNone: () => Effect.fail(`HTTP ${response.status}: empty response`),
              onSome: (value) => Effect.succeed(value)
            })
            : failRenderedOpenApiError(response, error),
        onSome: (apiError) => failRenderedOpenApiError(response, apiError)
      })
    )
  )

const decodeSchema = <A, I>(schema: Schema.Schema<A, I>, value: ApiTransportValue): Effect.Effect<A, string> =>
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
 * @param client - Typed docker-git OpenAPI client.
 * @param request - Deferred typed openapi-fetch request.
 * @returns Effect containing raw 2xx response data or a rendered API error.
 *
 * @pure false - performs browser HTTP IO when the Effect is run.
 * @effect Network request via openapi-fetch wrapped by Effect.tryPromise.
 * @invariant Promise interop is isolated inside this boundary.
 * @precondition request uses a static path from generated OpenAPI paths.
 * @postcondition successful Effect contains only the 2xx data branch as a transport value.
 * @complexity O(n) local response rendering where n is the error payload size.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiJson = (
  client: DockerGitOpenApiClient,
  request: OpenApiRequest
): Effect.Effect<ApiTransportValue, string> =>
  openApiJsonWithRunner((nextRequest) => runOpenApi(client, nextRequest), request)

/**
 * Executes a typed OpenAPI request and decodes the data with an Effect Schema.
 *
 * @param client - Typed docker-git OpenAPI client.
 * @param schema - Boundary decoder preserving the consumer DTO type.
 * @param request - Deferred typed openapi-fetch request.
 * @returns Effect containing schema-decoded response data.
 *
 * @pure false - performs browser HTTP IO and boundary decoding when the Effect is run.
 * @effect openapi-fetch request plus synchronous Effect Schema decoding.
 * @invariant transport typing comes from OpenAPI; exported data typing comes from Schema.
 * @precondition schema matches the endpoint success response documented in DockerGitApi.
 * @postcondition no generated optional/default representation leaks into existing consumers.
 * @complexity O(n) where n is the decoded response size.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiJsonSchema = <A, I>(
  client: DockerGitOpenApiClient,
  schema: Schema.Schema<A, I>,
  request: OpenApiRequest
): Effect.Effect<A, string> =>
  openApiJsonSchemaWithRunner((nextRequest) => runOpenApi(client, nextRequest), schema, request)

/**
 * Executes a typed OpenAPI request whose successful response has no body.
 *
 * @param client - Typed docker-git OpenAPI client.
 * @param request - Deferred typed openapi-fetch request.
 * @returns Effect that succeeds with void for successful empty responses.
 *
 * @pure false - performs browser HTTP IO when the Effect is run.
 * @effect Network request via openapi-fetch wrapped by Effect.tryPromise.
 * @invariant only response status determines success for empty endpoints.
 * @precondition request targets an endpoint whose OpenAPI success response has no content.
 * @postcondition successful Effect returns void and never exposes transport details.
 * @complexity O(n) local response rendering where n is the error payload size.
 * @throws Never; failures are returned in the Effect error channel.
 */
export const openApiVoid = (
  client: DockerGitOpenApiClient,
  request: OpenApiRequest
): Effect.Effect<void, string> =>
  openApiVoidWithRunner((nextRequest) => runOpenApi(client, nextRequest), request)

/**
 * Creates reusable Effect helpers backed by a base URL resolver.
 *
 * @param options - Runtime configuration containing a base URL resolver.
 * @returns OpenAPI helper set with a baseUrl-keyed client cache.
 *
 * @pure false - closes over mutable client cache for client reuse in a shell boundary.
 * @effect none during construction; returned helpers perform HTTP IO when their Effects run.
 * @invariant cache is keyed only by resolved baseUrl and invalidated on baseUrl change.
 * @precondition resolveBaseUrl is deterministic for the duration of a single request Effect.
 * @postcondition consumers can share OpenAPI helpers without importing app-specific base URL logic.
 * @complexity O(1)/O(1) for client lookup, excluding request execution.
 * @throws Never.
 */
export const makeDockerGitOpenApiRuntime = (
  options: DockerGitOpenApiRuntimeOptions
): DockerGitOpenApiRuntime => {
  const clientCache: {
    baseUrl: string | null
    client: DockerGitOpenApiClient | null
  } = {
    baseUrl: null,
    client: null
  }

  const getOpenApiClient = (): DockerGitOpenApiClient => {
    const baseUrl = options.resolveBaseUrl()
    if (clientCache.client === null || clientCache.baseUrl !== baseUrl) {
      clientCache.baseUrl = baseUrl
      clientCache.client = createDockerGitOpenApiClient(baseUrl)
    }
    return clientCache.client
  }

  const runRuntimeOpenApi = (request: OpenApiRequest): Effect.Effect<OpenApiResponse<ApiTransportValue>, string> =>
    Effect.tryPromise({
      try: () => request(getOpenApiClient()),
      catch: String
    })

  return {
    openApiJson: (request) => openApiJsonWithRunner(runRuntimeOpenApi, request),
    openApiJsonSchema: (schema, request) => openApiJsonSchemaWithRunner(runRuntimeOpenApi, schema, request),
    openApiVoid: (request) => openApiVoidWithRunner(runRuntimeOpenApi, request)
  }
}

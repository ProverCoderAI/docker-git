import * as ParseResult from "@effect/schema/ParseResult"
import type * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { Effect, Either, Option } from "effect"
import createClient, { type Client, type Middleware } from "openapi-fetch"

import { resolveApiBaseUrl } from "./api-http.js"
import type { paths } from "./generated/openapi-paths.js"

type DockerGitOpenApiClient = Client<paths>

type ApiTransportValue =
  | undefined
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<ApiTransportValue>
  | { readonly [key: string]: ApiTransportValue }

type ApiTransportError = ApiTransportValue | object

type OpenApiResponse<A> = {
  readonly data?: A
  readonly error?: ApiTransportError
  readonly response: Response
}

type OpenApiRequestResult = PromiseLike<OpenApiResponse<ApiTransportValue>>

type OpenApiRequest = (client: DockerGitOpenApiClient) => OpenApiRequestResult

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

const makeClient = (baseUrl: string): DockerGitOpenApiClient => {
  const client = createClient<paths>({
    baseUrl,
    headers: noCacheHeaders
  })
  client.use(noCacheGetMiddleware)
  return client
}

// PURITY: SHELL
// LIMITATION: mutable cache for client reuse until frontend API helpers are migrated to an Effect Layer.
// MIGRATION: replace this cache with Context.Tag + Layer once UI call sites provide shared dependencies.
// INVARIANT: cache is keyed only by resolved baseUrl and is invalidated on baseUrl change.
// TESTABILITY: tests that exercise client creation must isolate module state or reset the module between cases.
const clientCache: {
  baseUrl: string | null
  client: DockerGitOpenApiClient | null
} = {
  baseUrl: null,
  client: null
}

const getOpenApiClient = (): DockerGitOpenApiClient => {
  const baseUrl = resolveApiBaseUrl()
  if (clientCache.client === null || clientCache.baseUrl !== baseUrl) {
    clientCache.baseUrl = baseUrl
    clientCache.client = makeClient(baseUrl)
  }
  return clientCache.client
}

const runOpenApi = (
  request: OpenApiRequest
): Effect.Effect<OpenApiResponse<ApiTransportValue>, string> =>
  Effect.tryPromise({
    try: () => request(getOpenApiClient()),
    catch: String
  })

const failRenderedOpenApiError = (
  response: Response,
  error: ApiTransportError | undefined
): Effect.Effect<never, string> =>
  renderOpenApiError(response, error).pipe(
    Effect.flatMap((message) => Effect.fail(message))
  )

/**
 * Executes a typed OpenAPI JSON request through openapi-fetch.
 *
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
// CHANGE: route generated OpenAPI client calls through Effect.
// WHY: frontend REST calls must remain composable in the Effect error channel.
// QUOTE(ТЗ): "использовать openapi-fetch на фронте для удобства"
// REF: user-message-2026-06-18-openapi-fetch
// SOURCE: https://openapi-ts.dev/openapi-fetch/
// FORMAT THEOREM: response.ok ∧ data defined -> success(transport data); otherwise -> failure(message).
// PURITY: SHELL
// EFFECT: Effect<ApiTransportValue, string, never>
// INVARIANT: no Promise escapes this module.
// COMPLEXITY: O(n)/O(n) for error rendering, O(1)/O(1) on successful local processing.
export const openApiJson = (
  request: OpenApiRequest
): Effect.Effect<ApiTransportValue, string> =>
  runOpenApi(request).pipe(
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

/**
 * Executes an OpenAPI request and decodes the data with an Effect Schema.
 *
 * @param schema - Boundary decoder preserving the existing frontend DTO type.
 * @param request - Deferred typed openapi-fetch request.
 * @returns Effect containing schema-decoded response data.
 *
 * @pure false - performs browser HTTP IO and boundary decoding when the Effect is run.
 * @effect openapi-fetch request plus synchronous Effect Schema decoding.
 * @invariant transport typing comes from OpenAPI; exported data typing comes from Schema.
 * @precondition schema matches the endpoint success response documented in DockerGitApi.
 * @postcondition no generated optional/default representation leaks into existing UI APIs.
 * @complexity O(n) where n is the decoded response size.
 * @throws Never; failures are returned in the Effect error channel.
 */
// CHANGE: compose generated transport typing with existing Schema DTO boundaries.
// WHY: generated OpenAPI types encode optional/default fields differently than current UI contracts.
// QUOTE(ТЗ): "использовать openapi-fetch на фронте для удобства"
// REF: user-message-2026-06-18-openapi-fetch
// SOURCE: https://openapi-ts.dev/openapi-fetch/
// FORMAT THEOREM: decode(schema, response.data) = success(a) -> exported(a).
// PURITY: SHELL
// EFFECT: Effect<A, string, never>
// INVARIANT: only schema-decoded values leave the API boundary.
// COMPLEXITY: O(n)/O(n)
export const openApiJsonSchema = <A, I>(
  schema: Schema.Schema<A, I>,
  request: OpenApiRequest
): Effect.Effect<A, string> =>
  openApiJson(request).pipe(
    Effect.flatMap((data) => decodeSchema(schema, data))
  )

/**
 * Executes a typed OpenAPI request whose successful response has no body.
 *
 * @param request - Deferred typed openapi-fetch request.
 * @returns Effect that succeeds with void for 2xx/3xx empty responses.
 *
 * @pure false - performs browser HTTP IO when the Effect is run.
 * @effect Network request via openapi-fetch wrapped by Effect.tryPromise.
 * @invariant only response status determines success for empty endpoints.
 * @precondition request targets an endpoint whose OpenAPI success response has no content.
 * @postcondition successful Effect returns void and never exposes transport details.
 * @complexity O(n) local response rendering where n is the error payload size.
 * @throws Never; failures are returned in the Effect error channel.
 */
// CHANGE: provide an Effect wrapper for generated empty-response endpoints.
// WHY: old requestText(...).asVoid call sites need a typed OpenAPI equivalent.
// QUOTE(ТЗ): "использовать openapi-fetch на фронте для удобства"
// REF: user-message-2026-06-18-openapi-fetch
// SOURCE: https://openapi-ts.dev/openapi-fetch/
// FORMAT THEOREM: response.ok -> success(void); !response.ok -> failure(message).
// PURITY: SHELL
// EFFECT: Effect<void, string, never>
// INVARIANT: no Promise escapes this module.
// COMPLEXITY: O(n)/O(n) for error rendering, O(1)/O(1) on successful local processing.
export const openApiVoid = (
  request: OpenApiRequest
): Effect.Effect<void, string> =>
  runOpenApi(request).pipe(
    Effect.flatMap(({ error, response }) =>
      response.ok
        ? Option.match(Option.fromNullable(error), {
          onNone: () => Effect.void,
          onSome: (apiError) => failRenderedOpenApiError(response, apiError)
        })
        : failRenderedOpenApiError(response, error)
    )
  )

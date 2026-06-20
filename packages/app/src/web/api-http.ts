import { FetchHttpClient, HttpBody, HttpClient } from "@effect/platform"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { createClient } from "@prover-coder-ai/docker-git-openapi"
import type { BoundaryError } from "@prover-coder-ai/docker-git-openapi"
import { Effect, Either, Match } from "effect"

import { type JsonRequest, parseResponseBody, renderJsonPayload } from "../docker-git/api-json.js"
import { readHttpResponseTextStream } from "../shared/http-response-stream.js"

const defaultApiBaseUrl = "/api"

type ApiHttpMethod = "GET" | "POST" | "PUT" | "DELETE"

type TextStreamRequest = {
  readonly body: JsonRequest | undefined
  readonly method: ApiHttpMethod
  readonly onChunk: (chunk: string) => void
  readonly path: string
}

type RenderableOpenApiBody = boolean | number | object | string | null | undefined

type RenderableOpenApiHttpError = {
  readonly _tag: "HttpError"
  readonly body: RenderableOpenApiBody
  readonly contentType: string
  readonly status: number | string
}

export type RenderableOpenApiFailure = RenderableOpenApiHttpError | BoundaryError

const noCacheHeaders: Readonly<Record<string, string>> = {
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache"
}

const jsonHeaders: Readonly<Record<string, string>> = {
  accept: "application/json",
  "content-type": "application/json",
  ...noCacheHeaders
}

export const trimTrailingSlash = (value: string): string => {
  let next = value
  while (next.endsWith("/")) {
    next = next.slice(0, -1)
  }
  return next
}

const withNoCacheQuery = (url: string): string => `${url}${url.includes("?") ? "&" : "?"}_=${Date.now()}`

const executeRequest = (
  client: HttpClient.HttpClient,
  method: ApiHttpMethod,
  url: string,
  body?: JsonRequest
) => {
  if (method === "GET") {
    return client.get(withNoCacheQuery(url), {
      headers: {
        accept: "application/json",
        ...noCacheHeaders
      }
    })
  }
  if (method === "DELETE") {
    return client.del(url, { body: toRequestBody(body), headers: jsonHeaders })
  }
  if (method === "PUT") {
    return client.put(url, { body: toRequestBody(body), headers: jsonHeaders })
  }
  return client.post(url, { body: toRequestBody(body), headers: jsonHeaders })
}

const decodeSchema = <A, I>(schema: Schema.Schema<A, I>, value: string): Effect.Effect<A, string> =>
  Either.match(ParseResult.decodeUnknownEither(schema)(value), {
    onLeft: (error) => Effect.fail(TreeFormatter.formatIssueSync(error)),
    onRight: (decoded) => Effect.succeed(decoded)
  })

const readErrorMessage = (status: number, text: string): Effect.Effect<never, string> =>
  status === 429
    ? Effect.fail("HTTP 429: tunnel or proxy rate limited the request. Retry or request a fresh tunnel URL.")
    : parseResponseBody(text).pipe(
      Effect.flatMap((payload) => Effect.fail(payload === null ? `HTTP ${status}` : renderJsonPayload(payload)))
    )

const toRequestBody = (body: JsonRequest | undefined) => body === undefined ? HttpBody.empty : HttpBody.unsafeJson(body)

export const resolveApiBaseUrl = (): string => {
  const configured = import.meta.env["VITE_DOCKER_GIT_API_BASE_URL"]
  return configured === undefined || configured.trim().length === 0
    ? defaultApiBaseUrl
    : trimTrailingSlash(configured.trim())
}

const renderOpenApiBody = (body: RenderableOpenApiBody): string => {
  if (body === undefined) {
    return "empty response"
  }
  if (typeof body === "string") {
    return body
  }
  return JSON.stringify(body, null, 2)
}

// CHANGE: Convert direct openapi-effect failures to legacy UI string errors at the web boundary.
// WHY: app API functions still expose `Effect<_, string>` while transport typing is owned by openapi-effect.
// QUOTE(ТЗ): "client сам возвращает нужную схему рабочую"
// REF: user-openapi-effect-direct-client
// SOURCE: n/a
// FORMAT THEOREM: forall failure f: render(f) is total and does not alter success values.
// PURITY: SHELL
// EFFECT: none
// INVARIANT: only the error channel is collapsed to string for existing UI callers.
// COMPLEXITY: O(n)/O(n), where n is rendered body size.
/**
 * Renders typed openapi-effect failures for existing UI string error channels.
 *
 * @param failure - Typed OpenAPI transport or HTTP failure.
 * @returns User-facing diagnostic string.
 *
 * @pure true - deterministic formatting of immutable failure data.
 * @effect none.
 * @invariant success values are never inspected or changed; only failure values are rendered.
 * @precondition failure was produced by the docker-git OpenAPI client.
 * @postcondition return value is non-throwing and suitable for legacy `Effect<_, string>` callers.
 * @complexity O(n)/O(n), where n is rendered response body size.
 * @throws Never.
 */
export const renderDockerGitOpenApiFailure = (failure: RenderableOpenApiFailure): string =>
  Match.value(failure).pipe(
    Match.when({ _tag: "HttpError" }, (error) =>
      String(error.status) === "429"
        ? "HTTP 429: tunnel or proxy rate limited the request. Retry or request a fresh tunnel URL."
        : renderOpenApiBody(error.body)),
    Match.when({ _tag: "TransportError" }, (error) => error.error.message),
    Match.when({ _tag: "UnexpectedStatus" }, (error) => `HTTP ${error.status}: ${renderOpenApiBody(error.body)}`),
    Match.when({ _tag: "UnexpectedContentType" }, (error) =>
      `HTTP ${error.status}: unexpected content type ${error.actual ?? "none"}: ${error.body}`),
    Match.when({ _tag: "ParseError" }, (error) =>
      `HTTP ${error.status}: invalid ${error.contentType} response: ${error.error.message}`),
    Match.when({ _tag: "DecodeError" }, (error) =>
      `HTTP ${error.status}: invalid decoded response: ${error.error.message}`),
    Match.exhaustive
  )

/**
 * Configured docker-git OpenAPI client for the web HTTP boundary.
 *
 * @pure false - binds the shared OpenAPI client to the app-specific base URL resolver.
 * @effect none during construction; returned client methods perform HTTP IO when their Effects run.
 * @invariant transport, error rendering, and schema decoding stay owned by the openapi package.
 * @precondition resolveApiBaseUrl returns a valid docker-git API base URL for the current runtime.
 * @postcondition app modules depend on one configured OpenAPI client instance.
 * @complexity O(1)/O(1) for construction, excluding request execution.
 * @throws Never.
 */
export const dockerGitOpenApi = createClient({
  baseUrl: resolveApiBaseUrl()
})

export const requestText = (
  method: ApiHttpMethod,
  path: string,
  body?: JsonRequest
): Effect.Effect<string, string> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(executeRequest(client, method, `${resolveApiBaseUrl()}${path}`, body))
    const text = yield* _(response.text)
    if (response.status >= 400) {
      return yield* _(readErrorMessage(response.status, text))
    }
    return text
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(String)
  )

export const requestTextStream = (
  { body, method, onChunk, path }: TextStreamRequest
): Effect.Effect<string, string> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(executeRequest(client, method, `${resolveApiBaseUrl()}${path}`, body))
    if (response.status >= 400) {
      const text = yield* _(response.text)
      return yield* _(readErrorMessage(response.status, text))
    }
    return yield* _(readHttpResponseTextStream(response, onChunk))
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError(String)
  )

export const requestJson = <A, I>(
  method: ApiHttpMethod,
  path: string,
  schema: Schema.Schema<A, I>,
  body?: JsonRequest
): Effect.Effect<A, string> =>
  requestText(method, path, body).pipe(
    Effect.flatMap((text) => decodeSchema(Schema.parseJson(schema), text))
  )

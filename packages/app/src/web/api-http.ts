import { FetchHttpClient, HttpBody, HttpClient } from "@effect/platform"
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import * as TreeFormatter from "@effect/schema/TreeFormatter"
import { Effect, Either } from "effect"

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

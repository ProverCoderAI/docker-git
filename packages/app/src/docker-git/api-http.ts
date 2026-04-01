import { FetchHttpClient, HttpBody, HttpClient } from "@effect/platform"
import type * as HttpClientError from "@effect/platform/HttpClientError"
import { Effect } from "effect"

import { asObject, type JsonRequest, type JsonValue, parseResponseBody } from "./api-json.js"
import { resolveApiBaseUrl } from "./controller.js"
import type { ApiAuthRequiredError, ApiRequestError } from "./host-errors.js"

type ApiTransportError = ApiRequestError | ApiAuthRequiredError

type ApiErrorEnvelope = {
  readonly error?: {
    readonly type?: string
    readonly message?: string
    readonly provider?: string
    readonly command?: string
    readonly details?: JsonValue
  }
}

const jsonHeaders = {
  "content-type": "application/json",
  accept: "application/json"
} as const

const defaultGithubLoginCommand = "docker-git auth github login --web"

const isApiTransportError = (
  error: ApiTransportError | HttpClientError.HttpClientError
): error is ApiTransportError => error._tag === "ApiRequestError" || error._tag === "ApiAuthRequiredError"

const readErrorPayload = (body: JsonValue): ApiErrorEnvelope["error"] | undefined =>
  (asObject(body) as ApiErrorEnvelope | null)?.error

const isAuthRequired = (
  status: number,
  error: ApiErrorEnvelope["error"] | undefined
): boolean => status === 401 || (error?.type ?? "").toLowerCase().includes("authrequired")

const renderDetails = (details: JsonValue | undefined): string | null =>
  details === undefined ? null : `Details: ${JSON.stringify(details, null, 2)}`

const renderRequestMessage = (message: string, details: JsonValue | undefined): string => {
  const renderedDetails = renderDetails(details)
  return renderedDetails === null ? message : `${message}\n${renderedDetails}`
}

const toAuthRequiredError = (
  error: ApiErrorEnvelope["error"] | undefined,
  status: number
): ApiAuthRequiredError => ({
  _tag: "ApiAuthRequiredError",
  provider: error?.provider ?? "github",
  message: error?.message ?? `HTTP ${status}`,
  command: error?.command ?? defaultGithubLoginCommand
})

const toApiRequestError = (
  method: string,
  path: string,
  status: number,
  error: ApiErrorEnvelope["error"] | undefined
): ApiRequestError => ({
  _tag: "ApiRequestError",
  method,
  path,
  message: renderRequestMessage(error?.message ?? `HTTP ${status}`, error?.details)
})

const toRequestError = (
  method: string,
  path: string,
  status: number,
  body: JsonValue
): ApiTransportError => {
  const error = readErrorPayload(body)
  if (isAuthRequired(status, error)) {
    return toAuthRequiredError(error, status)
  }
  return toApiRequestError(method, path, status, error)
}

const executeRequest = (
  client: HttpClient.HttpClient,
  method: "GET" | "POST",
  path: string,
  body: JsonRequest | undefined
) =>
  method === "GET"
    ? client.get(`${resolveApiBaseUrl()}${path}`, { headers: jsonHeaders })
    : client.post(`${resolveApiBaseUrl()}${path}`, {
      headers: jsonHeaders,
      body: body === undefined ? HttpBody.empty : HttpBody.unsafeJson(body)
    })

export const request = (
  method: "GET" | "POST",
  path: string,
  body?: JsonRequest
): Effect.Effect<JsonValue, ApiTransportError> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(executeRequest(client, method, path, body))
    const parsed = yield* _(response.text.pipe(Effect.flatMap((text) => parseResponseBody(text))))

    if (response.status >= 400) {
      return yield* _(Effect.fail(toRequestError(method, path, response.status, parsed)))
    }

    return parsed
  }).pipe(
    Effect.provide(FetchHttpClient.layer),
    Effect.mapError((error): ApiTransportError =>
      isApiTransportError(error)
        ? error
        : {
          _tag: "ApiRequestError",
          method,
          path,
          message: String(error)
        }
    )
  )

export const requestVoid = (method: "GET" | "POST", path: string, body?: JsonRequest) =>
  request(method, path, body).pipe(Effect.asVoid)

import { FetchHttpClient, HttpBody, HttpClient, HttpClientResponse } from "@effect/platform"
import type * as HttpClientError from "@effect/platform/HttpClientError"
import { Effect } from "effect"
import * as Stream from "effect/Stream"

import { asObject, asString, type JsonRequest, type JsonValue, parseResponseBody } from "./api-json.js"
import { type ControllerRuntime, ensureControllerReady, resolveApiBaseUrl } from "./controller.js"
import type { ApiAuthRequiredError, ApiRequestError } from "./host-errors.js"

type ApiTransportError = ApiRequestError | ApiAuthRequiredError
type ApiHttpMethod = "GET" | "POST" | "DELETE"

type ApiErrorEnvelope = {
  readonly error?: {
    readonly type?: string
    readonly message?: string
    readonly provider?: string
    readonly command?: string
    readonly details?: JsonValue
  }
}

type ApiErrorPayload = NonNullable<ApiErrorEnvelope["error"]>

const jsonHeaders: Readonly<Record<string, string>> = {
  "content-type": "application/json",
  accept: "application/json"
}

const defaultGithubLoginCommand = "docker-git auth github login --web"

const isApiTransportError = (
  error: ApiTransportError | HttpClientError.HttpClientError
): error is ApiTransportError => error._tag === "ApiRequestError" || error._tag === "ApiAuthRequiredError"

const readErrorPayload = (body: JsonValue): ApiErrorPayload | undefined => {
  const envelope = asObject(body)
  if (envelope === null) {
    return undefined
  }

  const error = asObject(envelope["error"])
  if (error === null) {
    return undefined
  }

  const type = asString(error["type"])
  const message = asString(error["message"])
  const provider = asString(error["provider"])
  const command = asString(error["command"])
  const details = error["details"]

  return {
    ...(type === null ? {} : { type }),
    ...(message === null ? {} : { message }),
    ...(provider === null ? {} : { provider }),
    ...(command === null ? {} : { command }),
    ...(details === undefined ? {} : { details })
  }
}

const isAuthRequired = (status: number, error: ApiErrorEnvelope["error"] | undefined): boolean =>
  status === 401 || (error?.type ?? "").toLowerCase().includes("authrequired")

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
  return isAuthRequired(status, error)
    ? toAuthRequiredError(error, status)
    : toApiRequestError(method, path, status, error)
}

const requestBody = (body: JsonRequest | undefined) => body === undefined ? HttpBody.empty : HttpBody.unsafeJson(body)

const executeRequest = (
  client: HttpClient.HttpClient,
  apiBaseUrl: string,
  method: ApiHttpMethod,
  path: string,
  body: JsonRequest | undefined
) => {
  const url = `${apiBaseUrl}${path}`

  if (method === "GET") {
    return client.get(url, { headers: jsonHeaders })
  }

  if (method === "DELETE") {
    return client.del(url, {
      headers: jsonHeaders,
      body: requestBody(body)
    })
  }

  return client.post(url, {
    headers: jsonHeaders,
    body: requestBody(body)
  })
}

const executeRequestWithControllerRetry = (
  client: HttpClient.HttpClient,
  method: ApiHttpMethod,
  path: string,
  body: JsonRequest | undefined
) => {
  const execute = () => executeRequest(client, resolveApiBaseUrl(), method, path, body)

  return execute().pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        ensureControllerReady().pipe(
          Effect.matchEffect({
            onFailure: () => Effect.fail(error),
            onSuccess: () => execute()
          })
        ),
      onSuccess: (value) => Effect.succeed(value)
    })
  )
}

const mapTransportError = (
  method: ApiHttpMethod,
  path: string
) =>
  Effect.mapError((error: ApiTransportError | HttpClientError.HttpClientError): ApiTransportError =>
    isApiTransportError(error)
      ? error
      : {
        _tag: "ApiRequestError",
        method,
        path,
        message: String(error)
      }
  )

const requestResponse = (
  method: ApiHttpMethod,
  path: string,
  body: JsonRequest | undefined
): Effect.Effect<
  HttpClientResponse.HttpClientResponse,
  HttpClientError.HttpClientError,
  HttpClient.HttpClient | ControllerRuntime
> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    return yield* _(executeRequestWithControllerRetry(client, method, path, body))
  })

export const request = (
  method: ApiHttpMethod,
  path: string,
  body?: JsonRequest
): Effect.Effect<JsonValue, ApiTransportError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const response = yield* _(requestResponse(method, path, body))
    const parsed = yield* _(response.text.pipe(Effect.flatMap((text) => parseResponseBody(text))))

    if (response.status >= 400) {
      return yield* _(Effect.fail(toRequestError(method, path, response.status, parsed)))
    }

    return parsed
  }).pipe(Effect.provide(FetchHttpClient.layer), mapTransportError(method, path))

export const requestVoid = (method: ApiHttpMethod, path: string, body?: JsonRequest) =>
  request(method, path, body).pipe(Effect.asVoid)

const readResponseTextStream = (
  response: HttpClientResponse.HttpClientResponse,
  onChunk: (chunk: string) => void
) =>
  HttpClientResponse.stream(Effect.succeed(response)).pipe(
    Stream.decodeText(),
    Stream.runFoldEffect("", (output, chunk) =>
      Effect.sync(() => {
        onChunk(chunk)
        return output + chunk
      }))
  )

export const requestTextStream = (
  method: ApiHttpMethod,
  path: string,
  body: JsonRequest | undefined,
  onChunk: (chunk: string) => void
): Effect.Effect<string, ApiTransportError, ControllerRuntime> =>
  Effect.gen(function*(_) {
    const response = yield* _(requestResponse(method, path, body))

    if (response.status >= 400) {
      const text = yield* _(response.text)
      const parsed = yield* _(parseResponseBody(text))
      return yield* _(Effect.fail(toRequestError(method, path, response.status, parsed)))
    }

    return yield* _(readResponseTextStream(response, onChunk))
  }).pipe(Effect.provide(FetchHttpClient.layer), mapTransportError(method, path))

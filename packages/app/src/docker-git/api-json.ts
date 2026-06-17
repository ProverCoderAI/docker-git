import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

import { type JsonObject, type JsonValue, JsonValueSchema } from "../shared/json-schema.js"

export type { JsonObject, JsonValue } from "../shared/json-schema.js"

export type JsonRequest = boolean | number | string | ReadonlyArray<JsonRequest> | {
  readonly [key: string]: JsonRequest | undefined
} | null

const JsonValueFromStringSchema: Schema.Schema<JsonValue, string> = Schema.parseJson(JsonValueSchema)

const decodeJsonText = (input: string): Effect.Effect<JsonValue> =>
  Either.match(ParseResult.decodeUnknownEither(JsonValueFromStringSchema)(input), {
    onLeft: () => Effect.succeed(input),
    onRight: (value) => Effect.succeed(value)
  })

export const parseResponseBody = (body: string): Effect.Effect<JsonValue> => {
  const trimmed = body.trim()
  if (trimmed.length === 0) {
    return Effect.succeed(null)
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return decodeJsonText(trimmed)
  }
  return Effect.succeed(trimmed)
}

export const isJsonObject = (value: JsonValue | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value)

export const isJsonArray = (value: JsonValue | undefined): value is ReadonlyArray<JsonValue> => Array.isArray(value)

export const asObject = (value: JsonValue | undefined): JsonObject | null => isJsonObject(value) ? value : null

export const asArray = (value: JsonValue | undefined): ReadonlyArray<JsonValue> => isJsonArray(value) ? value : []

export const asString = (value: JsonValue | undefined): string | null => typeof value === "string" ? value : null

const renderGithubStatusLine = (entry: JsonObject): string | null => {
  const label = asString(entry["label"])
  const status = asString(entry["status"])
  if (label === null || status === null) {
    return null
  }

  const login = asString(entry["login"])

  if (status === "valid") {
    return login === null
      ? `- ${label}: valid (owner unavailable)`
      : `- ${label}: valid (owner: ${login})`
  }

  if (status === "invalid") {
    return `- ${label}: invalid`
  }

  return `- ${label}: unknown (validation unavailable)`
}

const renderGithubStatusLike = (value: JsonObject): string | null => {
  const summary = asString(value["summary"])
  if (summary === null) {
    return null
  }

  const lines = asArray(value["tokens"])
    .flatMap((entry) => {
      const item = asObject(entry)
      return item === null ? [] : [renderGithubStatusLine(item)]
    })
    .filter((line): line is string => line !== null)

  return lines.length === 0 ? summary : [summary, ...lines].join("\n")
}

const readNestedMessage = (
  object: JsonObject,
  key: string
): string | null => {
  const nested = asObject(object[key])
  if (nested === null) {
    return null
  }
  return asString(nested["message"])
}

const renderNestedStatusPayload = (
  payload: JsonValue,
  object: JsonObject
): string | null => {
  const nestedStatus = asObject(object["status"])
  if (nestedStatus === null) {
    return null
  }

  const renderedNestedStatus = renderGithubStatusLike(nestedStatus)
  if (renderedNestedStatus !== null) {
    return renderedNestedStatus
  }

  return readNestedMessage(object, "status") ?? JSON.stringify(payload, null, 2)
}

const renderDirectObjectPayload = (object: JsonObject): string | null => {
  const directStatus = renderGithubStatusLike(object)
  if (directStatus !== null) {
    return directStatus
  }

  return asString(object["message"])
}

export const renderJsonPayload = (payload: JsonValue): string => {
  if (typeof payload === "string") {
    return payload
  }

  const object = asObject(payload)
  if (object === null) {
    return JSON.stringify(payload, null, 2)
  }

  const directPayload = renderDirectObjectPayload(object)
  if (directPayload !== null) {
    return directPayload
  }

  const nestedStatus = renderNestedStatusPayload(payload, object)
  if (nestedStatus !== null) {
    return nestedStatus
  }

  const nestedErrorMessage = readNestedMessage(object, "error")
  if (nestedErrorMessage !== null) {
    return nestedErrorMessage
  }

  return JSON.stringify(payload, null, 2)
}

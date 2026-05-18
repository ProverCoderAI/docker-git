/* jscpd:ignore-start */
import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Either } from "effect"

type JsonPrimitive = boolean | number | string | null
type JsonValue = JsonPrimitive | JsonRecord | ReadonlyArray<JsonValue>
type JsonRecord = Readonly<{ [key: string]: JsonValue }>

const JsonValueSchema: Schema.Schema<JsonValue> = Schema.suspend(() =>
  Schema.Union(
    Schema.Null,
    Schema.Boolean,
    Schema.String,
    Schema.JsonNumber,
    Schema.Array(JsonValueSchema),
    Schema.Record({ key: Schema.String, value: JsonValueSchema })
  )
)

const JsonRecordSchema: Schema.Schema<JsonRecord> = Schema.Record({
  key: Schema.String,
  value: JsonValueSchema
})

const JsonRecordFromStringSchema = Schema.parseJson(JsonRecordSchema)
const officialGrokAuthScopes: ReadonlyArray<string> = [
  "https://auth.x.ai::b1a00492-073a-47ea-816f-4c329264a828",
  "https://accounts.x.ai/sign-in"
]
const grokUserSettingsCredentialKeys: ReadonlyArray<string> = [
  "apiKey",
  "accessToken",
  "access_token",
  "authToken",
  "refreshToken",
  "refresh_token"
]
const grokOauthCredentialKeys: ReadonlyArray<string> = [...grokUserSettingsCredentialKeys, "token"]
const grokUserSettingsFallbackCredentialMarkers: ReadonlyArray<RegExp> = [
  /"(?:apiKey|accessToken|access_token|authToken|refreshToken|refresh_token)"\s*:\s*"[^"]+"/u
]

const parseJsonRecordOrNull = (text: string): JsonRecord | null =>
  Either.match(ParseResult.decodeUnknownEither(JsonRecordFromStringSchema)(text), {
    onLeft: () => null,
    onRight: (record) => record
  })

const isJsonRecord = (value: JsonValue | undefined): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const hasNonEmptyStringProperty = (record: JsonRecord, key: string): boolean =>
  typeof record[key] === "string" && record[key].trim().length > 0

export const hasGrokUserSettingsCredentialText = (settingsText: string): boolean => {
  const parsed = parseJsonRecordOrNull(settingsText)
  if (parsed !== null) {
    if (grokUserSettingsCredentialKeys.some((key) => hasNonEmptyStringProperty(parsed, key))) {
      return true
    }
    const oauth = parsed["oauth"]
    return isJsonRecord(oauth) && grokOauthCredentialKeys.some((key) => hasNonEmptyStringProperty(oauth, key))
  }

  return grokUserSettingsFallbackCredentialMarkers.some((marker) => marker.test(settingsText))
}

export const hasGrokAuthJsonCredentialText = (authJsonText: string): boolean => {
  const parsed = parseJsonRecordOrNull(authJsonText)
  return parsed !== null &&
    officialGrokAuthScopes.some((scope) => {
      const scopedCredentials = parsed[scope]
      return isJsonRecord(scopedCredentials) && hasNonEmptyStringProperty(scopedCredentials, "key")
    })
}
/* jscpd:ignore-end */

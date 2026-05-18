import { parseJsonRecordOrNull } from "./auth-sync-helpers.js"
import type { JsonRecord, JsonValue } from "./auth-sync-helpers.js"

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

import type { ApiEvent } from "./api.js"

export const readEventPayloadString = (
  event: ApiEvent,
  key: string
): string | null => {
  const payload = event.payload
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return null
  }
  const value = Object.entries(payload).find(([name]) => name === key)?.[1]
  return typeof value === "string" ? value : null
}

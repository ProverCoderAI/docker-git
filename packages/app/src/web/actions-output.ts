import { appendOutputChunk, type BrowserActionContext } from "./actions-shared.js"

export const appendOutputLine = (
  context: BrowserActionContext,
  line: string
) => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return
  }
  appendOutputChunk(context, `${trimmed}\n`)
}

export const appendOutputLineHandler =
  (context: BrowserActionContext) =>
  (line: string) => {
    appendOutputLine(context, line)
  }

export const notifyProjectEventRateLimit = (context: BrowserActionContext) => {
  context.setMessage("HTTP 429: tunnel or proxy rate limited the live stream. Retry or request a fresh tunnel URL.")
}

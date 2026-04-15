import * as ParseResult from "@effect/schema/ParseResult"
import { Either } from "effect"

import { TerminalServerMessageSchema } from "../shared/terminal-session-schema.js"
import type { TerminalServerMessage as ParsedTerminalServerMessage } from "../shared/terminal-session-schema.js"
import { resolveApiBaseUrl, trimTrailingSlash } from "./api-http.js"
import type { TerminalSession } from "./api-schema.js"

export type ActiveTerminalSession = {
  readonly browserProjectId?: string | undefined
  readonly browserProjectName?: string | undefined
  readonly closePath: string
  readonly exitMessage: string
  readonly header: string
  readonly onExit?: () => void
  readonly onReady?: () => void
  readonly pendingDeleteMessage: string
  readonly readyMessage: string
  readonly session: TerminalSession
  readonly subtitle: string
  readonly websocketPath: string
}

const resolveTerminalApiBaseUrl = (): string => {
  const configured = import.meta.env.VITE_DOCKER_GIT_TERMINAL_API_BASE_URL
  if (configured !== undefined && configured.trim().length > 0) {
    return trimTrailingSlash(configured.trim())
  }

  return resolveApiBaseUrl()
}

const resolveApiUrl = (): URL => {
  const configured = resolveTerminalApiBaseUrl()
  if (configured.startsWith("http://") || configured.startsWith("https://")) {
    return new URL(configured)
  }
  return new URL(configured, globalThis.location.origin)
}

export const resolveTerminalWebSocketUrl = (websocketPath: string, cols: number, rows: number): string => {
  const apiUrl = resolveApiUrl()
  apiUrl.protocol = apiUrl.protocol === "https:" ? "wss:" : "ws:"
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/$/u, "")}${websocketPath}`
  apiUrl.searchParams.set("cols", String(cols))
  apiUrl.searchParams.set("rows", String(rows))
  return apiUrl.toString()
}

export const parseTerminalServerMessage = (value: string): ParsedTerminalServerMessage | null =>
  Either.getOrNull(ParseResult.decodeUnknownEither(TerminalServerMessageSchema)(value))

export { type TerminalServerMessage } from "../shared/terminal-session-schema.js"

import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Either } from "effect"

import { resolveApiBaseUrl, trimTrailingSlash } from "./api-http.js"
import { type TerminalSession, TerminalSessionSchema } from "./api-schema.js"

export type ActiveTerminalSession = {
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

export type TerminalServerMessage =
  | { readonly type: "ready"; readonly session: TerminalSession }
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exit"; readonly exitCode: number | null; readonly signal: number | null }
  | { readonly type: "error"; readonly message: string }

const TerminalServerMessageSchema = Schema.parseJson(
  Schema.Union(
    Schema.Struct({
      type: Schema.Literal("ready"),
      session: TerminalSessionSchema
    }),
    Schema.Struct({
      type: Schema.Literal("output"),
      data: Schema.String
    }),
    Schema.Struct({
      type: Schema.Literal("exit"),
      exitCode: Schema.NullOr(Schema.Number),
      signal: Schema.NullOr(Schema.Number)
    }),
    Schema.Struct({
      type: Schema.Literal("error"),
      message: Schema.String
    })
  )
)

const resolveTerminalApiBaseUrl = (): string => {
  const configured = import.meta.env.VITE_DOCKER_GIT_TERMINAL_API_BASE_URL
  if (configured !== undefined && configured.trim().length > 0) {
    return trimTrailingSlash(configured.trim())
  }

  const apiBaseUrl = resolveApiBaseUrl()
  if (apiBaseUrl.startsWith("http://") || apiBaseUrl.startsWith("https://")) {
    return apiBaseUrl
  }

  if (globalThis.location.protocol === "http:") {
    const apiPort = import.meta.env.VITE_DOCKER_GIT_TERMINAL_API_PORT?.trim() || "3334"
    return `http://${globalThis.location.hostname}:${apiPort}`
  }

  return apiBaseUrl
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

export const parseTerminalServerMessage = (value: string): TerminalServerMessage | null =>
  Either.getOrNull(ParseResult.decodeUnknownEither(TerminalServerMessageSchema)(value))

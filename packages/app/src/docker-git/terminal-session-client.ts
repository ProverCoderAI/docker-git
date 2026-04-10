import * as ParseResult from "@effect/schema/ParseResult"
import * as Schema from "@effect/schema/Schema"
import { Effect, Either } from "effect"

import type { ApiTerminalSession } from "./api-client.js"
import { resolveApiBaseUrl } from "./controller.js"
import { writeToTerminal } from "./menu-shared.js"

export type TerminalSessionClientError = {
  readonly _tag: "TerminalSessionClientError"
  readonly message: string
}

type TerminalClientMessage =
  | { readonly type: "input"; readonly data: string }
  | { readonly type: "resize"; readonly cols: number; readonly rows: number }
  | { readonly type: "close" }

type TerminalServerMessage =
  | { readonly type: "ready"; readonly session: ApiTerminalSession }
  | { readonly type: "output"; readonly data: string }
  | { readonly type: "exit"; readonly exitCode: number | null; readonly signal: number | null }
  | { readonly type: "error"; readonly message: string }

type TerminalAttachment = {
  readonly header: string
  readonly session: ApiTerminalSession
  readonly websocketPath: string
}

const TerminalSessionSchema = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  sshCommand: Schema.String,
  status: Schema.Union(
    Schema.Literal("ready"),
    Schema.Literal("attached"),
    Schema.Literal("exited"),
    Schema.Literal("failed")
  ),
  createdAt: Schema.String,
  startedAt: Schema.optional(Schema.String),
  closedAt: Schema.optional(Schema.String),
  exitCode: Schema.optional(Schema.Number),
  signal: Schema.optional(Schema.Number)
})

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

const terminalSessionError = (message: string): TerminalSessionClientError => ({
  _tag: "TerminalSessionClientError",
  message
})

const encodeClientMessage = (message: TerminalClientMessage): string => JSON.stringify(message)

const parseServerMessage = (value: string): TerminalServerMessage | null =>
  Either.getOrNull(ParseResult.decodeUnknownEither(TerminalServerMessageSchema)(value))

const resolveTerminalWebSocketUrl = (websocketPath: string): string => {
  const apiBaseUrl = new URL(resolveApiBaseUrl())
  apiBaseUrl.protocol = apiBaseUrl.protocol === "https:" ? "wss:" : "ws:"
  apiBaseUrl.pathname = `${apiBaseUrl.pathname.replace(/\/$/u, "")}${websocketPath}`
  apiBaseUrl.searchParams.set("cols", String(process.stdout.columns ?? 120))
  apiBaseUrl.searchParams.set("rows", String(process.stdout.rows ?? 32))
  return apiBaseUrl.toString()
}

const sendResize = (socket: WebSocket): void => {
  socket.send(encodeClientMessage({
    type: "resize",
    cols: process.stdout.columns ?? 120,
    rows: process.stdout.rows ?? 32
  }))
}

const setRawMode = (enabled: boolean): void => {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(enabled)
  }
}

const cleanupTerminalHandlers = (
  socket: WebSocket,
  inputHandler: (chunk: Buffer) => void,
  resizeHandler: () => void
): void => {
  process.stdin.off("data", inputHandler)
  process.stdout.off("resize", resizeHandler)
  setRawMode(false)
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(encodeClientMessage({ type: "close" }))
  }
}

const writeHeader = (attachment: TerminalAttachment): void => {
  writeToTerminal(`\n[docker-git] ${attachment.header}\n`)
  writeToTerminal(`[docker-git] ${attachment.session.sshCommand}\n\n`)
}

export const attachTerminalSession = (
  attachment: TerminalAttachment
): Effect.Effect<void, TerminalSessionClientError> =>
  Effect.async((resume) => {
    const socket = new WebSocket(resolveTerminalWebSocketUrl(attachment.websocketPath))
    let settled = false
    let sawExit = false

    const finish = (effect: Effect.Effect<void, TerminalSessionClientError>): void => {
      if (settled) {
        return
      }
      settled = true
      resume(effect)
    }

    const inputHandler = (chunk: Buffer): void => {
      if (socket.readyState !== WebSocket.OPEN) {
        return
      }
      socket.send(encodeClientMessage({ type: "input", data: chunk.toString("utf8") }))
    }

    const resizeHandler = (): void => {
      if (socket.readyState !== WebSocket.OPEN) {
        return
      }
      sendResize(socket)
    }

    socket.onopen = () => {
      writeHeader(attachment)
      process.stdin.resume()
      setRawMode(true)
      process.stdin.on("data", inputHandler)
      process.stdout.on("resize", resizeHandler)
      sendResize(socket)
    }

    socket.onmessage = (event) => {
      const payload = typeof event.data === "string" ? event.data : String(event.data)
      const message = parseServerMessage(payload)
      if (message === null) {
        finish(Effect.fail(terminalSessionError("Invalid terminal protocol message.")))
        return
      }

      if (message.type === "ready") {
        return
      }

      if (message.type === "output") {
        writeToTerminal(message.data)
        return
      }

      if (message.type === "error") {
        finish(Effect.fail(terminalSessionError(message.message)))
        return
      }

      sawExit = true
      const suffix = message.exitCode === null ? "" : ` (exit ${message.exitCode})`
      writeToTerminal(`\n[docker-git] terminal finished${suffix}\n`)
      finish(Effect.void)
    }

    socket.onerror = () => {
      finish(Effect.fail(terminalSessionError("Terminal websocket error.")))
    }

    socket.onclose = () => {
      cleanupTerminalHandlers(socket, inputHandler, resizeHandler)
      if (!sawExit) {
        finish(Effect.fail(terminalSessionError("Terminal websocket closed before exit.")))
      }
    }

    return Effect.sync(() => {
      cleanupTerminalHandlers(socket, inputHandler, resizeHandler)
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
        socket.close()
      }
    })
  })

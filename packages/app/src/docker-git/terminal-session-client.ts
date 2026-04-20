import * as ParseResult from "@effect/schema/ParseResult"
import { Effect, Either } from "effect"

import { type TerminalServerMessage, TerminalServerMessageSchema } from "../shared/terminal-session-schema.js"
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

type TerminalAttachment = {
  readonly header: string
  readonly session: ApiTerminalSession
  readonly websocketPath: string
}

type TerminalHandlers = {
  readonly handleClose: () => void
  readonly handleError: () => void
  readonly handleMessage: (event: MessageEvent) => void
  readonly handleOpen: () => void
  readonly inputHandler: (chunk: Buffer) => void
  readonly resizeHandler: () => void
}

type TerminalLifecycle = {
  attachTimeout: ReturnType<typeof setTimeout> | null
  openTimeout: ReturnType<typeof setTimeout> | null
  sawExit: boolean
  sawOpen: boolean
  sawServerMessage: boolean
  settled: boolean
}

const terminalOpenTimeoutMs = 3000
const terminalAttachTimeoutMs = 5000

const terminalSessionError = (message: string): TerminalSessionClientError => ({
  _tag: "TerminalSessionClientError",
  message
})

const encodeClientMessage = (message: TerminalClientMessage): string => JSON.stringify(message)

const parseServerMessage = (value: string): TerminalServerMessage | null =>
  Either.getOrNull(ParseResult.decodeUnknownEither(TerminalServerMessageSchema)(value))

const resolveTerminalSize = (): { readonly cols: number; readonly rows: number } =>
  process.stdout.isTTY ? { cols: process.stdout.columns, rows: process.stdout.rows } : { cols: 120, rows: 32 }

const resolveTerminalWebSocketUrl = (websocketPath: string): string => {
  const apiBaseUrl = new URL(resolveApiBaseUrl())
  const { cols, rows } = resolveTerminalSize()
  apiBaseUrl.protocol = apiBaseUrl.protocol === "https:" ? "wss:" : "ws:"
  apiBaseUrl.pathname = `${apiBaseUrl.pathname.replace(/\/$/u, "")}${websocketPath}`
  apiBaseUrl.searchParams.set("cols", String(cols))
  apiBaseUrl.searchParams.set("rows", String(rows))
  return apiBaseUrl.toString()
}

const sendResize = (socket: WebSocket): void => {
  const { cols, rows } = resolveTerminalSize()
  socket.send(encodeClientMessage({
    type: "resize",
    cols,
    rows
  }))
}

const setRawMode = (enabled: boolean): void => {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(enabled)
  }
}

const clearTimer = (timer: ReturnType<typeof setTimeout> | null): null => {
  if (timer !== null) {
    clearTimeout(timer)
  }
  return null
}

const clearLifecycleTimers = (lifecycle: TerminalLifecycle): void => {
  lifecycle.openTimeout = clearTimer(lifecycle.openTimeout)
  lifecycle.attachTimeout = clearTimer(lifecycle.attachTimeout)
}

const closeSocket = (socket: WebSocket): void => {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close()
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

const handleTerminalServerMessage = (
  message: TerminalServerMessage,
  finish: (effect: Effect.Effect<void, TerminalSessionClientError>) => void,
  markExit: () => void
): void => {
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

  markExit()
  const suffix = message.exitCode === null ? "" : ` (exit ${message.exitCode})`
  writeToTerminal(`\n[docker-git] terminal finished${suffix}\n`)
  finish(Effect.void)
}

const createTerminalInputHandler = (socket: WebSocket) => (chunk: Buffer): void => {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(encodeClientMessage({ type: "input", data: chunk.toString("utf8") }))
}

const createTerminalResizeHandler = (socket: WebSocket) => (): void => {
  if (socket.readyState !== WebSocket.OPEN) {
    return
  }
  sendResize(socket)
}

const createTerminalOpenHandler = (
  attachment: TerminalAttachment,
  socket: WebSocket,
  inputHandler: (chunk: Buffer) => void,
  resizeHandler: () => void,
  lifecycle: TerminalLifecycle,
  startAttachTimeout: () => void
) =>
(): void => {
  if (lifecycle.settled) {
    return
  }

  lifecycle.sawOpen = true
  lifecycle.openTimeout = clearTimer(lifecycle.openTimeout)
  startAttachTimeout()
  writeHeader(attachment)
  process.stdin.resume()
  setRawMode(true)
  process.stdin.on("data", inputHandler)
  process.stdout.on("resize", resizeHandler)
  sendResize(socket)
}

const createTerminalMessageHandler = (
  lifecycle: TerminalLifecycle,
  finish: (effect: Effect.Effect<void, TerminalSessionClientError>) => void,
  markExit: () => void
) =>
(event: MessageEvent): void => {
  if (lifecycle.settled) {
    return
  }

  lifecycle.sawServerMessage = true
  lifecycle.attachTimeout = clearTimer(lifecycle.attachTimeout)

  const payload = typeof event.data === "string" ? event.data : String(event.data)
  const message = parseServerMessage(payload)
  if (message === null) {
    finish(Effect.fail(terminalSessionError("Invalid terminal protocol message.")))
    return
  }
  handleTerminalServerMessage(message, finish, markExit)
}

const createTerminalErrorHandler = (
  lifecycle: TerminalLifecycle,
  finish: (effect: Effect.Effect<void, TerminalSessionClientError>) => void
) =>
(): void => {
  if (lifecycle.settled) {
    return
  }
  finish(Effect.fail(terminalSessionError("Terminal websocket error.")))
}

const createTerminalCloseHandler = (
  lifecycle: TerminalLifecycle,
  finish: (effect: Effect.Effect<void, TerminalSessionClientError>) => void,
  hasSeenExit: () => boolean
) =>
(): void => {
  if (lifecycle.settled) {
    return
  }

  if (!lifecycle.sawOpen || !lifecycle.sawServerMessage) {
    finish(Effect.fail(terminalSessionError("Terminal websocket closed before attach.")))
    return
  }

  if (!hasSeenExit()) {
    finish(Effect.fail(terminalSessionError("Terminal websocket closed before exit.")))
  }
}

const createTerminalHandlers = (
  attachment: TerminalAttachment,
  socket: WebSocket,
  lifecycle: TerminalLifecycle,
  finish: (effect: Effect.Effect<void, TerminalSessionClientError>) => void,
  hasSeenExit: () => boolean,
  markExit: () => void,
  startAttachTimeout: () => void
): TerminalHandlers => {
  const inputHandler = createTerminalInputHandler(socket)
  const resizeHandler = createTerminalResizeHandler(socket)
  const handleOpen = createTerminalOpenHandler(
    attachment,
    socket,
    inputHandler,
    resizeHandler,
    lifecycle,
    startAttachTimeout
  )
  const handleMessage = createTerminalMessageHandler(lifecycle, finish, markExit)
  const handleError = createTerminalErrorHandler(lifecycle, finish)
  const handleClose = createTerminalCloseHandler(lifecycle, finish, hasSeenExit)
  return { handleClose, handleError, handleMessage, handleOpen, inputHandler, resizeHandler }
}

export const attachTerminalSession = (
  attachment: TerminalAttachment
): Effect.Effect<void, TerminalSessionClientError> =>
  Effect.async((resume) => {
    const socket = new WebSocket(resolveTerminalWebSocketUrl(attachment.websocketPath))
    const lifecycle: TerminalLifecycle = {
      attachTimeout: null,
      openTimeout: null,
      sawExit: false,
      sawOpen: false,
      sawServerMessage: false,
      settled: false
    }
    let handlers: TerminalHandlers | null = null

    const cleanup = (): void => {
      clearLifecycleTimers(lifecycle)
      if (handlers !== null) {
        cleanupTerminalHandlers(socket, handlers.inputHandler, handlers.resizeHandler)
      }
      closeSocket(socket)
    }

    const finish = (effect: Effect.Effect<void, TerminalSessionClientError>): void => {
      if (lifecycle.settled) {
        return
      }
      lifecycle.settled = true
      cleanup()
      resume(effect)
    }

    const startAttachTimeout = (): void => {
      lifecycle.attachTimeout = clearTimer(lifecycle.attachTimeout)
      lifecycle.attachTimeout = setTimeout(() => {
        if (!lifecycle.settled && !lifecycle.sawServerMessage) {
          finish(Effect.fail(terminalSessionError("Terminal session attach timed out.")))
        }
      }, terminalAttachTimeoutMs)
    }

    handlers = createTerminalHandlers(
      attachment,
      socket,
      lifecycle,
      finish,
      () => lifecycle.sawExit,
      () => {
        lifecycle.sawExit = true
      },
      startAttachTimeout
    )

    lifecycle.openTimeout = setTimeout(() => {
      if (!lifecycle.settled && !lifecycle.sawOpen) {
        finish(Effect.fail(terminalSessionError("Terminal websocket open timed out.")))
      }
    }, terminalOpenTimeoutMs)

    socket.addEventListener("open", handlers.handleOpen)
    socket.addEventListener("message", handlers.handleMessage)
    socket.addEventListener("error", handlers.handleError)
    socket.addEventListener("close", handlers.handleClose)

    return Effect.sync(() => {
      if (!lifecycle.settled) {
        lifecycle.settled = true
        cleanup()
      }
    })
  })

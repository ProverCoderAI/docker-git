import * as ParseResult from "@effect/schema/ParseResult"
import { type TerminalServerMessage, TerminalServerMessageSchema } from "@prover-coder-ai/docker-git-terminal/contracts"
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

type TerminalFinish = (effect: Effect.Effect<void, TerminalSessionClientError>) => void

type TerminalHandlerContext = {
  readonly attachment: TerminalAttachment
  readonly finish: TerminalFinish
  readonly lifecycle: TerminalLifecycle
  readonly socket: WebSocket
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
  return apiBaseUrl.href
}

const sendResize = (socket: WebSocket): void => {
  const { cols, rows } = resolveTerminalSize()
  socket.send(encodeClientMessage({
    type: "resize",
    cols,
    rows
  }))
}

const setRawMode = (isEnabled: boolean): void => {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    process.stdin.setRawMode(isEnabled)
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

const createTerminalLifecycle = (): TerminalLifecycle => ({
  attachTimeout: null,
  openTimeout: null,
  sawExit: false,
  sawOpen: false,
  sawServerMessage: false,
  settled: false
})

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
  finish: TerminalFinish,
  lifecycle: TerminalLifecycle
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

  lifecycle.sawExit = true
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
  context: TerminalHandlerContext,
  streamHandlers: Pick<TerminalHandlers, "inputHandler" | "resizeHandler">,
  startAttachTimeout: () => void
) =>
(): void => {
  const { attachment, lifecycle, socket } = context
  if (lifecycle.settled) {
    return
  }

  lifecycle.sawOpen = true
  lifecycle.openTimeout = clearTimer(lifecycle.openTimeout)
  startAttachTimeout()
  writeHeader(attachment)
  process.stdin.resume()
  setRawMode(true)
  process.stdin.on("data", streamHandlers.inputHandler)
  process.stdout.on("resize", streamHandlers.resizeHandler)
  sendResize(socket)
}

const createTerminalMessageHandler = (
  lifecycle: TerminalLifecycle,
  finish: TerminalFinish
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
  handleTerminalServerMessage(message, finish, lifecycle)
}

const createTerminalErrorHandler = (
  lifecycle: TerminalLifecycle,
  finish: TerminalFinish
) =>
(): void => {
  if (lifecycle.settled) {
    return
  }
  finish(Effect.fail(terminalSessionError("Terminal websocket error.")))
}

const createTerminalCloseHandler = (
  lifecycle: TerminalLifecycle,
  finish: TerminalFinish
) =>
(): void => {
  if (lifecycle.settled) {
    return
  }

  if (!lifecycle.sawOpen || !lifecycle.sawServerMessage) {
    finish(Effect.fail(terminalSessionError("Terminal websocket closed before attach.")))
    return
  }

  if (!lifecycle.sawExit) {
    finish(Effect.fail(terminalSessionError("Terminal websocket closed before exit.")))
  }
}

const createTerminalHandlers = (
  context: TerminalHandlerContext,
  startAttachTimeout: () => void
): TerminalHandlers => {
  const { lifecycle, socket } = context
  const inputHandler = createTerminalInputHandler(socket)
  const resizeHandler = createTerminalResizeHandler(socket)
  const handleOpen = createTerminalOpenHandler(context, { inputHandler, resizeHandler }, startAttachTimeout)
  const handleMessage = createTerminalMessageHandler(lifecycle, context.finish)
  const handleError = createTerminalErrorHandler(lifecycle, context.finish)
  const handleClose = createTerminalCloseHandler(lifecycle, context.finish)
  return { handleClose, handleError, handleMessage, handleOpen, inputHandler, resizeHandler }
}

const cleanupTerminalAttachment = (
  socket: WebSocket,
  lifecycle: TerminalLifecycle,
  handlersRef: { current: TerminalHandlers | null }
): void => {
  clearLifecycleTimers(lifecycle)
  if (handlersRef.current !== null) {
    cleanupTerminalHandlers(socket, handlersRef.current.inputHandler, handlersRef.current.resizeHandler)
  }
  closeSocket(socket)
}

const createTerminalFinish = (
  lifecycle: TerminalLifecycle,
  cleanup: () => void,
  resume: TerminalFinish
): TerminalFinish =>
(effect) => {
  if (lifecycle.settled) {
    return
  }
  lifecycle.settled = true
  cleanup()
  resume(effect)
}

const startTerminalAttachTimeout = (lifecycle: TerminalLifecycle, finish: TerminalFinish): void => {
  lifecycle.attachTimeout = clearTimer(lifecycle.attachTimeout)
  lifecycle.attachTimeout = setTimeout(() => {
    if (!lifecycle.settled && !lifecycle.sawServerMessage) {
      finish(Effect.fail(terminalSessionError("Terminal session attach timed out.")))
    }
  }, terminalAttachTimeoutMs)
}

const startTerminalOpenTimeout = (lifecycle: TerminalLifecycle, finish: TerminalFinish): void => {
  lifecycle.openTimeout = setTimeout(() => {
    if (!lifecycle.settled && !lifecycle.sawOpen) {
      finish(Effect.fail(terminalSessionError("Terminal websocket open timed out.")))
    }
  }, terminalOpenTimeoutMs)
}

const registerTerminalSocketHandlers = (socket: WebSocket, handlers: TerminalHandlers): void => {
  socket.addEventListener("open", handlers.handleOpen)
  socket.addEventListener("message", handlers.handleMessage)
  socket.addEventListener("error", handlers.handleError)
  socket.addEventListener("close", handlers.handleClose)
}

const createTerminalCancel = (lifecycle: TerminalLifecycle, cleanup: () => void): Effect.Effect<void> =>
  Effect.sync(() => {
    if (lifecycle.settled) {
      return
    }

    lifecycle.settled = true
    cleanup()
  })

export const attachTerminalSession = (
  attachment: TerminalAttachment
): Effect.Effect<void, TerminalSessionClientError> =>
  Effect.async((resume) => {
    const socket = new WebSocket(resolveTerminalWebSocketUrl(attachment.websocketPath))
    const lifecycle = createTerminalLifecycle()
    const handlersRef: { current: TerminalHandlers | null } = { current: null }
    const cleanup = () => {
      cleanupTerminalAttachment(socket, lifecycle, handlersRef)
    }
    const finish = createTerminalFinish(lifecycle, cleanup, resume)
    const context: TerminalHandlerContext = { attachment, finish, lifecycle, socket }
    const startAttachTimeout = () => {
      startTerminalAttachTimeout(lifecycle, finish)
    }
    const handlers = createTerminalHandlers(context, startAttachTimeout)

    handlersRef.current = handlers
    startTerminalOpenTimeout(lifecycle, finish)
    registerTerminalSocketHandlers(socket, handlers)

    return createTerminalCancel(lifecycle, cleanup)
  })

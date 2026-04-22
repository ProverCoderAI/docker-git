import { Effect, Either } from "effect"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"

import { deleteTerminalSessionByPath } from "./api.js"
import type {
  TerminalCleanupArgs,
  TerminalLifecycleState,
  TerminalMessageHandlers,
  TerminalPasteGuard,
  TerminalRuntime,
  TerminalSocketConnectArgs,
  TerminalSocketListenerArgs,
  TerminalSocketRef
} from "./terminal-panel-runtime-types.js"
import { resolveTerminalReconnectDelay, terminalReconnectGraceMs } from "./terminal-reconnect.js"
import { parseTerminalServerMessage, resolveTerminalWebSocketUrl } from "./terminal.js"

type TerminalClientMessage =
  | { readonly data: string; readonly type: "input" }
  | { readonly cols: number; readonly rows: number; readonly type: "resize" }

const requestSessionClose = (closePath: string): void => {
  void Effect.runPromise(deleteTerminalSessionByPath(closePath).pipe(Effect.either, Effect.asVoid))
}

const runOptionalTerminalOperation = (operation: () => void): boolean =>
  Either.isRight(
    Effect.runSync(
      Effect.either(
        Effect.try({
          try: operation,
          catch: (error) => error
        })
      )
    )
  )

export const createLifecycleState = (): TerminalLifecycleState => ({
  attachedOnce: false,
  disposed: false,
  readyNotified: false,
  reconnectAttempt: 0,
  reconnectStartedAtMs: null,
  reconnectTimer: null,
  terminalEnded: false
})

const clearReconnectTimer = (lifecycle: TerminalLifecycleState): void => {
  if (lifecycle.reconnectTimer !== null) {
    clearTimeout(lifecycle.reconnectTimer)
    lifecycle.reconnectTimer = null
  }
}

export const createTerminalRuntime = (host: HTMLDivElement): TerminalRuntime => {
  const terminal = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
    fontSize: 14,
    theme: { background: "#080a0d", foreground: "#f4f7fb" }
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(host)
  fitAddon.fit()
  terminal.focus()
  return { fitAddon, terminal }
}

const createTerminalSocket = (
  session: TerminalSocketConnectArgs["session"],
  terminal: Terminal
): WebSocket => new WebSocket(resolveTerminalWebSocketUrl(session.websocketPath, terminal.cols, terminal.rows))

const sendTerminalClientMessage = (
  socketRef: TerminalSocketRef,
  message: TerminalClientMessage
): void => {
  const socket = socketRef.current
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(JSON.stringify(message))
}

export const sendTerminalResize = (
  fitAddon: FitAddon,
  socketRef: TerminalSocketRef,
  terminal: Terminal
): void => {
  if (
    !runOptionalTerminalOperation(() => {
      fitAddon.fit()
    })
  ) {
    return
  }
  sendTerminalClientMessage(socketRef, {
    cols: terminal.cols,
    rows: terminal.rows,
    type: "resize"
  })
}

export const observeTerminalResize = (
  host: HTMLDivElement,
  onResize: () => void
): ResizeObserver | null => {
  if (typeof ResizeObserver !== "function") {
    return null
  }
  const resizeObserver = new ResizeObserver(onResize)
  resizeObserver.observe(host)
  return resizeObserver
}

export const attachTerminalInput = (
  terminal: Terminal,
  socketRef: TerminalSocketRef,
  pasteGuard: TerminalPasteGuard
) =>
  terminal.onData((data) => {
    if (pasteGuard.shouldSuppressTerminalInput(data)) {
      return
    }
    sendTerminalClientMessage(socketRef, { data, type: "input" })
  })

const notifyTerminalReady = (
  handlers: TerminalMessageHandlers
): void => {
  handlers.lifecycle.attachedOnce = true
  handlers.connectionRef.current.opened = true
  handlers.lifecycle.reconnectAttempt = 0
  handlers.lifecycle.reconnectStartedAtMs = null
  clearReconnectTimer(handlers.lifecycle)
  handlers.setStatus("attached")
  if (handlers.lifecycle.readyNotified) {
    handlers.notifyMessage("Terminal reconnected.")
    return
  }
  handlers.lifecycle.readyNotified = true
  handlers.notifyMessage(handlers.session.readyMessage)
  handlers.session.onReady?.()
}

const endTerminalSession = (
  handlers: TerminalMessageHandlers,
  status: "error" | "exited",
  line: string,
  message: string
): void => {
  handlers.lifecycle.terminalEnded = true
  clearReconnectTimer(handlers.lifecycle)
  handlers.terminal.writeln(line)
  handlers.setStatus(status)
  handlers.notifyMessage(message)
  if (status === "exited") {
    handlers.session.onExit?.()
  }
}

const handleTerminalServerMessage = (
  handlers: TerminalMessageHandlers,
  payload: string
): void => {
  const message = parseTerminalServerMessage(payload)
  if (message === null) {
    endTerminalSession(handlers, "error", "\r\n[terminal protocol error]", "Terminal protocol error.")
    return
  }
  if (message.type === "ready") {
    notifyTerminalReady(handlers)
    return
  }
  if (message.type === "output") {
    handlers.terminal.write(message.data)
    return
  }
  if (message.type === "error") {
    endTerminalSession(handlers, "error", `\r\n[error] ${message.message}`, message.message)
    return
  }
  endTerminalSession(handlers, "exited", "\r\n[session ended]", handlers.session.exitMessage)
}

const attachTerminalSocketListeners = (
  { lifecycle, onClose, onError, onMessage, onOpen, socket }: TerminalSocketListenerArgs
): void => {
  socket.addEventListener("open", onOpen)
  socket.addEventListener("message", (event) => {
    onMessage(typeof event.data === "string" ? event.data : "")
  })
  socket.addEventListener("close", () => {
    onClose(socket)
  })
  socket.addEventListener("error", () => {
    if (!lifecycle.disposed) {
      onError(socket)
    }
  })
}

const closeSocket = (socket: WebSocket | null): void => {
  if (socket === null || socket.readyState === WebSocket.CLOSED) {
    return
  }
  runOptionalTerminalOperation(() => {
    socket.close()
  })
}

export const cleanupTerminalResources = (
  args: TerminalCleanupArgs
): void => {
  args.lifecycle.disposed = true
  clearReconnectTimer(args.lifecycle)
  args.removeImagePaste()
  args.removeInput()
  args.resizeObserver?.disconnect()
  args.removeResize()
  closeSocket(args.socketRef.current)
  args.socketRef.current = null
  args.terminal.dispose()
  if (!args.connectionRef.current.opened && !args.connectionRef.current.closing) {
    requestSessionClose(args.session.closePath)
    args.notifyMessage(args.session.pendingDeleteMessage)
    args.session.onExit?.()
  }
}

export const createMessageHandlers = (
  args:
    & Omit<TerminalMessageHandlers, "terminal">
    & { readonly terminal: Terminal }
): TerminalMessageHandlers => args

const failBeforeAttach = (
  args: TerminalSocketConnectArgs,
  terminalLine: string,
  uiMessage: string
): void => {
  args.lifecycle.terminalEnded = true
  clearReconnectTimer(args.lifecycle)
  args.terminal.writeln(`\r\n${terminalLine}`)
  args.setStatus("error")
  args.notifyMessage(uiMessage)
  requestSessionClose(args.session.closePath)
}

const scheduleReconnect = (args: TerminalSocketConnectArgs): void => {
  if (args.lifecycle.disposed || args.lifecycle.terminalEnded) {
    return
  }
  const startedAt = args.lifecycle.reconnectStartedAtMs ?? Date.now()
  args.lifecycle.reconnectStartedAtMs = startedAt
  if (Date.now() - startedAt >= terminalReconnectGraceMs) {
    failBeforeAttach(args, "[terminal reconnect failed]", "Terminal reconnect failed.")
    return
  }
  if (args.lifecycle.reconnectAttempt === 0) {
    args.terminal.writeln("\r\n[terminal connection lost; reconnecting]")
    args.notifyMessage("Terminal connection lost. Reconnecting...")
  }
  args.setStatus("reconnecting")
  const delayMs = resolveTerminalReconnectDelay(args.lifecycle.reconnectAttempt)
  args.lifecycle.reconnectAttempt += 1
  clearReconnectTimer(args.lifecycle)
  args.lifecycle.reconnectTimer = setTimeout(args.reconnect, delayMs)
}

const handleSocketClose = (
  args: TerminalSocketConnectArgs,
  closedSocket: WebSocket
): void => {
  if (args.socketRef.current !== closedSocket) {
    return
  }
  args.socketRef.current = null
  if (args.lifecycle.disposed || args.lifecycle.terminalEnded) {
    return
  }
  if (!args.lifecycle.attachedOnce) {
    failBeforeAttach(args, "[websocket closed before attach]", "Terminal websocket closed before attach.")
    return
  }
  scheduleReconnect(args)
}
const handleSocketError = (
  args: TerminalSocketConnectArgs,
  failedSocket: WebSocket
): void => {
  if (args.socketRef.current !== failedSocket || args.lifecycle.attachedOnce) {
    return
  }
  failBeforeAttach(args, "[websocket error]", "Terminal websocket error.")
}
export const connectTerminalSocket = (args: TerminalSocketConnectArgs): void => {
  if (args.lifecycle.disposed || args.lifecycle.terminalEnded) {
    return
  }
  const socket = createTerminalSocket(args.session, args.terminal)
  args.socketRef.current = socket
  attachTerminalSocketListeners({
    lifecycle: args.lifecycle,
    onClose: (closedSocket) => {
      handleSocketClose(args, closedSocket)
    },
    onError: (failedSocket) => {
      handleSocketError(args, failedSocket)
    },
    onMessage: (payload) => {
      handleTerminalServerMessage(args.handlers, payload)
    },
    onOpen: args.sendResize,
    socket
  })
}

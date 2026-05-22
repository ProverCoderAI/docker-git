import { Either } from "effect"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"

import { enqueueTerminalOutput } from "./terminal-panel-inline-images-runtime.js"
import { sendTerminalClientMessage } from "./terminal-panel-input.js"
import { runOptionalTerminalOperation } from "./terminal-panel-optional-operation.js"
import type {
  TerminalExitInfo,
  TerminalInputController,
  TerminalLifecycleState,
  TerminalMessageHandlers,
  TerminalRuntime,
  TerminalSocketConnectArgs,
  TerminalSocketListenerArgs,
  TerminalSocketRef
} from "./terminal-panel-runtime-types.js"
import { installTerminalQuerySuppression, type TerminalQuerySuppressionOptions } from "./terminal-query-suppression.js"
import { resolveTerminalReconnectDelay, terminalReconnectGraceMs } from "./terminal-reconnect.js"
import { parseTerminalServerMessage, resolveTerminalWebSocketUrl } from "./terminal.js"

export { cleanupTerminalResources } from "./terminal-panel-cleanup-runtime.js"
export { attachTerminalInput, isTerminalMouseReportInput } from "./terminal-panel-input.js"

type TerminalRuntimeOptions = {
  readonly querySuppression?: TerminalQuerySuppressionOptions
}

export const createLifecycleState = (): TerminalLifecycleState => ({
  attachedOnce: false,
  disposed: false,
  inlineImageDisposables: [],
  inlineImageObjectUrls: new Map<string, string>(),
  outputQueue: [],
  outputWriting: false,
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

export const createTerminalRuntime = (
  host: HTMLDivElement,
  options: TerminalRuntimeOptions = {}
): TerminalRuntime => {
  const terminal = new Terminal({
    allowProposedApi: true,
    convertEol: false,
    cursorBlink: true,
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
    fontSize: 14,
    macOptionClickForcesSelection: true,
    scrollback: 50_000,
    scrollOnUserInput: false,
    theme: { background: "#080a0d", foreground: "#f4f7fb" }
  })
  installTerminalQuerySuppression(terminal, options.querySuppression)
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(host)
  fitAddon.fit()
  terminal.focus()
  return { fitAddon, terminal }
}

export const createTerminalInputController = (
  terminal: Terminal,
  socketRef: TerminalSocketRef
): TerminalInputController => ({
  focus: () => {
    terminal.focus()
  },
  sendInput: (data: string) => {
    if (data.length === 0) {
      return
    }
    sendTerminalClientMessage(socketRef, { data, type: "input" })
  }
})

const createTerminalSocket = (
  session: TerminalSocketConnectArgs["session"],
  terminal: Terminal
): WebSocket => new WebSocket(resolveTerminalWebSocketUrl(session.websocketPath, terminal.cols, terminal.rows))

export const sendTerminalResize = (
  fitAddon: FitAddon,
  socketRef: TerminalSocketRef,
  terminal: Terminal
): void => {
  const fitResult = runOptionalTerminalOperation(() => {
    fitAddon.fit()
  })
  if (Either.isLeft(fitResult)) {
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
  message: string,
  exitInfo?: TerminalExitInfo
): void => {
  handlers.lifecycle.terminalEnded = true
  clearReconnectTimer(handlers.lifecycle)
  handlers.terminal.writeln(line)
  handlers.setStatus(status)
  handlers.notifyMessage(message)
  if (status === "exited") {
    if (exitInfo !== undefined) {
      handlers.notifyExit(exitInfo)
    }
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
    enqueueTerminalOutput(handlers, message.data)
    return
  }
  if (message.type === "error") {
    endTerminalSession(handlers, "error", `\r\n[error] ${message.message}`, message.message)
    return
  }
  endTerminalSession(handlers, "exited", "\r\n[session ended]", handlers.session.exitMessage, {
    exitCode: message.exitCode,
    signal: message.signal
  })
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
  args.handlers.connectionRef.current.closing = true
  if (!args.lifecycle.attachedOnce) {
    args.onAttachFailure()
  }
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

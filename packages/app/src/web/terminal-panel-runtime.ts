import { Effect } from "effect"
import { useEffect } from "react"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"

import { deleteTerminalSessionByPath } from "./api.js"
import type { ActiveTerminalSession } from "./terminal.js"
import { parseTerminalServerMessage, resolveTerminalWebSocketUrl } from "./terminal.js"
import { resolveTerminalReconnectDelay, terminalReconnectGraceMs } from "./terminal-reconnect.js"

export type TerminalStatus = "attached" | "connecting" | "error" | "exited" | "reconnecting"

export type TerminalConnectionState = { closing: boolean; opened: boolean }

type TerminalRuntime = { readonly fitAddon: FitAddon; readonly terminal: Terminal }

type TerminalLifecycleState = {
  attachedOnce: boolean
  disposed: boolean
  readyNotified: boolean
  reconnectAttempt: number
  reconnectStartedAtMs: number | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  terminalEnded: boolean
}

type TerminalSocketRef = { current: WebSocket | null }

type TerminalMessageHandlers = {
  readonly connectionRef: { current: TerminalConnectionState }
  readonly lifecycle: TerminalLifecycleState
  readonly notifyMessage: (message: string) => void
  readonly session: ActiveTerminalSession
  readonly setStatus: (status: TerminalStatus) => void
  readonly terminal: Terminal
}

type TerminalCleanupArgs = {
  readonly connectionRef: { current: TerminalConnectionState }
  readonly lifecycle: TerminalLifecycleState
  readonly notifyMessage: (message: string) => void
  readonly removeInput: () => void
  readonly removeResize: () => void
  readonly resizeObserver: ResizeObserver | null
  readonly session: ActiveTerminalSession
  readonly socketRef: TerminalSocketRef
  readonly terminal: Terminal
}

type TerminalLifecycleArgs = {
  readonly connectionRef: { current: TerminalConnectionState }
  readonly hostRef: { readonly current: HTMLDivElement | null }
  readonly notifyMessage: (message: string) => void
  readonly session: ActiveTerminalSession
  readonly setStatus: (status: TerminalStatus) => void
}

type TerminalSocketListenerArgs = {
  readonly lifecycle: TerminalLifecycleState
  readonly onClose: (socket: WebSocket) => void
  readonly onError: (socket: WebSocket) => void
  readonly onMessage: (payload: string) => void
  readonly onOpen: () => void
  readonly socket: WebSocket
}

const requestSessionClose = (closePath: string): void => {
  void Effect.runPromise(deleteTerminalSessionByPath(closePath).pipe(Effect.either, Effect.asVoid))
}

const createLifecycleState = (): TerminalLifecycleState => ({
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

const createTerminalRuntime = (host: HTMLDivElement): TerminalRuntime => {
  const terminal = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
    fontSize: 14,
    theme: {
      background: "#080a0d",
      foreground: "#f4f7fb"
    }
  })
  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(host)
  fitAddon.fit()
  terminal.focus()
  return { fitAddon, terminal }
}

const createTerminalSocket = (
  session: ActiveTerminalSession,
  terminal: Terminal
): WebSocket => new WebSocket(resolveTerminalWebSocketUrl(session.websocketPath, terminal.cols, terminal.rows))

const sendTerminalResize = (
  fitAddon: FitAddon,
  socketRef: TerminalSocketRef,
  terminal: Terminal
): void => {
  try {
    fitAddon.fit()
  } catch {
    return
  }
  const socket = socketRef.current
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(JSON.stringify({
    cols: terminal.cols,
    rows: terminal.rows,
    type: "resize"
  }))
}

const observeTerminalResize = (
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

const attachTerminalInput = (
  terminal: Terminal,
  socketRef: TerminalSocketRef
) =>
  terminal.onData((data) => {
    const socket = socketRef.current
    if (socket === null || socket.readyState !== WebSocket.OPEN) {
      return
    }
    socket.send(JSON.stringify({ data, type: "input" }))
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

const handleTerminalServerMessage = (
  handlers: TerminalMessageHandlers,
  payload: string
): void => {
  const message = parseTerminalServerMessage(payload)
  if (message === null) {
    handlers.lifecycle.terminalEnded = true
    clearReconnectTimer(handlers.lifecycle)
    handlers.terminal.writeln("\r\n[terminal protocol error]")
    handlers.setStatus("error")
    handlers.notifyMessage("Terminal protocol error.")
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
    handlers.lifecycle.terminalEnded = true
    clearReconnectTimer(handlers.lifecycle)
    handlers.terminal.writeln(`\r\n[error] ${message.message}`)
    handlers.setStatus("error")
    handlers.notifyMessage(message.message)
    return
  }
  handlers.lifecycle.terminalEnded = true
  clearReconnectTimer(handlers.lifecycle)
  handlers.terminal.writeln("\r\n[session ended]")
  handlers.setStatus("exited")
  handlers.notifyMessage(handlers.session.exitMessage)
  handlers.session.onExit?.()
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
  try {
    socket.close()
  } catch {
    return
  }
}

const cleanupTerminalResources = (
  {
    connectionRef,
    lifecycle,
    notifyMessage,
    removeInput,
    removeResize,
    resizeObserver,
    session,
    socketRef,
    terminal
  }: TerminalCleanupArgs
): void => {
  lifecycle.disposed = true
  clearReconnectTimer(lifecycle)
  removeInput()
  resizeObserver?.disconnect()
  removeResize()
  closeSocket(socketRef.current)
  socketRef.current = null
  terminal.dispose()
  if (!connectionRef.current.opened && !connectionRef.current.closing) {
    requestSessionClose(session.closePath)
    notifyMessage(session.pendingDeleteMessage)
    session.onExit?.()
  }
}

const createMessageHandlers = (
  connectionRef: { current: TerminalConnectionState },
  lifecycle: TerminalLifecycleState,
  notifyMessage: (message: string) => void,
  session: ActiveTerminalSession,
  setStatus: (status: TerminalStatus) => void,
  terminal: Terminal
): TerminalMessageHandlers => ({
  connectionRef,
  lifecycle,
  notifyMessage,
  session,
  setStatus,
  terminal
})

const failBeforeAttach = (
  lifecycle: TerminalLifecycleState,
  notifyMessage: (message: string) => void,
  session: ActiveTerminalSession,
  setStatus: (status: TerminalStatus) => void,
  terminal: Terminal,
  terminalLine: string,
  uiMessage: string
): void => {
  lifecycle.terminalEnded = true
  clearReconnectTimer(lifecycle)
  terminal.writeln(`\r\n${terminalLine}`)
  setStatus("error")
  notifyMessage(uiMessage)
  requestSessionClose(session.closePath)
}

const scheduleReconnect = (
  connectSocket: () => void,
  lifecycle: TerminalLifecycleState,
  notifyMessage: (message: string) => void,
  session: ActiveTerminalSession,
  setStatus: (status: TerminalStatus) => void,
  terminal: Terminal
): void => {
  if (lifecycle.disposed || lifecycle.terminalEnded) {
    return
  }
  const startedAt = lifecycle.reconnectStartedAtMs ?? Date.now()
  lifecycle.reconnectStartedAtMs = startedAt
  const elapsedMs = Date.now() - startedAt
  if (elapsedMs >= terminalReconnectGraceMs) {
    lifecycle.terminalEnded = true
    clearReconnectTimer(lifecycle)
    terminal.writeln("\r\n[terminal reconnect failed]")
    setStatus("error")
    notifyMessage("Terminal reconnect failed.")
    requestSessionClose(session.closePath)
    return
  }
  if (lifecycle.reconnectAttempt === 0) {
    terminal.writeln("\r\n[terminal connection lost; reconnecting]")
    notifyMessage("Terminal connection lost. Reconnecting...")
  }
  setStatus("reconnecting")
  const delayMs = resolveTerminalReconnectDelay(lifecycle.reconnectAttempt)
  lifecycle.reconnectAttempt += 1
  clearReconnectTimer(lifecycle)
  lifecycle.reconnectTimer = setTimeout(connectSocket, delayMs)
}

const mountTerminalSession = (
  { connectionRef, hostRef, notifyMessage, session, setStatus }: TerminalLifecycleArgs
): (() => void) | undefined => {
  const host = hostRef.current
  if (host === null) {
    return undefined
  }

  connectionRef.current = { closing: false, opened: false }
  const lifecycle = createLifecycleState()
  const socketRef: TerminalSocketRef = { current: null }
  const { fitAddon, terminal } = createTerminalRuntime(host)
  const sendResize = () => {
    sendTerminalResize(fitAddon, socketRef, terminal)
  }
  const resizeObserver = observeTerminalResize(host, sendResize)
  const inputDisposable = attachTerminalInput(terminal, socketRef)
  const handlers = createMessageHandlers(
    connectionRef,
    lifecycle,
    notifyMessage,
    session,
    setStatus,
    terminal
  )

  const connectSocket = () => {
    if (lifecycle.disposed || lifecycle.terminalEnded) {
      return
    }
    const socket = createTerminalSocket(session, terminal)
    socketRef.current = socket
    attachTerminalSocketListeners({
      lifecycle,
      onClose: (closedSocket) => {
        if (socketRef.current !== closedSocket) {
          return
        }
        socketRef.current = null
        if (lifecycle.disposed || lifecycle.terminalEnded) {
          return
        }
        if (!lifecycle.attachedOnce) {
          failBeforeAttach(
            lifecycle,
            notifyMessage,
            session,
            setStatus,
            terminal,
            "[websocket closed before attach]",
            "Terminal websocket closed before attach."
          )
          return
        }
        scheduleReconnect(connectSocket, lifecycle, notifyMessage, session, setStatus, terminal)
      },
      onError: (failedSocket) => {
        if (socketRef.current !== failedSocket || lifecycle.attachedOnce) {
          return
        }
        failBeforeAttach(
          lifecycle,
          notifyMessage,
          session,
          setStatus,
          terminal,
          "[websocket error]",
          "Terminal websocket error."
        )
      },
      onMessage: (payload) => {
        handleTerminalServerMessage(handlers, payload)
      },
      onOpen: sendResize,
      socket
    })
  }

  globalThis.addEventListener("resize", sendResize)
  connectSocket()

  return () => {
    cleanupTerminalResources({
      connectionRef,
      lifecycle,
      notifyMessage,
      removeInput: () => {
        inputDisposable.dispose()
      },
      removeResize: () => {
        globalThis.removeEventListener("resize", sendResize)
      },
      resizeObserver,
      session,
      socketRef,
      terminal
    })
  }
}

export const useTerminalSessionLifecycle = (
  { connectionRef, hostRef, notifyMessage, session, setStatus }: TerminalLifecycleArgs
): void => {
  useEffect(() => {
    return mountTerminalSession({
      connectionRef,
      hostRef,
      notifyMessage,
      session,
      setStatus
    })
  }, [connectionRef, hostRef, notifyMessage, session, setStatus])
}

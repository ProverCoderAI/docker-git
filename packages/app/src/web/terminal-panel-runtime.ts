import { Effect } from "effect"
import { useEffect } from "react"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"

import { deleteTerminalSessionByPath } from "./api.js"
import type { ActiveTerminalSession } from "./terminal.js"
import { parseTerminalServerMessage, resolveTerminalWebSocketUrl } from "./terminal.js"

export type TerminalStatus = "attached" | "connecting" | "error" | "exited"

export type TerminalConnectionState = {
  opened: boolean
}

type TerminalRuntime = {
  readonly fitAddon: FitAddon
  readonly terminal: Terminal
}

type TerminalMessageHandlers = {
  readonly notifyMessage: (message: string) => void
  readonly session: ActiveTerminalSession
  readonly setStatus: (status: TerminalStatus) => void
  readonly terminal: Terminal
}

type TerminalCleanupArgs = {
  readonly removeInput: () => void
  readonly removeResize: () => void
  readonly resizeObserver: ResizeObserver | null
  readonly socket: WebSocket
  readonly terminal: Terminal
}

type TerminalLifecycleArgs = {
  readonly connectionRef: { current: TerminalConnectionState }
  readonly hostRef: { readonly current: HTMLDivElement | null }
  readonly notifyMessage: (message: string) => void
  readonly session: ActiveTerminalSession
  readonly setStatus: (status: TerminalStatus) => void
}

const requestSessionClose = (closePath: string): void => {
  void Effect.runPromise(deleteTerminalSessionByPath(closePath).pipe(Effect.either, Effect.asVoid))
}

const createTerminalRuntime = (host: HTMLDivElement): TerminalRuntime => {
  const terminal = new Terminal({
    convertEol: false,
    cursorBlink: true,
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
    fontSize: 14,
    theme: {
      background: "#050b14",
      foreground: "#d6e5f7"
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
): WebSocket =>
  new WebSocket(
    resolveTerminalWebSocketUrl(
      session.websocketPath,
      terminal.cols,
      terminal.rows
    )
  )

const sendTerminalResize = (
  fitAddon: FitAddon,
  socket: WebSocket,
  terminal: Terminal
): void => {
  fitAddon.fit()
  if (socket.readyState !== WebSocket.OPEN) {
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
  const resizeObserver = new ResizeObserver(() => {
    onResize()
  })
  resizeObserver.observe(host)
  return resizeObserver
}

const attachTerminalInput = (
  terminal: Terminal,
  socket: WebSocket
) =>
  terminal.onData((data) => {
    if (socket.readyState !== WebSocket.OPEN) {
      return
    }
    socket.send(JSON.stringify({ data, type: "input" }))
  })

const handleTerminalServerMessage = (
  handlers: TerminalMessageHandlers,
  payload: string
): void => {
  const message = parseTerminalServerMessage(payload)
  if (message === null) {
    handlers.terminal.writeln("\r\n[terminal protocol error]")
    handlers.setStatus("error")
    handlers.notifyMessage("Terminal protocol error.")
    return
  }
  if (message.type === "ready") {
    handlers.setStatus("attached")
    handlers.notifyMessage(handlers.session.readyMessage)
    handlers.session.onReady?.()
    return
  }
  if (message.type === "output") {
    handlers.terminal.write(message.data)
    return
  }
  if (message.type === "error") {
    handlers.terminal.writeln(`\r\n[error] ${message.message}`)
    handlers.setStatus("error")
    handlers.notifyMessage(message.message)
    return
  }
  handlers.terminal.writeln("\r\n[session ended]")
  handlers.setStatus("exited")
  handlers.notifyMessage(handlers.session.exitMessage)
  handlers.session.onExit?.()
}

const attachTerminalSocketListeners = (
  connectionRef: { current: TerminalConnectionState },
  socket: WebSocket,
  onOpen: () => void,
  onMessage: (payload: string) => void,
  onError: () => void
): void => {
  socket.addEventListener("open", () => {
    connectionRef.current.opened = true
    onOpen()
  })
  socket.addEventListener("message", (event) => {
    onMessage(typeof event.data === "string" ? event.data : "")
  })
  socket.addEventListener("error", onError)
}

const cleanupTerminalResources = (
  { removeInput, removeResize, resizeObserver, socket, terminal }: TerminalCleanupArgs
): void => {
  removeInput()
  resizeObserver?.disconnect()
  removeResize()
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "close" }))
  }
  socket.close()
  terminal.dispose()
}

const createMessageHandlers = (
  notifyMessage: (message: string) => void,
  session: ActiveTerminalSession,
  setStatus: (status: TerminalStatus) => void,
  terminal: Terminal
): TerminalMessageHandlers => ({
  notifyMessage,
  session,
  setStatus,
  terminal
})

const createSocketErrorHandler = (
  notifyMessage: (message: string) => void,
  setStatus: (status: TerminalStatus) => void,
  terminal: Terminal
) =>
() => {
  terminal.writeln("\r\n[websocket error]")
  setStatus("error")
  notifyMessage("Terminal websocket error.")
}

const maybeDeletePendingSession = (
  connectionRef: { current: TerminalConnectionState },
  notifyMessage: (message: string) => void,
  session: ActiveTerminalSession
): void => {
  if (!connectionRef.current.opened) {
    requestSessionClose(session.closePath)
    notifyMessage(session.pendingDeleteMessage)
    session.onExit?.()
  }
}

const mountTerminalSession = (
  { connectionRef, hostRef, notifyMessage, session, setStatus }: TerminalLifecycleArgs
): (() => void) | undefined => {
  const host = hostRef.current
  if (host === null) {
    return undefined
  }

  connectionRef.current = { opened: false }
  const { fitAddon, terminal } = createTerminalRuntime(host)
  const socket = createTerminalSocket(session, terminal)
  const sendResize = () => {
    sendTerminalResize(fitAddon, socket, terminal)
  }
  const resizeObserver = observeTerminalResize(host, sendResize)
  const inputDisposable = attachTerminalInput(terminal, socket)
  const handlers = createMessageHandlers(
    notifyMessage,
    session,
    setStatus,
    terminal
  )

  globalThis.addEventListener("resize", sendResize)
  attachTerminalSocketListeners(
    connectionRef,
    socket,
    sendResize,
    (payload) => {
      handleTerminalServerMessage(handlers, payload)
    },
    createSocketErrorHandler(notifyMessage, setStatus, terminal)
  )

  return () => {
    cleanupTerminalResources({
      removeInput: () => {
        inputDisposable.dispose()
      },
      removeResize: () => {
        globalThis.removeEventListener("resize", sendResize)
      },
      resizeObserver,
      socket,
      terminal
    })
    maybeDeletePendingSession(connectionRef, notifyMessage, session)
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
  }, [connectionRef, hostRef, session, setStatus])
}

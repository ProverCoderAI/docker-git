import type { Terminal } from "xterm"
import type { FitAddon } from "xterm-addon-fit"

import type { ActiveTerminalSession } from "./terminal.js"

export type TerminalStatus = "attached" | "connecting" | "error" | "exited" | "reconnecting"

export type TerminalConnectionState = { closing: boolean; opened: boolean }

export type TerminalRuntime = { readonly fitAddon: FitAddon; readonly terminal: Terminal }

export type TerminalLifecycleState = {
  attachedOnce: boolean
  disposed: boolean
  readyNotified: boolean
  reconnectAttempt: number
  reconnectStartedAtMs: number | null
  reconnectTimer: ReturnType<typeof setTimeout> | null
  terminalEnded: boolean
}

export type TerminalSocketRef = { current: WebSocket | null }

export type TerminalPasteGuard = {
  readonly shouldSuppressTerminalInput: (data: string) => boolean
  readonly suppressNextNativeImagePaste: () => void
}

export type TerminalMessageHandlers = {
  readonly connectionRef: { current: TerminalConnectionState }
  readonly lifecycle: TerminalLifecycleState
  readonly notifyMessage: (message: string) => void
  readonly session: ActiveTerminalSession
  readonly setStatus: (status: TerminalStatus) => void
  readonly terminal: Terminal
}

export type TerminalCleanupArgs = {
  readonly connectionRef: { current: TerminalConnectionState }
  readonly lifecycle: TerminalLifecycleState
  readonly notifyMessage: (message: string) => void
  readonly removeImagePaste: () => void
  readonly removeInput: () => void
  readonly removeResize: () => void
  readonly resizeObserver: ResizeObserver | null
  readonly session: ActiveTerminalSession
  readonly socketRef: TerminalSocketRef
  readonly terminal: Terminal
}

export type TerminalLifecycleArgs = {
  readonly connectionRef: { current: TerminalConnectionState }
  readonly hostRef: { readonly current: HTMLDivElement | null }
  readonly notifyMessage: (message: string) => void
  readonly session: ActiveTerminalSession
  readonly setStatus: (status: TerminalStatus) => void
}

export type TerminalSocketListenerArgs = {
  readonly lifecycle: TerminalLifecycleState
  readonly onClose: (socket: WebSocket) => void
  readonly onError: (socket: WebSocket) => void
  readonly onMessage: (payload: string) => void
  readonly onOpen: () => void
  readonly socket: WebSocket
}

export type TerminalSocketConnectArgs = {
  readonly handlers: TerminalMessageHandlers
  readonly lifecycle: TerminalLifecycleState
  readonly notifyMessage: (message: string) => void
  readonly reconnect: () => void
  readonly sendResize: () => void
  readonly session: ActiveTerminalSession
  readonly setStatus: (status: TerminalStatus) => void
  readonly socketRef: TerminalSocketRef
  readonly terminal: Terminal
}

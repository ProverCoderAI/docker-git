import { useEffect } from "react"

import { attachTerminalImagePaste, createTerminalPasteGuard } from "./terminal-image-paste.js"
import {
  attachTerminalInput,
  cleanupTerminalResources,
  connectTerminalSocket,
  createLifecycleState,
  createMessageHandlers,
  createTerminalRuntime,
  observeTerminalResize,
  sendTerminalResize
} from "./terminal-panel-runtime-core.js"
import type {
  TerminalLifecycleArgs,
  TerminalSocketConnectArgs,
  TerminalSocketRef
} from "./terminal-panel-runtime-types.js"

type TerminalCleanupFactoryArgs = {
  readonly cleanupArgs: Omit<
    Parameters<typeof cleanupTerminalResources>[0],
    "removeImagePaste" | "removeInput" | "removeResize"
  >
  readonly imagePasteDisposable: { readonly dispose: () => void }
  readonly inputDisposable: { readonly dispose: () => void }
  readonly sendResize: () => void
}

const createTerminalCleanup = (
  { cleanupArgs, imagePasteDisposable, inputDisposable, sendResize }: TerminalCleanupFactoryArgs
): () => void =>
(): void => {
  cleanupTerminalResources({
    ...cleanupArgs,
    removeImagePaste: () => {
      imagePasteDisposable.dispose()
    },
    removeInput: () => {
      inputDisposable.dispose()
    },
    removeResize: () => {
      globalThis.removeEventListener("resize", sendResize)
    }
  })
}

const createConnectSocket = (
  args: Omit<TerminalSocketConnectArgs, "reconnect">
): () => void => {
  const connectSocket = () => {
    connectTerminalSocket({ ...args, reconnect: connectSocket })
  }
  return connectSocket
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
  const pasteGuard = createTerminalPasteGuard()
  const sendResize = () => {
    sendTerminalResize(fitAddon, socketRef, terminal)
  }
  const resizeObserver = observeTerminalResize(host, sendResize)
  const inputDisposable = attachTerminalInput(terminal, socketRef, pasteGuard)
  const imagePasteDisposable = attachTerminalImagePaste({ host, notifyMessage, pasteGuard, socketRef, terminal })
  const handlers = createMessageHandlers({ connectionRef, lifecycle, notifyMessage, session, setStatus, terminal })
  const connectSocket = createConnectSocket({
    handlers,
    lifecycle,
    notifyMessage,
    sendResize,
    session,
    setStatus,
    socketRef,
    terminal
  })

  globalThis.addEventListener("resize", sendResize)
  connectSocket()

  return createTerminalCleanup({
    cleanupArgs: { connectionRef, lifecycle, notifyMessage, resizeObserver, session, socketRef, terminal },
    imagePasteDisposable,
    inputDisposable,
    sendResize
  })
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

export { type TerminalConnectionState, type TerminalStatus } from "./terminal-panel-runtime-types.js"

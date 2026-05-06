import { useEffect } from "react"

import { attachTerminalImagePaste, createTerminalPasteGuard } from "./terminal-image-paste.js"
import { attachTerminalImageLinks } from "./terminal-inline-images.js"
import {
  attachTerminalInput,
  cleanupTerminalResources,
  connectTerminalSocket,
  createLifecycleState,
  createTerminalInputController,
  createTerminalRuntime,
  observeTerminalResize,
  sendTerminalResize
} from "./terminal-panel-runtime-core.js"
import type {
  TerminalLifecycleArgs,
  TerminalMessageHandlers,
  TerminalSocketConnectArgs,
  TerminalSocketRef
} from "./terminal-panel-runtime-types.js"
import { isPendingActiveTerminalSession } from "./terminal.js"

type TerminalCleanupFactoryArgs = {
  readonly cleanupArgs: Omit<
    Parameters<typeof cleanupTerminalResources>[0],
    "removeImageLinks" | "removeImagePaste" | "removeInput" | "removeResize"
  >
  readonly imageLinkDisposable: { readonly dispose: () => void }
  readonly imagePasteDisposable: { readonly dispose: () => void }
  readonly inputDisposable: { readonly dispose: () => void }
  readonly sendResize: () => void
}

const createTerminalCleanup = (
  { cleanupArgs, imageLinkDisposable, imagePasteDisposable, inputDisposable, sendResize }: TerminalCleanupFactoryArgs
): () => void =>
(): void => {
  cleanupTerminalResources({
    ...cleanupArgs,
    removeImageLinks: () => {
      imageLinkDisposable.dispose()
    },
    removeImagePaste: () => {
      imagePasteDisposable.dispose()
    },
    removeInput: () => {
      inputDisposable.dispose()
    },
    removeResize: () => {
      globalThis.removeEventListener("resize", sendResize)
      globalThis.visualViewport?.removeEventListener("resize", sendResize)
      globalThis.visualViewport?.removeEventListener("scroll", sendResize)
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

const attachGlobalResizeListeners = (sendResize: () => void): void => {
  globalThis.addEventListener("resize", sendResize)
  globalThis.visualViewport?.addEventListener("resize", sendResize)
  globalThis.visualViewport?.addEventListener("scroll", sendResize)
}

const resolveMountHost = (
  { hostRef, session }: Pick<TerminalLifecycleArgs, "hostRef" | "session">
): HTMLDivElement | null => {
  if (isPendingActiveTerminalSession(session)) {
    return null
  }
  return hostRef.current
}

const mountTerminalSession = (
  { connectionRef, hostRef, notifyMessage, onAttachFailure, runtimeRef, session, setStatus }: TerminalLifecycleArgs
): (() => void) | undefined => {
  const host = resolveMountHost({ hostRef, session })
  if (host === null) {
    return undefined
  }

  connectionRef.current = { closing: false, opened: false }
  const lifecycle = createLifecycleState()
  const socketRef: TerminalSocketRef = { current: null }
  const { fitAddon, terminal } = createTerminalRuntime(host)
  const terminalInputController = createTerminalInputController(terminal, socketRef)
  const pasteGuard = createTerminalPasteGuard()
  const sendResize = () => {
    sendTerminalResize(fitAddon, socketRef, terminal)
  }
  const resizeObserver = observeTerminalResize(host, sendResize)
  const inputDisposable = attachTerminalInput(terminal, socketRef, pasteGuard)
  const imagePasteDisposable = attachTerminalImagePaste({ host, notifyMessage, pasteGuard, socketRef, terminal })
  const imageLinkDisposable = attachTerminalImageLinks(terminal, session)
  const handlers: TerminalMessageHandlers = {
    connectionRef,
    lifecycle,
    notifyMessage,
    session,
    setStatus,
    terminal
  }
  const connectSocket = createConnectSocket({
    handlers,
    lifecycle,
    notifyMessage,
    onAttachFailure,
    sendResize,
    session,
    setStatus,
    socketRef,
    terminal
  })

  runtimeRef.current = terminalInputController
  attachGlobalResizeListeners(sendResize)
  connectSocket()

  return createTerminalCleanup({
    cleanupArgs: { connectionRef, lifecycle, notifyMessage, resizeObserver, runtimeRef, session, socketRef, terminal },
    imageLinkDisposable,
    imagePasteDisposable,
    inputDisposable,
    sendResize
  })
}

export const useTerminalSessionLifecycle = (
  { connectionRef, hostRef, notifyMessage, onAttachFailure, runtimeRef, session, setStatus }: TerminalLifecycleArgs
): void => {
  useEffect(() => {
    return mountTerminalSession({
      connectionRef,
      hostRef,
      notifyMessage,
      onAttachFailure,
      runtimeRef,
      session,
      setStatus
    })
  }, [connectionRef, hostRef, notifyMessage, onAttachFailure, runtimeRef, session, setStatus])
}

export {
  type TerminalConnectionState,
  type TerminalInputController,
  type TerminalStatus
} from "./terminal-panel-runtime-types.js"

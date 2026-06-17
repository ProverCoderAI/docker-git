import { useEffect } from "react"

import { attachTerminalCopyInteraction } from "./terminal-copy-interaction.js"
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
  TerminalLifecycleState,
  TerminalMessageHandlers,
  TerminalPasteGuard,
  TerminalSocketConnectArgs,
  TerminalSocketRef
} from "./terminal-panel-runtime-types.js"
import { shouldAllowTerminalMouseTracking, shouldSuppressTerminalAlternateScreen } from "./terminal-screen-policy.js"
import { attachTerminalWheelScroll } from "./terminal-wheel-scroll.js"
import { isPendingActiveTerminalSession } from "./terminal.js"

type TerminalDisposable = { readonly dispose: () => void }

type TerminalCleanupFactoryArgs = {
  readonly cleanupArgs: Omit<
    Parameters<typeof cleanupTerminalResources>[0],
    "removeImageLinks" | "removeImagePaste" | "removeInput" | "removeResize"
  >
  readonly copyInteractionDisposable: TerminalDisposable
  readonly imageLinkDisposable: TerminalDisposable
  readonly imagePasteDisposable: TerminalDisposable
  readonly inputDisposable: TerminalDisposable
  readonly wheelScrollDisposable: TerminalDisposable
  readonly sendResize: () => void
}

const createTerminalCleanup = (
  {
    cleanupArgs,
    copyInteractionDisposable,
    imageLinkDisposable,
    imagePasteDisposable,
    inputDisposable,
    sendResize,
    wheelScrollDisposable
  }: TerminalCleanupFactoryArgs
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
      copyInteractionDisposable.dispose()
      inputDisposable.dispose()
      wheelScrollDisposable.dispose()
    },
    removeResize: () => {
      removeEventListener("resize", sendResize)
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
  addEventListener("resize", sendResize)
  globalThis.visualViewport?.addEventListener("resize", sendResize)
  globalThis.visualViewport?.addEventListener("scroll", sendResize)
}

const createTerminalMessageHandlers = (
  args: TerminalLifecycleArgs,
  lifecycle: TerminalLifecycleState,
  terminal: TerminalMessageHandlers["terminal"]
): TerminalMessageHandlers => ({
  connectionRef: args.connectionRef,
  inlineImagePreviewsEnabledRef: args.inlineImagePreviewsEnabledRef,
  lifecycle,
  notifyExit: args.notifyExit,
  notifyMessage: args.notifyMessage,
  session: args.session,
  setStatus: args.setStatus,
  terminal
})

type MountedTerminalDisposables = {
  readonly copyInteractionDisposable: TerminalDisposable
  readonly imageLinkDisposable: TerminalDisposable
  readonly imagePasteDisposable: TerminalDisposable
  readonly inputDisposable: TerminalDisposable
  readonly wheelScrollDisposable: TerminalDisposable
}

type MountedTerminalCleanupArgs = {
  readonly args: TerminalLifecycleArgs
  readonly disposables: MountedTerminalDisposables
  readonly lifecycle: TerminalLifecycleState
  readonly resizeObserver: ResizeObserver | null
  readonly sendResize: () => void
  readonly socketRef: TerminalSocketRef
  readonly terminal: TerminalMessageHandlers["terminal"]
}

const createMountedTerminalDisposables = (
  args: TerminalLifecycleArgs,
  host: HTMLDivElement,
  pasteGuard: TerminalPasteGuard,
  socketRef: TerminalSocketRef,
  terminal: TerminalMessageHandlers["terminal"]
): MountedTerminalDisposables => ({
  copyInteractionDisposable: attachTerminalCopyInteraction({ host, terminal }),
  imageLinkDisposable: attachTerminalImageLinks(terminal, args.session),
  imagePasteDisposable: attachTerminalImagePaste({
    host,
    notifyMessage: args.notifyMessage,
    pasteGuard,
    socketRef,
    terminal
  }),
  inputDisposable: attachTerminalInput(terminal, socketRef, pasteGuard),
  wheelScrollDisposable: attachTerminalWheelScroll({ host, terminal })
})

const createMountedTerminalConnector = (
  args: TerminalLifecycleArgs,
  lifecycle: TerminalLifecycleState,
  socketRef: TerminalSocketRef,
  terminal: TerminalMessageHandlers["terminal"],
  sendResize: () => void
): () => void =>
  createConnectSocket({
    handlers: createTerminalMessageHandlers(args, lifecycle, terminal),
    lifecycle,
    notifyMessage: args.notifyMessage,
    onAttachFailure: args.onAttachFailure,
    sendResize,
    session: args.session,
    setStatus: args.setStatus,
    socketRef,
    terminal
  })

const createMountedTerminalCleanup = (
  { args, disposables, lifecycle, resizeObserver, sendResize, socketRef, terminal }: MountedTerminalCleanupArgs
): () => void =>
  createTerminalCleanup({
    cleanupArgs: {
      connectionRef: args.connectionRef,
      lifecycle,
      notifyMessage: args.notifyMessage,
      resizeObserver,
      runtimeRef: args.runtimeRef,
      session: args.session,
      socketRef,
      terminal
    },
    copyInteractionDisposable: disposables.copyInteractionDisposable,
    imageLinkDisposable: disposables.imageLinkDisposable,
    imagePasteDisposable: disposables.imagePasteDisposable,
    inputDisposable: disposables.inputDisposable,
    sendResize,
    wheelScrollDisposable: disposables.wheelScrollDisposable
  })

const resolveMountHost = (
  { hostRef, session }: Pick<TerminalLifecycleArgs, "hostRef" | "session">
): HTMLDivElement | null => {
  if (isPendingActiveTerminalSession(session)) {
    return null
  }
  return hostRef.current
}

const mountTerminalSession = (args: TerminalLifecycleArgs): (() => void) | undefined => {
  const host = resolveMountHost(args)
  if (host === null) {
    return undefined
  }

  args.connectionRef.current = { closing: false, opened: false }
  const lifecycle = createLifecycleState()
  const socketRef: TerminalSocketRef = { current: null }
  const { fitAddon, terminal } = createTerminalRuntime(host, {
    querySuppression: {
      allowMouseTracking: shouldAllowTerminalMouseTracking(args.session),
      suppressAlternateScreen: shouldSuppressTerminalAlternateScreen(args.session)
    }
  })
  const terminalInputController = createTerminalInputController(terminal, socketRef)
  const pasteGuard = createTerminalPasteGuard()
  const sendResize = (): void => {
    sendTerminalResize(fitAddon, socketRef, terminal)
  }
  const resizeObserver = observeTerminalResize(host, sendResize)
  const disposables = createMountedTerminalDisposables(args, host, pasteGuard, socketRef, terminal)
  const connectSocket = createMountedTerminalConnector(args, lifecycle, socketRef, terminal, sendResize)

  args.runtimeRef.current = terminalInputController
  attachGlobalResizeListeners(sendResize)
  connectSocket()

  return createMountedTerminalCleanup({
    args,
    disposables,
    lifecycle,
    resizeObserver,
    sendResize,
    socketRef,
    terminal
  })
}

export const useTerminalSessionLifecycle = (
  {
    connectionRef,
    hostRef,
    inlineImagePreviewsEnabledRef,
    notifyExit,
    notifyMessage,
    onAttachFailure,
    runtimeRef,
    session,
    setStatus
  }: TerminalLifecycleArgs
): void => {
  useEffect(() => {
    return mountTerminalSession({
      connectionRef,
      hostRef,
      inlineImagePreviewsEnabledRef,
      notifyExit,
      notifyMessage,
      onAttachFailure,
      runtimeRef,
      session,
      setStatus
    })
  }, [
    connectionRef,
    hostRef,
    notifyMessage,
    notifyExit,
    onAttachFailure,
    runtimeRef,
    session,
    setStatus
  ])
}

export {
  type TerminalConnectionState,
  type TerminalExitInfo,
  type TerminalInputController,
  type TerminalStatus
} from "./terminal-panel-runtime-types.js"

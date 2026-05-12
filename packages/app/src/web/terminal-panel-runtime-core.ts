import { FetchHttpClient, HttpClient } from "@effect/platform"
import { Effect, Either } from "effect"
import { Terminal } from "xterm"
import { FitAddon } from "xterm-addon-fit"

import { resolveTerminalImageFetchUrl } from "./terminal-image-url.js"
import { splitTerminalInlineImageOutput, type TerminalInlineImageOutputSegment } from "./terminal-inline-images-core.js"
import {
  appendTerminalInlineImagePreview,
  cachedTerminalInlineImageEntry,
  cacheTerminalInlineImageBlob,
  revokeTerminalInlineImageObjectUrlCache,
  terminalInlineImageSpacer,
  unavailableTerminalInlineImageEntry
} from "./terminal-inline-images.js"
import type { TerminalInlineImageEntry } from "./terminal-inline-images.js"
import type {
  TerminalCleanupArgs,
  TerminalInputController,
  TerminalLifecycleState,
  TerminalMessageHandlers,
  TerminalPasteGuard,
  TerminalRuntime,
  TerminalSocketConnectArgs,
  TerminalSocketListenerArgs,
  TerminalSocketRef
} from "./terminal-panel-runtime-types.js"
import { installTerminalQuerySuppression } from "./terminal-query-suppression.js"
import { resolveTerminalReconnectDelay, terminalReconnectGraceMs } from "./terminal-reconnect.js"
import { parseTerminalServerMessage, resolveTerminalWebSocketUrl } from "./terminal.js"

type TerminalClientMessage =
  | { readonly data: string; readonly type: "input" }
  | { readonly cols: number; readonly rows: number; readonly type: "resize" }

type TerminalInlineImageFetchError = {
  readonly _tag: "TerminalInlineImageFetchError"
  readonly message: string
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

export const createTerminalRuntime = (host: HTMLDivElement): TerminalRuntime => {
  const terminal = new Terminal({
    allowProposedApi: true,
    convertEol: false,
    cursorBlink: true,
    fontFamily: "'IBM Plex Mono', 'SFMono-Regular', monospace",
    fontSize: 14,
    theme: { background: "#080a0d", foreground: "#f4f7fb" }
  })
  installTerminalQuerySuppression(terminal)
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

const terminalImageEntry = (
  handlers: TerminalMessageHandlers,
  path: string
): TerminalInlineImageEntry | null => {
  const fetchUrl = resolveTerminalImageFetchUrl(handlers.session.websocketPath, path)
  return cachedTerminalInlineImageEntry(handlers.lifecycle.inlineImageObjectUrls, path, fetchUrl)
}

const terminalInlineImageFetchError = (message: string): TerminalInlineImageFetchError => ({
  _tag: "TerminalInlineImageFetchError",
  message
})

const terminalInlineImageFetchHeaders: Readonly<Record<string, string>> = {
  accept: "image/*",
  "cache-control": "no-cache, no-store, max-age=0",
  pragma: "no-cache"
}

const imageBlobFromArrayBuffer = (
  buffer: ArrayBuffer,
  mediaType: string | undefined
): Blob => new Blob([buffer], mediaType === undefined ? {} : { type: mediaType })

const fetchTerminalInlineImageBlob = (
  fetchUrl: string
): Effect.Effect<Blob, TerminalInlineImageFetchError> =>
  Effect.gen(function*(_) {
    const client = yield* _(HttpClient.HttpClient)
    const response = yield* _(
      client.get(fetchUrl, { headers: terminalInlineImageFetchHeaders }).pipe(
        Effect.mapError(() => terminalInlineImageFetchError("Could not fetch terminal image."))
      )
    )
    if (response.status >= 400) {
      return yield* _(Effect.fail(terminalInlineImageFetchError(`Terminal image returned HTTP ${response.status}.`)))
    }
    const buffer = yield* _(
      response.arrayBuffer.pipe(
        Effect.mapError(() => terminalInlineImageFetchError("Could not read terminal image response."))
      )
    )
    return imageBlobFromArrayBuffer(buffer, response.headers["content-type"])
  }).pipe(Effect.provide(FetchHttpClient.layer))

const loadTerminalImageEntry = (
  handlers: TerminalMessageHandlers,
  path: string,
  onComplete: (entry: TerminalInlineImageEntry) => void
): void => {
  const fetchUrl = resolveTerminalImageFetchUrl(handlers.session.websocketPath, path)
  const cached = cachedTerminalInlineImageEntry(handlers.lifecycle.inlineImageObjectUrls, path, fetchUrl)
  if (cached !== null) {
    onComplete(cached)
    return
  }
  Effect.runFork(
    fetchTerminalInlineImageBlob(fetchUrl).pipe(
      Effect.match({
        onFailure: () => unavailableTerminalInlineImageEntry(path, fetchUrl),
        onSuccess: (blob) =>
          handlers.lifecycle.disposed
            ? null
            : cacheTerminalInlineImageBlob(handlers.lifecycle.inlineImageObjectUrls, path, fetchUrl, blob)
      }),
      Effect.flatMap((entry) =>
        Effect.sync(() => {
          if (entry === null || handlers.lifecycle.disposed) {
            return
          }
          onComplete(entry)
        })
      )
    )
  )
}

const writePreviewSpacer = (
  handlers: TerminalMessageHandlers,
  onComplete: () => void
): void => {
  handlers.terminal.write(terminalInlineImageSpacer, onComplete)
}

const writeInlineImagePreview = (
  handlers: TerminalMessageHandlers,
  path: string,
  onComplete: () => void
): void => {
  const cached = terminalImageEntry(handlers, path)
  if (cached !== null) {
    writeInlineImagePreviewEntry(handlers, cached, onComplete)
    return
  }
  loadTerminalImageEntry(handlers, path, (entry) => {
    writeInlineImagePreviewEntry(handlers, entry, onComplete)
  })
}

const writeInlineImagePreviewEntry = (
  handlers: TerminalMessageHandlers,
  entry: TerminalInlineImageEntry,
  onComplete: () => void
): void => {
  const appended = appendTerminalInlineImagePreview(
    handlers.terminal,
    handlers.lifecycle,
    entry
  )
  if (!appended) {
    onComplete()
    return
  }
  writePreviewSpacer(handlers, onComplete)
}

const writeInlineImagePreviews = (
  handlers: TerminalMessageHandlers,
  paths: ReadonlyArray<string>,
  onComplete: () => void
): void => {
  let index = 0
  const writeNext = (): void => {
    const path = paths[index]
    if (path === undefined) {
      onComplete()
      return
    }
    index += 1
    writeInlineImagePreview(handlers, path, writeNext)
  }
  writeNext()
}

const writeLineBreakBeforePreview = (
  handlers: TerminalMessageHandlers,
  segment: TerminalInlineImageOutputSegment,
  onComplete: () => void
): void => {
  if (segment.endedWithLineBreak) {
    onComplete()
    return
  }
  handlers.terminal.write("\r\n", onComplete)
}

const flushTerminalOutputQueue = (handlers: TerminalMessageHandlers): void => {
  if (handlers.lifecycle.outputWriting || handlers.lifecycle.disposed) {
    return
  }
  const segment = handlers.lifecycle.outputQueue.shift()
  if (segment === undefined) {
    return
  }

  handlers.lifecycle.outputWriting = true
  handlers.terminal.write(segment.text, () => {
    if (segment.imagePaths.length === 0) {
      handlers.lifecycle.outputWriting = false
      flushTerminalOutputQueue(handlers)
      return
    }
    writeLineBreakBeforePreview(handlers, segment, () => {
      writeInlineImagePreviews(handlers, segment.imagePaths, () => {
        handlers.lifecycle.outputWriting = false
        flushTerminalOutputQueue(handlers)
      })
    })
  })
}

const enqueueTerminalOutput = (
  handlers: TerminalMessageHandlers,
  data: string
): void => {
  for (const segment of splitTerminalInlineImageOutput(data)) {
    handlers.lifecycle.outputQueue.push(segment)
  }
  flushTerminalOutputQueue(handlers)
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
  for (const disposable of args.lifecycle.inlineImageDisposables) {
    disposable.dispose()
  }
  args.lifecycle.inlineImageDisposables = []
  revokeTerminalInlineImageObjectUrlCache(args.lifecycle.inlineImageObjectUrls)
  args.lifecycle.outputQueue = []
  args.lifecycle.outputWriting = false
  args.removeImageLinks()
  args.removeImagePaste()
  args.removeInput()
  args.resizeObserver?.disconnect()
  args.removeResize()
  closeSocket(args.socketRef.current)
  args.socketRef.current = null
  args.runtimeRef.current = null
  args.terminal.dispose()
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

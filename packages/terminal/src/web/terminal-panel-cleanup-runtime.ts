import { revokeTerminalInlineImageObjectUrlCache } from "./terminal-inline-images.js"
import { runOptionalTerminalOperation } from "./terminal-panel-optional-operation.js"
import type { TerminalCleanupArgs } from "./terminal-panel-runtime-types.js"

const closeSocket = (socket: WebSocket | null): void => {
  if (socket === null || socket.readyState === WebSocket.CLOSED) {
    return
  }
  runOptionalTerminalOperation(() => {
    socket.close()
  })
}

const clearReconnectTimer = (args: TerminalCleanupArgs): void => {
  if (args.lifecycle.reconnectTimer === null) {
    return
  }

  clearTimeout(args.lifecycle.reconnectTimer)
  args.lifecycle.reconnectTimer = null
}

export const cleanupTerminalResources = (
  args: TerminalCleanupArgs
): void => {
  args.lifecycle.disposed = true
  clearReconnectTimer(args)
  for (const disposable of args.lifecycle.inlineImageDisposables) {
    runOptionalTerminalOperation(() => {
      disposable.dispose()
    })
  }
  args.lifecycle.inlineImageDisposables = []
  revokeTerminalInlineImageObjectUrlCache(args.lifecycle.inlineImageObjectUrls)
  args.lifecycle.inlineImageRenderedPaths.clear()
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

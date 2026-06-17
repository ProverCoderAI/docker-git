import type { TerminalPasteGuard } from "./terminal-panel-runtime-types.js"

export type TerminalClientMessage =
  | { readonly data: string; readonly type: "input" }
  | { readonly cols: number; readonly rows: number; readonly type: "resize" }

type TerminalClientSocket = {
  readonly readyState: number
  readonly send: (data: string) => void
}

export type TerminalClientSocketRef = { readonly current: TerminalClientSocket | null }

type TerminalInputTarget = {
  readonly onData: (handler: (data: string) => void) => { readonly dispose: () => void }
  readonly scrollToBottom: () => void
}

const csiPrefix = "\u{1B}["
const x10MouseReportPrefix = `${csiPrefix}M`
const x10MouseReportLength = 6
const sgrMouseReportBodyPattern = /^<\d+;\d+;\d+[Mm]$/u
const urxvtMouseReportBodyPattern = /^\d+;\d+;\d+M$/u

export const isTerminalMouseReportInput = (data: string): boolean => {
  if (data.startsWith(x10MouseReportPrefix)) {
    return data.length === x10MouseReportLength
  }
  if (!data.startsWith(csiPrefix)) {
    return false
  }
  const body = data.slice(csiPrefix.length)
  return sgrMouseReportBodyPattern.test(body) || urxvtMouseReportBodyPattern.test(body)
}

export const sendTerminalClientMessage = (
  socketRef: TerminalClientSocketRef,
  message: TerminalClientMessage
): void => {
  const socket = socketRef.current
  if (socket === null || socket.readyState !== WebSocket.OPEN) {
    return
  }
  socket.send(JSON.stringify(message))
}

export const attachTerminalInput = (
  terminal: TerminalInputTarget,
  socketRef: TerminalClientSocketRef,
  pasteGuard: TerminalPasteGuard
) =>
  terminal.onData((data) => {
    if (pasteGuard.shouldSuppressTerminalInput(data)) {
      return
    }
    if (!isTerminalMouseReportInput(data)) {
      terminal.scrollToBottom()
    }
    sendTerminalClientMessage(socketRef, { data, type: "input" })
  })

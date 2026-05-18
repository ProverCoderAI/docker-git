import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach, vi } from "vitest"

import { attachTerminalInput, isTerminalMouseReportInput } from "../../src/web/terminal-panel-input.js"

type TerminalDataHandler = (data: string) => void

const noop = (): void => undefined

const createTerminalInputHarness = () => {
  let handler: TerminalDataHandler = noop
  const state = { disposed: 0, scrolls: 0 }
  const terminal = {
    onData: (next: TerminalDataHandler) => {
      handler = next
      return {
        dispose: () => {
          state.disposed += 1
        }
      }
    },
    scrollToBottom: () => {
      state.scrolls += 1
    }
  }
  return {
    emit: (data: string) => {
      handler(data)
    },
    state,
    terminal
  }
}

const createOpenSocketRef = () => {
  const sent: Array<string> = []
  return {
    sent,
    socketRef: {
      current: {
        readyState: 1,
        send: (data: string) => {
          sent.push(data)
        }
      }
    }
  }
}

const passThroughPasteGuard = {
  shouldSuppressTerminalInput: () => false,
  suppressNextNativeImagePaste: noop
}

describe("terminal panel runtime core", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", { OPEN: 1 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("detects xterm mouse report input encodings", () => {
    expect(isTerminalMouseReportInput("\u001B[M !!")).toBe(true)
    expect(isTerminalMouseReportInput("\u001B[<64;10;5M")).toBe(true)
    expect(isTerminalMouseReportInput("\u001B[<0;10;5m")).toBe(true)
    expect(isTerminalMouseReportInput("\u001B[64;10;5M")).toBe(true)
    expect(isTerminalMouseReportInput("\u001B[2M")).toBe(false)
    expect(isTerminalMouseReportInput("a")).toBe(false)
  })

  it("scrolls to bottom for regular terminal input before sending it to the socket", () => {
    const input = createTerminalInputHarness()
    const { sent, socketRef } = createOpenSocketRef()

    const disposable = attachTerminalInput(input.terminal, socketRef, passThroughPasteGuard)
    input.emit("a")
    disposable.dispose()

    expect(input.state.scrolls).toBe(1)
    expect(input.state.disposed).toBe(1)
    expect(sent).toEqual([JSON.stringify({ data: "a", type: "input" })])
  })

  it("keeps the viewport stable for terminal mouse reports", () => {
    const input = createTerminalInputHarness()
    const { sent, socketRef } = createOpenSocketRef()

    attachTerminalInput(input.terminal, socketRef, passThroughPasteGuard)
    input.emit("\u001B[<64;10;5M")

    expect(input.state.scrolls).toBe(0)
    expect(sent).toEqual([JSON.stringify({ data: "\u001B[<64;10;5M", type: "input" })])
  })

  it("does not scroll or send input suppressed by the paste guard", () => {
    const input = createTerminalInputHarness()
    const { sent, socketRef } = createOpenSocketRef()
    const pasteGuard = {
      shouldSuppressTerminalInput: () => true,
      suppressNextNativeImagePaste: noop
    }

    attachTerminalInput(input.terminal, socketRef, pasteGuard)
    input.emit("\u0016")

    expect(input.state.scrolls).toBe(0)
    expect(sent).toEqual([])
  })
})

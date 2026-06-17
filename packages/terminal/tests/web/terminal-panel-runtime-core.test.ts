import { describe, expect, it } from "@effect/vitest"
import { afterEach, beforeEach, vi } from "vitest"

import { attachTerminalInput, isTerminalMouseReportInput } from "../../src/web/terminal-panel-input.js"

type TerminalDataHandler = (data: string) => void
type TerminalPasteGuard = Parameters<typeof attachTerminalInput>[2]

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

const passThroughPasteGuard: TerminalPasteGuard = {
  shouldSuppressTerminalInput: () => false,
  suppressNextNativeImagePaste: noop
}

const attachOpenTerminalInput = (pasteGuard: TerminalPasteGuard = passThroughPasteGuard) => {
  const input = createTerminalInputHarness()
  const { sent, socketRef } = createOpenSocketRef()
  const disposable = attachTerminalInput(input.terminal, socketRef, pasteGuard)

  return { disposable, input, sent }
}

describe("terminal panel runtime core", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", { OPEN: 1 })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("detects xterm mouse report input encodings", () => {
    expect(isTerminalMouseReportInput("\u{1B}[M !!")).toBe(true)
    expect(isTerminalMouseReportInput("\u{1B}[<64;10;5M")).toBe(true)
    expect(isTerminalMouseReportInput("\u{1B}[<0;10;5m")).toBe(true)
    expect(isTerminalMouseReportInput("\u{1B}[64;10;5M")).toBe(true)
    expect(isTerminalMouseReportInput("\u{1B}[2M")).toBe(false)
    expect(isTerminalMouseReportInput("a")).toBe(false)
  })

  it("scrolls to bottom for regular terminal input before sending it to the socket", () => {
    const { disposable, input, sent } = attachOpenTerminalInput()
    input.emit("a")
    disposable.dispose()

    expect(input.state.scrolls).toBe(1)
    expect(input.state.disposed).toBe(1)
    expect(sent).toEqual([JSON.stringify({ data: "a", type: "input" })])
  })

  it("forwards arrow escape sequences as regular terminal input", () => {
    const { input, sent } = attachOpenTerminalInput()
    input.emit("\u{1B}[C")
    input.emit("\u{1B}[A")

    expect(input.state.scrolls).toBe(2)
    expect(sent).toEqual([
      JSON.stringify({ data: "\u{1B}[C", type: "input" }),
      JSON.stringify({ data: "\u{1B}[A", type: "input" })
    ])
  })

  it("keeps the viewport stable for terminal mouse click reports", () => {
    const { input, sent } = attachOpenTerminalInput()
    input.emit("\u{1B}[<0;10;5M")

    expect(input.state.scrolls).toBe(0)
    expect(sent).toEqual([JSON.stringify({ data: "\u{1B}[<0;10;5M", type: "input" })])
  })

  it("does not scroll or send input suppressed by the paste guard", () => {
    const pasteGuard = {
      shouldSuppressTerminalInput: () => true,
      suppressNextNativeImagePaste: noop
    }
    const { input, sent } = attachOpenTerminalInput(pasteGuard)

    input.emit("\u{16}")

    expect(input.state.scrolls).toBe(0)
    expect(sent).toEqual([])
  })
})

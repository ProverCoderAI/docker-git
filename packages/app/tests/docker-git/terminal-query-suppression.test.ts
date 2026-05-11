import { describe, expect, it } from "@effect/vitest"

import { installTerminalQuerySuppression, isTerminalColorQuery } from "../../src/web/terminal-query-suppression.js"

type RegisteredOscHandler = {
  readonly identifier: number
  readonly callback: (data: string) => boolean
}

type CsiIdentifier = { readonly final: string; readonly prefix?: string }

type RegisteredCsiHandler = {
  readonly identifier: CsiIdentifier
  readonly callback: () => boolean
}

const createMockTerminal = (): {
  readonly disposedCount: { value: number }
  readonly osc: ReadonlyArray<RegisteredOscHandler>
  readonly csi: ReadonlyArray<RegisteredCsiHandler>
  readonly terminal: {
    parser: {
      registerOscHandler: (id: number, cb: (data: string) => boolean) => { dispose: () => void }
      registerCsiHandler: (id: CsiIdentifier, cb: () => boolean) => { dispose: () => void }
    }
  }
} => {
  const osc: Array<RegisteredOscHandler> = []
  const csi: Array<RegisteredCsiHandler> = []
  const disposedCount = { value: 0 }
  return {
    csi,
    disposedCount,
    osc,
    terminal: {
      parser: {
        registerCsiHandler: (identifier, callback) => {
          csi.push({ callback, identifier })
          return {
            dispose: () => {
              disposedCount.value += 1
            }
          }
        },
        registerOscHandler: (identifier, callback) => {
          osc.push({ callback, identifier })
          return {
            dispose: () => {
              disposedCount.value += 1
            }
          }
        }
      }
    }
  }
}

describe("terminal query suppression", () => {
  it("detects color query payloads with the '?' placeholder", () => {
    expect(isTerminalColorQuery("?")).toBe(true)
    expect(isTerminalColorQuery("1;?")).toBe(true)
    expect(isTerminalColorQuery("?;1;2")).toBe(true)
  })

  it("treats explicit color values as non-queries", () => {
    expect(isTerminalColorQuery("rgb:f4f4/f7f7/fbfb")).toBe(false)
    expect(isTerminalColorQuery("#1a2b3c")).toBe(false)
    expect(isTerminalColorQuery("1;rgb:00/00/00")).toBe(false)
    expect(isTerminalColorQuery("")).toBe(false)
  })

  it("registers OSC color suppression handlers for 4, 10, 11, and 12", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    expect(mock.osc.map((handler) => handler.identifier)).toEqual([4, 10, 11, 12])
  })

  it("registers CSI handlers for DA1, DA2, DA3, and CPR", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    expect(mock.csi.map((handler) => handler.identifier)).toEqual([
      { final: "c" },
      { final: "c", prefix: ">" },
      { final: "c", prefix: "=" },
      { final: "n" },
      { final: "n", prefix: "?" }
    ])
  })

  it("consumes OSC color query sequences and lets explicit set commands fall through", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    const fgHandler = mock.osc.find((handler) => handler.identifier === 10)
    expect(fgHandler).toBeDefined()
    expect(fgHandler?.callback("?")).toBe(true)
    expect(fgHandler?.callback("rgb:1010/2020/3030")).toBe(false)
  })

  it("always consumes CSI device attribute and cursor position queries", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    for (const handler of mock.csi) {
      expect(handler.callback()).toBe(true)
    }
  })

  it("disposes every registered handler when the suppression is disposed", () => {
    const mock = createMockTerminal()
    const suppression = installTerminalQuerySuppression(mock.terminal)
    suppression.dispose()
    expect(mock.disposedCount.value).toBe(mock.osc.length + mock.csi.length)
  })
})

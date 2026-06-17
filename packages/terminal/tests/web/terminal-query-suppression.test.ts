import { describe, expect, it } from "@effect/vitest"

import {
  installTerminalQuerySuppression,
  isSuppressedDecPrivateMode,
  isTerminalColorQuery
} from "../../src/web/terminal-query-suppression.js"

type FunctionIdentifier = {
  readonly final: string
  readonly intermediates?: string
  readonly prefix?: string
}

type CsiParam = number | ReadonlyArray<number>

type CsiParams = ReadonlyArray<CsiParam>

type RegisteredOscHandler = {
  readonly identifier: number
  readonly callback: (data: string) => boolean
}

type RegisteredCsiHandler = {
  readonly identifier: FunctionIdentifier
  readonly callback: (params: CsiParams) => boolean
}

type RegisteredDcsHandler = {
  readonly identifier: FunctionIdentifier
  readonly callback: (data: string, params: CsiParams) => boolean
}

type MockTerminal = {
  readonly csi: ReadonlyArray<RegisteredCsiHandler>
  readonly dcs: ReadonlyArray<RegisteredDcsHandler>
  readonly disposedCount: { value: number }
  readonly osc: ReadonlyArray<RegisteredOscHandler>
  readonly terminal: {
    readonly parser: {
      readonly registerCsiHandler: (
        id: FunctionIdentifier,
        shouldHandle: (params: CsiParams) => boolean
      ) => { dispose: () => void }
      readonly registerDcsHandler: (
        id: FunctionIdentifier,
        shouldHandle: (data: string, params: CsiParams) => boolean
      ) => { dispose: () => void }
      readonly registerOscHandler: (
        id: number,
        shouldHandle: (data: string) => boolean
      ) => { dispose: () => void }
    }
  }
}

const createMockTerminal = (): MockTerminal => {
  const csi: Array<RegisteredCsiHandler> = []
  const dcs: Array<RegisteredDcsHandler> = []
  const osc: Array<RegisteredOscHandler> = []
  const disposedCount = { value: 0 }
  return {
    csi,
    dcs,
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
        registerDcsHandler: (identifier, callback) => {
          dcs.push({ callback, identifier })
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

const findCsi = (mock: MockTerminal, identifier: FunctionIdentifier): RegisteredCsiHandler => {
  const handler = mock.csi.find(
    (registered) =>
      registered.identifier.final === identifier.final &&
      registered.identifier.prefix === identifier.prefix &&
      registered.identifier.intermediates === identifier.intermediates
  )
  if (handler === undefined) {
    throw new Error(`Missing CSI handler for ${JSON.stringify(identifier)}`)
  }
  return handler
}

const DEVICE_QUERY_IDENTIFIERS: ReadonlyArray<FunctionIdentifier> = [
  { final: "c" },
  { final: "c", prefix: ">" },
  { final: "c", prefix: "=" },
  { final: "n" },
  { final: "n", prefix: "?" }
]

const ADDED_CSI_IDENTIFIERS: ReadonlyArray<FunctionIdentifier> = [
  { final: "p", intermediates: "$" },
  { final: "p", intermediates: "$", prefix: "?" },
  { final: "q", prefix: ">" },
  { final: "t" }
]

const MOUSE_TRACKING_MODES: ReadonlyArray<number> = [1000, 1002, 1003, 1006, 1015, 1016]

const FOCUS_REPORTING_MODE = 1004

const ALTERNATE_SCREEN_MODES: ReadonlyArray<number> = [47, 1047, 1049]

const SUPPRESSED_MODES: ReadonlyArray<number> = [...MOUSE_TRACKING_MODES, FOCUS_REPORTING_MODE]

const PASS_THROUGH_MODES: ReadonlyArray<number> = [25, 1007, ...ALTERNATE_SCREEN_MODES, 2004, 2026]

const privateModeHandlers = (
  mock: MockTerminal
): readonly [RegisteredCsiHandler, RegisteredCsiHandler] => [
  findCsi(mock, { final: "h", prefix: "?" }),
  findCsi(mock, { final: "l", prefix: "?" })
]

const expectPrivateModesHandled = (
  handlers: readonly [RegisteredCsiHandler, RegisteredCsiHandler],
  modes: ReadonlyArray<number>,
  isHandled: boolean
): void => {
  const [decSetHandler, resetHandler] = handlers
  for (const mode of modes) {
    expect(decSetHandler.callback([mode])).toBe(isHandled)
    expect(resetHandler.callback([mode])).toBe(isHandled)
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

  it("registers all required CSI suppression handlers", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    expect(mock.csi.map((handler) => handler.identifier)).toEqual([
      ...DEVICE_QUERY_IDENTIFIERS,
      ...ADDED_CSI_IDENTIFIERS,
      { final: "h", prefix: "?" },
      { final: "l", prefix: "?" }
    ])
  })

  it("registers DCS suppression handlers for DECRQSS and XTGETTCAP", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    expect(mock.dcs.map((handler) => handler.identifier)).toEqual([
      { final: "q", intermediates: "$" },
      { final: "q", intermediates: "+" }
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
    for (const identifier of DEVICE_QUERY_IDENTIFIERS) {
      expect(findCsi(mock, identifier).callback([])).toBe(true)
    }
  })

  it("always consumes DECRQM, XTVERSION and window manipulation queries", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    for (const identifier of ADDED_CSI_IDENTIFIERS) {
      expect(findCsi(mock, identifier).callback([2026])).toBe(true)
    }
  })

  it("always consumes DECRQSS and XTGETTCAP DCS queries", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    for (const handler of mock.dcs) {
      expect(handler.callback("", [])).toBe(true)
    }
  })

  it("blocks DEC private mode SET for focus reporting and mouse tracking", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    const decSetHandler = findCsi(mock, { final: "h", prefix: "?" })
    for (const mode of SUPPRESSED_MODES) {
      expect(decSetHandler.callback([mode])).toBe(true)
    }
  })

  it("blocks DEC private mode RESET for focus reporting and mouse tracking", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    const resetHandler = findCsi(mock, { final: "l", prefix: "?" })
    for (const mode of SUPPRESSED_MODES) {
      expect(resetHandler.callback([mode])).toBe(true)
    }
  })

  it("allows DEC private mouse tracking when explicitly enabled for tmux project terminals", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal, { allowMouseTracking: true })
    const handlers = privateModeHandlers(mock)

    expectPrivateModesHandled(handlers, MOUSE_TRACKING_MODES, false)
    expectPrivateModesHandled(handlers, ALTERNATE_SCREEN_MODES, false)
    expectPrivateModesHandled(handlers, [FOCUS_REPORTING_MODE], true)
  })

  it("blocks alternate screen modes only when scrollback preservation is explicitly requested", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal, {
      allowMouseTracking: true,
      suppressAlternateScreen: true
    })
    const handlers = privateModeHandlers(mock)

    expectPrivateModesHandled(handlers, ALTERNATE_SCREEN_MODES, true)
    expectPrivateModesHandled(handlers, MOUSE_TRACKING_MODES, false)
  })

  it("lets benign DEC private modes fall through to the built-in handler", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    expectPrivateModesHandled(privateModeHandlers(mock), PASS_THROUGH_MODES, false)
  })

  it("treats sub-parameters (nested arrays) as the parameter head", () => {
    const mock = createMockTerminal()
    installTerminalQuerySuppression(mock.terminal)
    const decSetHandler = findCsi(mock, { final: "h", prefix: "?" })
    expect(decSetHandler.callback([[1004, 0]])).toBe(true)
    expect(decSetHandler.callback([[25, 0]])).toBe(false)
  })

  it("exposes the suppressed private mode set", () => {
    expect(isSuppressedDecPrivateMode(1004)).toBe(true)
    expect(isSuppressedDecPrivateMode(1000)).toBe(true)
    expect(isSuppressedDecPrivateMode(1000, { allowMouseTracking: true })).toBe(false)
    expect(isSuppressedDecPrivateMode(1049)).toBe(false)
    expect(isSuppressedDecPrivateMode(1049, { suppressAlternateScreen: true })).toBe(true)
    expect(isSuppressedDecPrivateMode(25)).toBe(false)
    expect(isSuppressedDecPrivateMode(2026)).toBe(false)
  })

  it("disposes every registered handler when the suppression is disposed", () => {
    const mock = createMockTerminal()
    const suppression = installTerminalQuerySuppression(mock.terminal)
    suppression.dispose()
    expect(mock.disposedCount.value).toBe(mock.osc.length + mock.csi.length + mock.dcs.length)
  })
})

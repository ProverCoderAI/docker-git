import { describe, expect, it } from "@effect/vitest"

import {
  attachTerminalWheelScroll,
  resolveTerminalWheelScrollDelta,
  type TerminalWheelMouseTrackingMode,
  type TerminalWheelScrollTerminal
} from "../../src/web/terminal-wheel-scroll.js"

type TestWheelEvent = {
  readonly deltaMode: number
  readonly deltaY: number
  readonly preventDefault: () => void
  readonly stopImmediatePropagation?: () => void
  readonly stopPropagation: () => void
}

type TestWheelListener = (event: TestWheelEvent) => void

type TestWheelEventState = {
  readonly immediatePropagationStopped: number
  readonly prevented: number
  readonly propagationStopped: number
}

const noop = (): void => undefined

const expectWheelEventStopped = (state: TestWheelEventState): void => {
  expect(state.prevented).toBe(1)
  expect(state.propagationStopped).toBe(1)
  expect(state.immediatePropagationStopped).toBe(1)
}

const createWheelHost = () => {
  let listener: TestWheelListener = noop
  const state: {
    added: number
    removed: number
    wheelOptions: AddEventListenerOptions | null
  } = {
    added: 0,
    removed: 0,
    wheelOptions: null
  }
  return {
    dispatch: (event: TestWheelEvent) => {
      listener(event)
    },
    host: {
      addEventListener: (
        type: "wheel",
        next: TestWheelListener,
        options: AddEventListenerOptions
      ) => {
        expect(type).toBe("wheel")
        listener = next
        state.added += 1
        state.wheelOptions = options
      },
      removeEventListener: (
        type: "wheel",
        next: TestWheelListener,
        options: boolean
      ) => {
        expect(type).toBe("wheel")
        expect(next).toBe(listener)
        expect(options).toBe(true)
        state.removed += 1
      }
    },
    state
  }
}

const createWheelEvent = (deltaMode: number, deltaY: number) => {
  const state = {
    immediatePropagationStopped: 0,
    prevented: 0,
    propagationStopped: 0
  }
  return {
    event: {
      deltaMode,
      deltaY,
      preventDefault: () => {
        state.prevented += 1
      },
      stopImmediatePropagation: () => {
        state.immediatePropagationStopped += 1
      },
      stopPropagation: () => {
        state.propagationStopped += 1
      }
    },
    state
  }
}

const createTerminal = (
  mouseTrackingMode: TerminalWheelMouseTrackingMode,
  rows = 24
): { readonly scrolls: ReadonlyArray<number>; readonly terminal: TerminalWheelScrollTerminal } => {
  const scrolls: Array<number> = []
  return {
    scrolls,
    terminal: {
      modes: { mouseTrackingMode },
      rows,
      scrollLines: (amount) => {
        scrolls.push(amount)
      }
    }
  }
}

describe("terminal wheel scroll", () => {
  it("converts line and page wheel deltas into terminal scroll lines", () => {
    expect(resolveTerminalWheelScrollDelta({
      deltaMode: 1,
      deltaY: 3.8,
      previousPixelDeltaY: 9,
      rows: 24
    })).toEqual({ lines: 3, nextPixelDeltaY: 0 })
    expect(resolveTerminalWheelScrollDelta({
      deltaMode: 1,
      deltaY: -2.8,
      previousPixelDeltaY: 9,
      rows: 24
    })).toEqual({ lines: -2, nextPixelDeltaY: 0 })
    expect(resolveTerminalWheelScrollDelta({
      deltaMode: 2,
      deltaY: 1,
      previousPixelDeltaY: 9,
      rows: 24
    })).toEqual({ lines: 24, nextPixelDeltaY: 0 })
    expect(resolveTerminalWheelScrollDelta({
      deltaMode: 2,
      deltaY: 1,
      previousPixelDeltaY: 9,
      rows: 0
    })).toEqual({ lines: 1, nextPixelDeltaY: 0 })
  })

  it("accumulates pixel wheel deltas until they cross a terminal line", () => {
    const first = resolveTerminalWheelScrollDelta({
      deltaMode: 0,
      deltaY: 7,
      previousPixelDeltaY: 0,
      rows: 24
    })
    const second = resolveTerminalWheelScrollDelta({
      deltaMode: 0,
      deltaY: 8,
      previousPixelDeltaY: first.nextPixelDeltaY,
      rows: 24
    })

    expect(first).toEqual({ lines: 0, nextPixelDeltaY: 7 })
    expect(second).toEqual({ lines: 1, nextPixelDeltaY: 0 })
    expect(resolveTerminalWheelScrollDelta({
      deltaMode: 0,
      deltaY: -30,
      previousPixelDeltaY: 0,
      rows: 24
    })).toEqual({ lines: -2, nextPixelDeltaY: 0 })
    expect(resolveTerminalWheelScrollDelta({
      deltaMode: 0,
      deltaY: Number.NaN,
      previousPixelDeltaY: 0,
      rows: 24
    })).toEqual({ lines: 0, nextPixelDeltaY: 0 })
  })

  it("scrolls xterm history and stops wheel mouse reports while mouse tracking is active", () => {
    const activeModes: ReadonlyArray<TerminalWheelMouseTrackingMode> = ["x10", "vt200", "drag", "any"]

    for (const mode of activeModes) {
      const host = createWheelHost()
      const { scrolls, terminal } = createTerminal(mode)
      const { event, state } = createWheelEvent(1, 3)

      const disposable = attachTerminalWheelScroll({ host: host.host, terminal })
      host.dispatch(event)
      disposable.dispose()

      expect(host.state.added).toBe(1)
      expect(host.state.removed).toBe(1)
      expect(host.state.wheelOptions).toEqual({ capture: true, passive: false })
      expectWheelEventStopped(state)
      expect(scrolls).toEqual([3])
    }
  })

  it("still stops sub-line wheel events while accumulating pixel deltas", () => {
    const host = createWheelHost()
    const { scrolls, terminal } = createTerminal("any")
    const { event, state } = createWheelEvent(0, 1)

    attachTerminalWheelScroll({ host: host.host, terminal })
    host.dispatch(event)

    expectWheelEventStopped(state)
    expect(scrolls).toEqual([])
  })

  it("lets xterm handle wheel events normally when mouse tracking is inactive", () => {
    const host = createWheelHost()
    const { scrolls, terminal } = createTerminal("none")
    const { event, state } = createWheelEvent(0, 45)

    attachTerminalWheelScroll({ host: host.host, terminal })
    host.dispatch(event)

    expect(state.prevented).toBe(0)
    expect(state.propagationStopped).toBe(0)
    expect(state.immediatePropagationStopped).toBe(0)
    expect(scrolls).toEqual([])
  })
})

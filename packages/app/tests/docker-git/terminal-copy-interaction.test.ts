import { describe, expect, it } from "@effect/vitest"

import {
  attachTerminalCopyInteraction,
  forceTerminalSelectionModifier,
  shouldForceBrowserTerminalSelection,
  shouldForceTerminalSelectionContext,
  type TerminalCopyInteractionTerminal,
  type TerminalMouseTrackingMode,
  writeTerminalSelectionToClipboardData
} from "../../src/web/terminal-copy-interaction.js"

const terminalWithSelection = (
  mouseTrackingMode: TerminalMouseTrackingMode,
  selection: string
): TerminalCopyInteractionTerminal => ({
  getSelection: () => selection,
  hasSelection: () => selection.length > 0,
  modes: { mouseTrackingMode }
})

type TerminalCopyTestClipboardData = {
  readonly setData: (format: string, data: string) => void
}

type TerminalCopyTestClipboardEvent = {
  readonly clipboardData: TerminalCopyTestClipboardData | null
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

type TerminalCopyTestMouseEvent = {
  readonly button: number
  altKey: boolean
  shiftKey: boolean
}

type TerminalCopyTestMouseType = "mousedown" | "mousemove" | "mouseup"
type TerminalCopyTestEventType = "copy" | TerminalCopyTestMouseType
type TerminalCopyTestCopyListener = (event: TerminalCopyTestClipboardEvent) => void
type TerminalCopyTestMouseListener = (event: TerminalCopyTestMouseEvent) => void
type TerminalCopyTestListener =
  | { readonly listener: TerminalCopyTestCopyListener; readonly type: "copy" }
  | { readonly listener: TerminalCopyTestMouseListener; readonly type: TerminalCopyTestMouseType }
type TerminalCopyTestAnyListener = TerminalCopyTestCopyListener | TerminalCopyTestMouseListener

const isCopyTestListener = (
  type: TerminalCopyTestEventType,
  _listener: TerminalCopyTestAnyListener
): _listener is TerminalCopyTestCopyListener => type === "copy"

const isMouseTestListener = (
  type: TerminalCopyTestEventType,
  _listener: TerminalCopyTestAnyListener
): _listener is TerminalCopyTestMouseListener => type !== "copy"

const isMouseTestEventType = (
  type: TerminalCopyTestEventType
): type is TerminalCopyTestMouseType => type !== "copy"

const isMouseTestListenerEntry = (
  entry: TerminalCopyTestListener
): entry is { readonly listener: TerminalCopyTestMouseListener; readonly type: TerminalCopyTestMouseType } =>
  entry.type !== "copy"

class FakeTerminalCopyEventTarget {
  private listeners: Array<TerminalCopyTestListener> = []

  addEventListener(type: "copy", listener: TerminalCopyTestCopyListener, options: true): void
  addEventListener(type: TerminalCopyTestMouseType, listener: TerminalCopyTestMouseListener, options: true): void
  addEventListener(
    type: TerminalCopyTestEventType,
    listener: TerminalCopyTestAnyListener,
    _options: true
  ): void {
    if (isCopyTestListener(type, listener)) {
      this.listeners.push({ listener, type: "copy" })
      return
    }
    if (isMouseTestEventType(type) && isMouseTestListener(type, listener)) {
      this.listeners.push({ listener, type })
    }
  }

  removeEventListener(type: "copy", listener: TerminalCopyTestCopyListener, options: true): void
  removeEventListener(type: TerminalCopyTestMouseType, listener: TerminalCopyTestMouseListener, options: true): void
  removeEventListener(
    type: TerminalCopyTestEventType,
    listener: TerminalCopyTestAnyListener,
    _options: true
  ): void {
    this.listeners = this.listeners.filter((entry) => entry.type !== type || entry.listener !== listener)
  }

  dispatchMouse(type: TerminalCopyTestMouseType, event: TerminalCopyTestMouseEvent): void {
    for (const entry of this.listeners) {
      if (isMouseTestListenerEntry(entry) && entry.type === type) {
        entry.listener(event)
      }
    }
  }

  listenerCount(type: TerminalCopyTestEventType): number {
    return this.listeners.filter((entry) => entry.type === type).length
  }
}

class FakeTerminalCopyHost extends FakeTerminalCopyEventTarget {
  readonly ownerDocument: FakeTerminalCopyEventTarget | null

  constructor(ownerDocument: FakeTerminalCopyEventTarget | null) {
    super()
    this.ownerDocument = ownerDocument
  }
}

const mouseEvent = (button: number): TerminalCopyTestMouseEvent => ({
  altKey: false,
  button,
  shiftKey: false
})

const expectNoDragListeners = (target: FakeTerminalCopyEventTarget): void => {
  expect(target.listenerCount("mousemove")).toBe(0)
  expect(target.listenerCount("mouseup")).toBe(0)
}

describe("terminal copy interaction", () => {
  it("forces browser selection for primary mouse input while terminal mouse tracking is active", () => {
    expect(shouldForceBrowserTerminalSelection({ button: 0 }, terminalWithSelection("any", ""))).toBe(true)
    expect(shouldForceBrowserTerminalSelection({ button: 0 }, terminalWithSelection("drag", ""))).toBe(true)
    expect(shouldForceBrowserTerminalSelection({ button: 0 }, terminalWithSelection("none", ""))).toBe(false)
    expect(shouldForceBrowserTerminalSelection({ button: 2 }, terminalWithSelection("any", ""))).toBe(false)
  })

  it("forces context-menu clicks into selection mode only when selected terminal text exists", () => {
    expect(shouldForceTerminalSelectionContext({ button: 2 }, terminalWithSelection("any", "selected"))).toBe(true)
    expect(shouldForceTerminalSelectionContext({ button: 2 }, terminalWithSelection("any", ""))).toBe(false)
    expect(shouldForceTerminalSelectionContext({ button: 0 }, terminalWithSelection("any", "selected"))).toBe(false)
  })

  it("uses Shift as the forced selection modifier on non-Mac platforms", () => {
    const event = { altKey: false, shiftKey: false }

    expect(forceTerminalSelectionModifier(event, "Win32")).toBe(true)
    expect(event).toEqual({ altKey: false, shiftKey: true })
  })

  it("uses Alt as the forced selection modifier on Mac platforms", () => {
    const event = { altKey: false, shiftKey: false }

    expect(forceTerminalSelectionModifier(event, "MacIntel")).toBe(true)
    expect(event).toEqual({ altKey: true, shiftKey: false })
  })

  it("writes xterm selection text into clipboard data", () => {
    const writes: Array<{ readonly data: string; readonly format: string }> = []
    const clipboardData = {
      setData: (format: string, data: string) => {
        writes.push({ data, format })
      }
    }

    expect(writeTerminalSelectionToClipboardData(terminalWithSelection("any", "line one\nline two"), clipboardData))
      .toBe(
        true
      )
    expect(writes).toEqual([{ data: "line one\nline two", format: "text/plain" }])
  })

  it("does not handle copy when xterm has no selection or clipboard data", () => {
    const clipboardData = {
      setData: () => {
        expect.fail("clipboard data should not be written")
      }
    }

    expect(writeTerminalSelectionToClipboardData(terminalWithSelection("any", ""), clipboardData)).toBe(false)
    expect(writeTerminalSelectionToClipboardData(terminalWithSelection("any", "selected"), null)).toBe(false)
  })

  it("forces the selection modifier through the full primary-button drag", () => {
    const documentTarget = new FakeTerminalCopyEventTarget()
    const host = new FakeTerminalCopyHost(documentTarget)
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("any", "") })
    const down = mouseEvent(0)
    const move = mouseEvent(0)
    const up = mouseEvent(0)

    host.dispatchMouse("mousedown", down)
    documentTarget.dispatchMouse("mousemove", move)
    documentTarget.dispatchMouse("mouseup", up)

    expect(down.shiftKey).toBe(true)
    expect(move.shiftKey).toBe(true)
    expect(up.shiftKey).toBe(true)
    expectNoDragListeners(documentTarget)

    const afterReleaseMove = mouseEvent(0)
    documentTarget.dispatchMouse("mousemove", afterReleaseMove)
    expect(afterReleaseMove.shiftKey).toBe(false)

    disposable.dispose()
  })

  it("does not start a forced selection drag when mouse tracking is inactive", () => {
    const documentTarget = new FakeTerminalCopyEventTarget()
    const host = new FakeTerminalCopyHost(documentTarget)
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("none", "") })
    const down = mouseEvent(0)

    host.dispatchMouse("mousedown", down)

    expect(down.shiftKey).toBe(false)
    expectNoDragListeners(documentTarget)

    disposable.dispose()
  })

  it("keeps right-click selection handling one-shot", () => {
    const documentTarget = new FakeTerminalCopyEventTarget()
    const host = new FakeTerminalCopyHost(documentTarget)
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("any", "selected") })
    const down = mouseEvent(2)
    const move = mouseEvent(0)

    host.dispatchMouse("mousedown", down)
    documentTarget.dispatchMouse("mousemove", move)

    expect(down.shiftKey).toBe(true)
    expect(move.shiftKey).toBe(false)
    expectNoDragListeners(documentTarget)

    disposable.dispose()
  })

  it("falls back to host drag listeners when ownerDocument is unavailable", () => {
    const host = new FakeTerminalCopyHost(null)
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("drag", "") })
    const move = mouseEvent(0)

    host.dispatchMouse("mousedown", mouseEvent(0))
    host.dispatchMouse("mousemove", move)

    expect(move.shiftKey).toBe(true)

    disposable.dispose()
    expectNoDragListeners(host)
  })

  it("removes active drag listeners during dispose", () => {
    const documentTarget = new FakeTerminalCopyEventTarget()
    const host = new FakeTerminalCopyHost(documentTarget)
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("vt200", "") })

    host.dispatchMouse("mousedown", mouseEvent(0))
    disposable.dispose()

    const move = mouseEvent(0)
    documentTarget.dispatchMouse("mousemove", move)

    expect(move.shiftKey).toBe(false)
    expect(host.listenerCount("mousedown")).toBe(0)
    expect(host.listenerCount("copy")).toBe(0)
    expectNoDragListeners(documentTarget)
  })
})

import { describe, expect, it } from "@effect/vitest"

import {
  attachTerminalCopyInteraction,
  forceTerminalSelectionModifier,
  shouldForceBrowserTerminalSelection,
  shouldForceTerminalSelectionContext,
  shouldLetBrowserHandleTerminalCopyShortcut,
  type TerminalCopyInteractionTerminal,
  type TerminalCopyKeyboardEvent,
  type TerminalMouseTrackingMode,
  writeTerminalSelectionToClipboardData
} from "../../src/web/terminal-copy-interaction.js"
import {
  expectNoDragListeners,
  expectSingleMouseEvent,
  FakeTerminalCopyEventTarget,
  FakeTerminalCopyHost,
  mouseEvent,
  type TerminalCopyTestMouseEvent
} from "./fixtures/terminal-copy-interaction.js"

const terminalWithSelection = (
  mouseTrackingMode: TerminalMouseTrackingMode,
  selection: string
): TerminalCopyInteractionTerminal => ({
  getSelection: () => selection,
  hasSelection: () => selection.length > 0,
  modes: { mouseTrackingMode }
})

const keyboardEvent = (
  key: string,
  options: Partial<Pick<TerminalCopyKeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "type">> = {}
): TerminalCopyKeyboardEvent => ({
  altKey: options.altKey ?? false,
  ctrlKey: options.ctrlKey ?? false,
  key,
  metaKey: options.metaKey ?? false,
  type: options.type ?? "keydown"
})

const requireKeyHandler = (
  keyHandler: ((event: TerminalCopyKeyboardEvent) => boolean) | null
): (event: TerminalCopyKeyboardEvent) => boolean => {
  if (keyHandler === null) {
    return expect.fail("Expected terminal copy key handler to be registered.")
  }
  return keyHandler
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
    expect(shouldForceTerminalSelectionContext({ button: 2 }, terminalWithSelection("none", "selected"))).toBe(false)
    expect(shouldForceTerminalSelectionContext({ button: 0 }, terminalWithSelection("any", "selected"))).toBe(false)
  })

  it("lets browser copy handle Ctrl/Cmd+C only for selected terminal text", () => {
    const selectedTerminal = terminalWithSelection("any", "selected")
    const emptyTerminal = terminalWithSelection("any", "")

    expect(shouldLetBrowserHandleTerminalCopyShortcut(keyboardEvent("c", { ctrlKey: true }), selectedTerminal))
      .toBe(true)
    expect(shouldLetBrowserHandleTerminalCopyShortcut(keyboardEvent("C", { metaKey: true }), selectedTerminal))
      .toBe(true)
    expect(shouldLetBrowserHandleTerminalCopyShortcut(keyboardEvent("c", { ctrlKey: true }), emptyTerminal))
      .toBe(false)
    expect(
      shouldLetBrowserHandleTerminalCopyShortcut(keyboardEvent("c", { altKey: true, ctrlKey: true }), selectedTerminal)
    )
      .toBe(false)
    expect(shouldLetBrowserHandleTerminalCopyShortcut(keyboardEvent("v", { ctrlKey: true }), selectedTerminal))
      .toBe(false)
    expect(
      shouldLetBrowserHandleTerminalCopyShortcut(keyboardEvent("c", { ctrlKey: true, type: "keyup" }), selectedTerminal)
    ).toBe(false)
  })

  it("registers a custom key handler that bypasses xterm input for selected text copy", () => {
    let keyHandler: ((event: TerminalCopyKeyboardEvent) => boolean) | null = null
    const terminal: TerminalCopyInteractionTerminal = {
      attachCustomKeyEventHandler: (handler) => {
        keyHandler = handler
      },
      getSelection: () => "selected",
      hasSelection: () => true,
      modes: { mouseTrackingMode: "none" }
    }
    const host = new FakeTerminalCopyHost(null)

    const disposable = attachTerminalCopyInteraction({ host, terminal })
    const handleKey = requireKeyHandler(keyHandler)

    expect(handleKey(keyboardEvent("c", { ctrlKey: true }))).toBe(false)
    expect(handleKey(keyboardEvent("c", { ctrlKey: true, type: "keyup" }))).toBe(true)
    expect(handleKey(keyboardEvent("c"))).toBe(true)

    disposable.dispose()
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

  it("suppresses real mouseup reports and replays a document mouseup for selection finalization", () => {
    const documentTarget = new FakeTerminalCopyEventTarget()
    const host = new FakeTerminalCopyHost(documentTarget)
    const finalizedSelectionEvents: Array<TerminalCopyTestMouseEvent> = []
    const mouseReportEvents: Array<TerminalCopyTestMouseEvent> = []
    documentTarget.addBubbleMouseListener("mouseup", (event) => {
      finalizedSelectionEvents.push(event)
    })
    host.addBubbleMouseListener("mouseup", (event) => {
      mouseReportEvents.push(event)
    })
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("any", "") })
    const up = mouseEvent(0, "mouseup", {
      clientX: 12,
      clientY: 34,
      screenX: 56,
      screenY: 78
    })

    host.dispatchMouse("mousedown", mouseEvent(0))
    host.dispatchBubblingMouse("mouseup", up)

    expect(up.shiftKey).toBe(true)
    expect(up.preventDefaultCalls).toBe(1)
    expect(up.stopImmediatePropagationCalls).toBe(1)
    expect(up.stopPropagationCalls).toBeGreaterThanOrEqual(1)
    expect(mouseReportEvents).toEqual([])
    expect(documentTarget.dispatchedEvents).toHaveLength(1)

    const replayed = expectSingleMouseEvent(finalizedSelectionEvents)
    expect(replayed).not.toBe(up)
    expect(replayed.button).toBe(0)
    expect(replayed.buttons).toBe(0)
    expect(replayed.clientX).toBe(12)
    expect(replayed.clientY).toBe(34)
    expect(replayed.screenX).toBe(56)
    expect(replayed.screenY).toBe(78)
    expect(replayed.shiftKey).toBe(true)
    expect(replayed.altKey).toBe(false)
    expectNoDragListeners(documentTarget)

    disposable.dispose()
  })

  it("does not suppress or replay mouseup when mouse tracking is inactive", () => {
    const documentTarget = new FakeTerminalCopyEventTarget()
    const host = new FakeTerminalCopyHost(documentTarget)
    const mouseReportEvents: Array<TerminalCopyTestMouseEvent> = []
    host.addBubbleMouseListener("mouseup", (event) => {
      mouseReportEvents.push(event)
    })
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("none", "") })
    const up = mouseEvent(0, "mouseup")

    host.dispatchMouse("mousedown", mouseEvent(0))
    host.dispatchBubblingMouse("mouseup", up)

    expect(up.shiftKey).toBe(false)
    expect(up.preventDefaultCalls).toBe(0)
    expect(up.stopImmediatePropagationCalls).toBe(0)
    expect(up.stopPropagationCalls).toBe(0)
    expect(documentTarget.dispatchedEvents).toEqual([])
    expect(mouseReportEvents).toEqual([up])

    disposable.dispose()
  })

  it("suppresses protected context menus without blocking the native menu", () => {
    const host = new FakeTerminalCopyHost(null)
    const contextMenuReports: Array<TerminalCopyTestMouseEvent> = []
    host.addBubbleMouseListener("contextmenu", (event) => {
      contextMenuReports.push(event)
    })
    const disposable = attachTerminalCopyInteraction({ host, terminal: terminalWithSelection("any", "selected") })
    const down = mouseEvent(2)
    const contextMenu = mouseEvent(2, "contextmenu")

    host.dispatchMouse("mousedown", down)
    host.dispatchMouse("contextmenu", contextMenu)

    expect(contextMenu.shiftKey).toBe(true)
    expect(contextMenu.preventDefaultCalls).toBe(0)
    expect(contextMenu.stopImmediatePropagationCalls).toBe(1)
    expect(contextMenu.stopPropagationCalls).toBeGreaterThanOrEqual(1)
    expect(contextMenuReports).toEqual([])

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
    expect(host.listenerCount("mouseup")).toBe(0)
    expect(host.listenerCount("contextmenu")).toBe(0)
    expect(host.listenerCount("copy")).toBe(0)
    expectNoDragListeners(documentTarget)
  })
})

import { describe, expect, it } from "@effect/vitest"

import {
  attachTerminalCopyInteraction,
  type TerminalCopyInteractionTerminal
} from "../../src/web/terminal-copy-interaction.js"
import {
  copyEvent,
  expectNoDragListeners,
  FakeTerminalCopyEventTarget,
  FakeTerminalCopyHost,
  mouseEvent,
  type TerminalCopyTestMouseEvent
} from "./fixtures/terminal-copy-interaction.js"

type RightClickCopyHarness = {
  readonly clipboardWrites: Array<{ readonly data: string; readonly format: string }>
  readonly contextMenu: ReturnType<typeof mouseEvent>
  readonly contextMenuEvents: Array<TerminalCopyTestMouseEvent>
  readonly copy: ReturnType<typeof copyEvent>
  readonly disposable: { readonly dispose: () => void }
  readonly documentTarget: FakeTerminalCopyEventTarget
  readonly host: FakeTerminalCopyHost
  readonly rightClick: ReturnType<typeof mouseEvent>
  readonly rightRelease: ReturnType<typeof mouseEvent>
  readonly terminalMouseReports: Array<TerminalCopyTestMouseEvent>
}

const createRightClickCopyHarness = (
  terminal: TerminalCopyInteractionTerminal,
  onTerminalMouseReport?: (event: TerminalCopyTestMouseEvent) => void,
  onContextMenu?: (event: TerminalCopyTestMouseEvent) => void
): RightClickCopyHarness => {
  const documentTarget = new FakeTerminalCopyEventTarget()
  const host = new FakeTerminalCopyHost(documentTarget)
  const terminalMouseReports: Array<TerminalCopyTestMouseEvent> = []
  const contextMenuEvents: Array<TerminalCopyTestMouseEvent> = []
  const clipboardWrites: Array<{ readonly data: string; readonly format: string }> = []
  const disposable = attachTerminalCopyInteraction({ host, terminal })
  const recordTerminalMouseReport = (event: TerminalCopyTestMouseEvent): void => {
    terminalMouseReports.push(event)
    onTerminalMouseReport?.(event)
  }
  host.addBubbleMouseListener("mousedown", recordTerminalMouseReport)
  host.addBubbleMouseListener("mouseup", recordTerminalMouseReport)
  host.addBubbleMouseListener("contextmenu", (event) => {
    contextMenuEvents.push(event)
    onContextMenu?.(event)
  })
  return {
    clipboardWrites,
    contextMenu: mouseEvent(2, "contextmenu"),
    contextMenuEvents,
    copy: copyEvent({
      setData: (format: string, data: string) => {
        clipboardWrites.push({ data, format })
      }
    }),
    disposable,
    documentTarget,
    host,
    rightClick: mouseEvent(2),
    rightRelease: mouseEvent(2, "mouseup"),
    terminalMouseReports
  }
}

describe("terminal copy right-click interaction", () => {
  it("keeps right-click selection handling one-shot", () => {
    const documentTarget = new FakeTerminalCopyEventTarget()
    const host = new FakeTerminalCopyHost(documentTarget)
    const terminal: TerminalCopyInteractionTerminal = {
      getSelection: () => "selected",
      hasSelection: () => true,
      modes: { mouseTrackingMode: "any" }
    }
    const disposable = attachTerminalCopyInteraction({ host, terminal })
    const down = mouseEvent(2)
    const move = mouseEvent(0)

    host.dispatchMouse("mousedown", down)
    documentTarget.dispatchMouse("mousemove", move)

    expect(down.shiftKey).toBe(true)
    expect(move.shiftKey).toBe(false)
    expect(documentTarget.dispatchedEvents).toEqual([])
    expectNoDragListeners(documentTarget)

    disposable.dispose()
  })

  it("keeps selected terminal text copyable after right-click while mouse tracking is active", () => {
    const selectedText = "line one\nline two"
    let terminalSelection = selectedText
    const terminal: TerminalCopyInteractionTerminal = {
      getSelection: () => terminalSelection,
      hasSelection: () => terminalSelection.length > 0,
      modes: { mouseTrackingMode: "any" }
    }
    const flow = createRightClickCopyHarness(
      terminal,
      () => {
        terminalSelection = ""
      },
      () => {
        terminalSelection = ""
      }
    )

    flow.host.dispatchMouse("mousedown", flow.rightClick)
    expect(terminalSelection).toBe(selectedText)
    flow.host.dispatchBubblingMouse("mouseup", flow.rightRelease)
    expect(terminalSelection).toBe(selectedText)
    flow.host.dispatchMouse("contextmenu", flow.contextMenu)
    flow.host.dispatchCopy(flow.copy)

    expect(flow.rightClick.shiftKey).toBe(true)
    expect(flow.rightClick.preventDefaultCalls).toBe(0)
    expect(flow.rightClick.stopImmediatePropagationCalls).toBe(1)
    expect(flow.rightClick.stopPropagationCalls).toBeGreaterThanOrEqual(1)
    expect(flow.rightRelease.shiftKey).toBe(true)
    expect(flow.rightRelease.preventDefaultCalls).toBe(0)
    expect(flow.rightRelease.stopImmediatePropagationCalls).toBe(1)
    expect(flow.rightRelease.stopPropagationCalls).toBeGreaterThanOrEqual(1)
    expect(flow.contextMenu.shiftKey).toBe(true)
    expect(flow.contextMenu.preventDefaultCalls).toBe(0)
    expect(flow.contextMenu.stopImmediatePropagationCalls).toBe(0)
    expect(flow.contextMenu.stopPropagationCalls).toBe(0)
    expect(flow.terminalMouseReports).toEqual([])
    expect(flow.contextMenuEvents).toEqual([flow.contextMenu])
    expect(terminalSelection).toBe("")
    expectNoDragListeners(flow.documentTarget)
    expect(flow.clipboardWrites).toEqual([{ data: selectedText, format: "text/plain" }])
    expect(flow.copy.preventDefaultCalls).toBe(1)
    expect(flow.copy.stopPropagationCalls).toBe(1)

    flow.disposable.dispose()
  })

  it("does not suppress right-click release events without a terminal selection", () => {
    const terminal: TerminalCopyInteractionTerminal = {
      getSelection: () => "",
      hasSelection: () => false,
      modes: { mouseTrackingMode: "any" }
    }
    const flow = createRightClickCopyHarness(terminal)

    flow.host.dispatchMouse("mousedown", flow.rightClick)
    flow.host.dispatchBubblingMouse("mouseup", flow.rightRelease)
    flow.host.dispatchMouse("contextmenu", flow.contextMenu)
    flow.host.dispatchCopy(flow.copy)

    expect(flow.rightClick.shiftKey).toBe(false)
    expect(flow.rightClick.stopImmediatePropagationCalls).toBe(0)
    expect(flow.rightClick.stopPropagationCalls).toBe(0)
    expect(flow.rightRelease.shiftKey).toBe(false)
    expect(flow.rightRelease.stopImmediatePropagationCalls).toBe(0)
    expect(flow.rightRelease.stopPropagationCalls).toBe(0)
    expect(flow.contextMenu.shiftKey).toBe(false)
    expect(flow.contextMenu.stopImmediatePropagationCalls).toBe(0)
    expect(flow.contextMenu.stopPropagationCalls).toBe(0)
    expect(flow.terminalMouseReports).toEqual([flow.rightClick, flow.rightRelease])
    expect(flow.contextMenuEvents).toEqual([flow.contextMenu])
    expect(flow.clipboardWrites).toEqual([])
    expect(flow.copy.preventDefaultCalls).toBe(0)
    expect(flow.copy.stopPropagationCalls).toBe(0)
    expectNoDragListeners(flow.documentTarget)

    flow.disposable.dispose()
  })
})

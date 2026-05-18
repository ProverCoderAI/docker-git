import { describe, expect, it } from "@effect/vitest"

import {
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
})

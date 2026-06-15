import { describe, expect, it } from "@effect/vitest"

import {
  attachTerminalCopyInteraction,
  type TerminalCopyInteractionTerminal,
  type TerminalCopyKeyboardEvent
} from "../../src/web/terminal-copy-interaction.js"
import { copyEvent, FakeTerminalCopyHost, mouseEvent } from "./fixtures/terminal-copy-interaction.js"

const keyboardCopyEvent: TerminalCopyKeyboardEvent = {
  altKey: false,
  ctrlKey: true,
  key: "c",
  metaKey: false,
  type: "keydown"
}

describe("terminal copy redraw interaction", () => {
  it("keeps selection snapshot copyable after terminal redraw clears live selection", () => {
    let terminalSelection = ""
    const keyHandlers: Array<(event: TerminalCopyKeyboardEvent) => boolean> = []
    const selectionChangeHandlers: Array<() => void> = []
    const clipboardWrites: Array<{ readonly data: string; readonly format: string }> = []
    const host = new FakeTerminalCopyHost(null)
    const terminal: TerminalCopyInteractionTerminal = {
      attachCustomKeyEventHandler: (handler) => {
        keyHandlers.push(handler)
      },
      getSelection: () => terminalSelection,
      hasSelection: () => terminalSelection.length > 0,
      modes: { mouseTrackingMode: "any" },
      onSelectionChange: (handler) => {
        selectionChangeHandlers.push(handler)
        return {
          dispose: () => {
            const handlerIndex = selectionChangeHandlers.indexOf(handler)
            if (handlerIndex !== -1) {
              selectionChangeHandlers.splice(handlerIndex, 1)
            }
          }
        }
      }
    }
    const disposable = attachTerminalCopyInteraction({ host, terminal })

    terminalSelection = "selected before redraw"
    for (const handler of selectionChangeHandlers) {
      handler()
    }
    terminalSelection = ""

    expect(keyHandlers).toHaveLength(1)
    const handleKey = keyHandlers[0] ?? expect.fail("Expected terminal copy key handler to be registered.")
    expect(handleKey(keyboardCopyEvent)).toBe(false)

    const contextMenu = mouseEvent(0, "contextmenu")
    const copy = copyEvent({
      setData: (format: string, data: string) => {
        clipboardWrites.push({ data, format })
      }
    })
    host.dispatchMouse("contextmenu", contextMenu)
    host.dispatchCopy(copy)

    expect(contextMenu.shiftKey).toBe(true)
    expect(contextMenu.stopImmediatePropagationCalls).toBe(1)
    expect(contextMenu.stopPropagationCalls).toBeGreaterThanOrEqual(1)
    expect(clipboardWrites).toEqual([{ data: "selected before redraw", format: "text/plain" }])
    expect(copy.preventDefaultCalls).toBe(1)
    expect(copy.stopPropagationCalls).toBe(1)
    expect(selectionChangeHandlers).toHaveLength(1)
    expect(handleKey(keyboardCopyEvent)).toBe(true)

    disposable.dispose()
    expect(selectionChangeHandlers).toHaveLength(0)
  })
})

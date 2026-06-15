import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

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
} as const

class FakeTerminalCopyTextarea {
  focusCalls = 0
  selectCalls = 0
  readonly style = {
    height: "",
    left: "",
    top: "",
    width: "",
    zIndex: ""
  }
  value = ""

  focus(): void {
    this.focusCalls += 1
  }

  select(): void {
    this.selectCalls += 1
  }
}

class FakeTerminalCopyScreenHost extends FakeTerminalCopyHost {
  constructor(
    readonly screenLeft: number,
    readonly screenTop: number
  ) {
    super(null)
  }

  querySelector(
    selector: string
  ): { readonly getBoundingClientRect: () => { readonly left: number; readonly top: number } } | null {
    if (selector !== ".xterm-screen") {
      return null
    }
    return {
      getBoundingClientRect: () => ({
        left: this.screenLeft,
        top: this.screenTop
      })
    }
  }
}

describe("terminal copy redraw interaction", () => {
  it.effect("keeps selection snapshot copyable after terminal redraw clears live selection", () =>
    Effect.sync(() => {
      let terminalSelection = ""
      const keyHandlers: Array<(event: TerminalCopyKeyboardEvent) => boolean> = []
      const selectionChangeHandlers: Array<() => void> = []
      const clipboardWrites: Array<{ readonly data: string; readonly format: string }> = []
      const host = new FakeTerminalCopyScreenHost(100, 200)
      const textarea = new FakeTerminalCopyTextarea()
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
        },
        textarea
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

      const rightClick = mouseEvent(2, "mousedown", {
        clientX: 150,
        clientY: 260
      })
      const contextMenu = mouseEvent(0, "contextmenu", {
        clientX: 155,
        clientY: 265
      })
      const copy = copyEvent({
        setData: (format: string, data: string) => {
          clipboardWrites.push({ data, format })
        }
      })
      host.dispatchMouse("mousedown", rightClick)

      expect(rightClick.shiftKey).toBe(true)
      expect(rightClick.preventDefaultCalls).toBe(0)
      expect(rightClick.stopImmediatePropagationCalls).toBe(1)
      expect(textarea.value).toBe("selected before redraw")
      expect(textarea.focusCalls).toBe(1)
      expect(textarea.selectCalls).toBe(1)

      host.dispatchMouse("contextmenu", contextMenu)

      expect(contextMenu.shiftKey).toBe(true)
      expect(contextMenu.preventDefaultCalls).toBe(0)
      expect(contextMenu.stopImmediatePropagationCalls).toBe(1)
      expect(contextMenu.stopPropagationCalls).toBeGreaterThanOrEqual(1)
      expect(textarea.value).toBe("selected before redraw")
      expect(textarea.focusCalls).toBe(2)
      expect(textarea.selectCalls).toBe(2)
      expect(textarea.style).toEqual({
        height: "20px",
        left: "45px",
        top: "55px",
        width: "20px",
        zIndex: "1000"
      })

      host.dispatchCopy(copy)

      expect(clipboardWrites).toEqual([{ data: "selected before redraw", format: "text/plain" }])
      expect(copy.preventDefaultCalls).toBe(1)
      expect(copy.stopPropagationCalls).toBe(1)
      expect(textarea.value).toBe("")
      expect(selectionChangeHandlers).toHaveLength(1)
      expect(handleKey(keyboardCopyEvent)).toBe(true)

      disposable.dispose()
      expect(selectionChangeHandlers).toHaveLength(0)
    }))
})

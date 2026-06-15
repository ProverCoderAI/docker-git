import { describe, expect, it } from "@effect/vitest"

import {
  attachTerminalCopyInteraction,
  type TerminalCopyInteractionTerminal,
  type TerminalCopyKeyboardEvent
} from "../../src/web/terminal-copy-interaction.js"
import {
  copyEvent,
  FakeTerminalCopyHost,
  mouseEvent,
  type TerminalCopyTestMouseEvent
} from "./fixtures/terminal-copy-interaction.js"

type SelectionBufferType = "alternate" | "normal"

type SelectionRange = Exclude<
  ReturnType<NonNullable<TerminalCopyInteractionTerminal["getSelectionPosition"]>>,
  undefined
>

type SelectCall = {
  readonly column: number
  readonly length: number
  readonly row: number
}

type SelectionRestoreHarness = {
  readonly disposable: { readonly dispose: () => void }
  readonly emitSelectionChange: () => void
  readonly host: FakeTerminalCopyHost
  readonly keyHandlers: Array<(event: TerminalCopyKeyboardEvent) => boolean>
  readonly selectCalls: Array<SelectCall>
  readonly setBufferType: (type: SelectionBufferType) => void
  readonly setCols: (cols: number) => void
  readonly setSelection: (text: string, startColumn: number, startRow: number) => void
  readonly textarea: FakeTerminalRestoreTextarea
}

const keyboardCopyEvent: TerminalCopyKeyboardEvent = {
  altKey: false,
  ctrlKey: true,
  key: "c",
  metaKey: false,
  type: "keydown"
}

class FakeTerminalRestoreTextarea {
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

const removeSelectionHandler = (
  handlers: Array<() => void>,
  handler: () => void
): void => {
  const handlerIndex = handlers.indexOf(handler)
  if (handlerIndex !== -1) {
    handlers.splice(handlerIndex, 1)
  }
}

const createSelectionRestoreHarness = (): SelectionRestoreHarness => {
  let terminalSelection = ""
  let selectionRange: SelectionRange | undefined
  let terminalCols = 80
  let terminalBufferType: SelectionBufferType = "normal"
  const host = new FakeTerminalCopyHost(null)
  const keyHandlers: Array<(event: TerminalCopyKeyboardEvent) => boolean> = []
  const selectionChangeHandlers: Array<() => void> = []
  const selectCalls: Array<SelectCall> = []
  const textarea = new FakeTerminalRestoreTextarea()
  const terminal: TerminalCopyInteractionTerminal = {
    attachCustomKeyEventHandler: (handler) => {
      keyHandlers.push(handler)
    },
    buffer: {
      get active() {
        return {
          baseY: 0,
          length: 100,
          type: terminalBufferType,
          viewportY: 0
        }
      }
    },
    get cols() {
      return terminalCols
    },
    getSelection: () => terminalSelection,
    getSelectionPosition: () => selectionRange,
    hasSelection: () => terminalSelection.length > 0,
    modes: { mouseTrackingMode: "any" },
    onSelectionChange: (handler) => {
      selectionChangeHandlers.push(handler)
      return {
        dispose: () => {
          removeSelectionHandler(selectionChangeHandlers, handler)
        }
      }
    },
    select: (column, row, length) => {
      selectCalls.push({ column, length, row })
    },
    textarea
  }
  const disposable = attachTerminalCopyInteraction({ host, terminal })
  return {
    disposable,
    emitSelectionChange: () => {
      for (const handler of selectionChangeHandlers) {
        handler()
      }
    },
    host,
    keyHandlers,
    selectCalls,
    setBufferType: (type) => {
      terminalBufferType = type
    },
    setCols: (cols) => {
      terminalCols = cols
    },
    setSelection: (text, startColumn, startRow) => {
      terminalSelection = text
      selectionRange = text.length > 0
        ? {
          end: { x: startColumn + text.length, y: startRow },
          start: { x: startColumn, y: startRow }
        }
        : undefined
    },
    textarea
  }
}

const requireKeyHandler = (
  keyHandlers: ReadonlyArray<(event: TerminalCopyKeyboardEvent) => boolean>
): (event: TerminalCopyKeyboardEvent) => boolean =>
  keyHandlers[0] ?? expect.fail("Expected terminal copy key handler to be registered.")

describe("terminal copy selection restore", () => {
  it("restores xterm selection coordinates after redraw clears live selection", () => {
    const harness = createSelectionRestoreHarness()

    harness.setSelection("selected text", 3, 5)
    harness.emitSelectionChange()
    harness.setSelection("", 0, 0)
    harness.emitSelectionChange()

    expect(harness.selectCalls).toEqual([{ column: 3, length: 13, row: 5 }])

    harness.disposable.dispose()
  })

  it("does not restore xterm selection after intentional keyboard input clears the snapshot", () => {
    const harness = createSelectionRestoreHarness()

    harness.setSelection("selected", 1, 4)
    harness.emitSelectionChange()
    expect(requireKeyHandler(harness.keyHandlers)({ ...keyboardCopyEvent, ctrlKey: false, key: "Enter" }))
      .toBe(true)
    harness.setSelection("", 0, 0)
    harness.emitSelectionChange()

    expect(harness.selectCalls).toEqual([])

    harness.disposable.dispose()
  })

  it("keeps copy snapshot but skips reselect when terminal column count changes", () => {
    const harness = createSelectionRestoreHarness()
    const clipboardWrites: Array<{ readonly data: string; readonly format: string }> = []

    harness.setSelection("snapshot", 8, 2)
    harness.emitSelectionChange()
    harness.setCols(81)
    harness.setSelection("", 0, 0)
    harness.emitSelectionChange()
    harness.host.dispatchCopy(copyEvent({
      setData: (format: string, data: string) => {
        clipboardWrites.push({ data, format })
      }
    }))

    expect(harness.selectCalls).toEqual([])
    expect(clipboardWrites).toEqual([{ data: "snapshot", format: "text/plain" }])

    harness.disposable.dispose()
  })

  it("skips reselect when the active terminal buffer type changes", () => {
    const harness = createSelectionRestoreHarness()

    harness.setSelection("alternate text", 2, 7)
    harness.setBufferType("alternate")
    harness.emitSelectionChange()
    harness.setBufferType("normal")
    harness.setSelection("", 0, 0)
    harness.emitSelectionChange()

    expect(harness.selectCalls).toEqual([])

    harness.disposable.dispose()
  })

  it("does not suppress events or copy without a prior selection snapshot", () => {
    const harness = createSelectionRestoreHarness()
    const terminalMouseReports: Array<TerminalCopyTestMouseEvent> = []
    const rightClick = mouseEvent(2, "mousedown")
    const contextMenu = mouseEvent(0, "contextmenu")
    const copy = copyEvent({
      setData: () => {
        expect.fail("clipboard data should not be written")
      }
    })
    harness.host.addBubbleMouseListener("mousedown", (event) => {
      terminalMouseReports.push(event)
    })
    harness.host.addBubbleMouseListener("contextmenu", (event) => {
      terminalMouseReports.push(event)
    })

    harness.emitSelectionChange()
    harness.host.dispatchMouse("mousedown", rightClick)
    harness.host.dispatchMouse("contextmenu", contextMenu)
    harness.host.dispatchCopy(copy)

    expect(harness.selectCalls).toEqual([])
    expect(requireKeyHandler(harness.keyHandlers)(keyboardCopyEvent)).toBe(true)
    expect(rightClick.stopImmediatePropagationCalls).toBe(0)
    expect(contextMenu.stopImmediatePropagationCalls).toBe(0)
    expect(copy.preventDefaultCalls).toBe(0)
    expect(harness.textarea.focusCalls).toBe(0)
    expect(harness.textarea.selectCalls).toBe(0)
    expect(harness.textarea.value).toBe("")
    expect(terminalMouseReports).toEqual([rightClick, contextMenu])

    harness.disposable.dispose()
  })
})

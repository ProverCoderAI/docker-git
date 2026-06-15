import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"

import {
  attachTerminalCopyInteraction,
  type TerminalCopyInteractionTerminal,
  type TerminalCopyKeyboardEvent
} from "../../src/web/terminal-copy-interaction.js"
import { copyEvent, FakeTerminalCopyHost } from "./fixtures/terminal-copy-interaction.js"

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
} as const

const nonEmptySelectionTextArbitrary = fc.string({ maxLength: 32, minLength: 1 })

const selectionCoordinateArbitrary = fc.record({
  bufferType: fc.constantFrom<SelectionBufferType>("alternate", "normal"),
  extraCols: fc.integer({ max: 128, min: 0 }),
  startColumn: fc.integer({ max: 32, min: 0 }),
  startRow: fc.integer({ max: 98, min: 0 })
})

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

const withSelectionRestoreHarness = (assertion: (harness: SelectionRestoreHarness) => void): void => {
  Effect.runSync(
    Effect.scoped(
      Effect.flatMap(
        Effect.acquireRelease(
          Effect.sync(createSelectionRestoreHarness),
          (harness) =>
            Effect.sync(() => {
              harness.disposable.dispose()
            })
        ),
        (harness) =>
          Effect.sync(() => {
            assertion(harness)
          })
      )
    )
  )
}

describe("terminal copy selection restore", () => {
  it.effect("restores generated valid xterm selection coordinates after redraw", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          nonEmptySelectionTextArbitrary,
          selectionCoordinateArbitrary,
          (selectedText, { bufferType, extraCols, startColumn, startRow }) => {
            withSelectionRestoreHarness((harness) => {
              const cols = startColumn + selectedText.length + extraCols
              harness.setCols(cols)
              harness.setBufferType(bufferType)
              harness.setSelection(selectedText, startColumn, startRow)
              harness.emitSelectionChange()
              harness.setSelection("", 0, 0)
              harness.emitSelectionChange()
              expect(harness.selectCalls).toEqual([
                { column: startColumn, length: selectedText.length, row: startRow }
              ])
            })
          }
        ),
        { numRuns: 100 }
      )
    }))

  it.effect("keeps generated copy snapshots but skips reselect after column changes", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          nonEmptySelectionTextArbitrary,
          selectionCoordinateArbitrary,
          fc.integer({ max: 32, min: 1 }),
          (selectedText, { bufferType, extraCols, startColumn, startRow }, colsDelta) => {
            withSelectionRestoreHarness((harness) => {
              const clipboardWrites: Array<{ readonly data: string; readonly format: string }> = []
              const cols = startColumn + selectedText.length + extraCols
              harness.setCols(cols)
              harness.setBufferType(bufferType)
              harness.setSelection(selectedText, startColumn, startRow)
              harness.emitSelectionChange()
              harness.setCols(cols + colsDelta)
              harness.setSelection("", 0, 0)
              harness.emitSelectionChange()
              harness.host.dispatchCopy(copyEvent({
                setData: (format: string, data: string) => {
                  clipboardWrites.push({ data, format })
                }
              }))

              expect(harness.selectCalls).toEqual([])
              expect(clipboardWrites).toEqual([{ data: selectedText, format: "text/plain" }])
            })
          }
        ),
        { numRuns: 100 }
      )
    }))

  it.effect("keeps generated copy snapshots but skips reselect after buffer type changes", () =>
    Effect.sync(() => {
      fc.assert(
        fc.property(
          nonEmptySelectionTextArbitrary,
          selectionCoordinateArbitrary,
          (selectedText, { bufferType, extraCols, startColumn, startRow }) => {
            withSelectionRestoreHarness((harness) => {
              const clipboardWrites: Array<{ readonly data: string; readonly format: string }> = []
              const cols = startColumn + selectedText.length + extraCols
              const changedBufferType: SelectionBufferType = bufferType === "normal" ? "alternate" : "normal"
              harness.setCols(cols)
              harness.setBufferType(bufferType)
              harness.setSelection(selectedText, startColumn, startRow)
              harness.emitSelectionChange()
              harness.setBufferType(changedBufferType)
              harness.setSelection("", 0, 0)
              harness.emitSelectionChange()
              harness.host.dispatchCopy(copyEvent({
                setData: (format: string, data: string) => {
                  clipboardWrites.push({ data, format })
                }
              }))
              expect(harness.selectCalls).toEqual([])
              expect(clipboardWrites).toEqual([{ data: selectedText, format: "text/plain" }])
            })
          }
        ),
        { numRuns: 100 }
      )
    }))

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
})

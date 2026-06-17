export type TerminalCopyClipboardData = {
  readonly setData: (format: string, data: string) => void
}

export type TerminalSelectionTarget = {
  readonly getSelection: () => string
  readonly hasSelection: () => boolean
}

type TerminalSelectionBufferType = "alternate" | "normal"

type TerminalSelectionBufferSnapshot = {
  readonly active: {
    readonly baseY: number
    readonly length: number
    readonly type: TerminalSelectionBufferType
    readonly viewportY: number
  }
}

type TerminalSelectionCellPosition = {
  readonly x: number
  readonly y: number
}

type TerminalSelectionBufferRange = {
  readonly end: TerminalSelectionCellPosition
  readonly start: TerminalSelectionCellPosition
}

export type TerminalSelectionRestoreTarget = {
  readonly buffer?: TerminalSelectionBufferSnapshot | undefined
  readonly cols?: number | undefined
  readonly getSelectionPosition?: () => TerminalSelectionBufferRange | undefined
  readonly select?: (column: number, row: number, length: number) => void
}

type TerminalSelectionActiveBufferSnapshot = {
  readonly length: number
  readonly type: TerminalSelectionBufferType
}

type TerminalSelectionRestoreSnapshot = {
  readonly buffer: TerminalSelectionActiveBufferSnapshot
  readonly cols: number
  readonly endRow: number
  readonly length: number
  readonly startColumn: number
  readonly startRow: number
}

type TerminalSelectionNormalizedRangeSnapshot = {
  readonly endRow: number
  readonly length: number
  readonly startColumn: number
  readonly startRow: number
}

const terminalSelectionContextSnapshotTtlMs = 10_000

const isNonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0

const isPositiveInteger = (value: number): boolean => Number.isSafeInteger(value) && value > 0

const isValidTerminalSelectionColumn = (column: number, cols: number): boolean =>
  isNonNegativeInteger(column) && column <= cols

const isValidTerminalSelectionCell = (cell: TerminalSelectionCellPosition, cols: number): boolean =>
  isValidTerminalSelectionColumn(cell.x, cols) && isNonNegativeInteger(cell.y)

const terminalSelectionCellCompare = (
  left: TerminalSelectionCellPosition,
  right: TerminalSelectionCellPosition
): number => {
  if (left.y !== right.y) {
    return left.y - right.y
  }
  return left.x - right.x
}

const normalizeTerminalSelectionRange = (
  range: TerminalSelectionBufferRange
): TerminalSelectionBufferRange => {
  if (terminalSelectionCellCompare(range.start, range.end) <= 0) {
    return range
  }
  return { end: range.start, start: range.end }
}

const terminalSelectionRangeLength = (
  range: TerminalSelectionBufferRange,
  cols: number
): number => ((range.end.y - range.start.y) * cols) + range.end.x - range.start.x

const readTerminalSelectionCols = (terminal: TerminalSelectionRestoreTarget): number | null => {
  const cols = terminal.cols
  if (cols === undefined || !isPositiveInteger(cols)) {
    return null
  }
  return cols
}

const readTerminalSelectionActiveBuffer = (
  terminal: TerminalSelectionRestoreTarget
): TerminalSelectionActiveBufferSnapshot | null => {
  const activeBuffer = terminal.buffer?.active
  if (activeBuffer === undefined) {
    return null
  }
  if (!isNonNegativeInteger(activeBuffer.baseY) || !isNonNegativeInteger(activeBuffer.viewportY)) {
    return null
  }
  if (!isPositiveInteger(activeBuffer.length)) {
    return null
  }
  return {
    length: activeBuffer.length,
    type: activeBuffer.type
  }
}

const isValidTerminalSelectionRange = (
  range: TerminalSelectionBufferRange,
  cols: number,
  bufferLength: number
): boolean =>
  isValidTerminalSelectionCell(range.start, cols) &&
  isValidTerminalSelectionCell(range.end, cols) &&
  range.end.y < bufferLength

const readTerminalSelectionNormalizedRangeSnapshot = (
  terminal: TerminalSelectionRestoreTarget,
  cols: number,
  bufferLength: number
): TerminalSelectionNormalizedRangeSnapshot | null => {
  const range = terminal.getSelectionPosition?.()
  if (range === undefined) {
    return null
  }
  const normalizedRange = normalizeTerminalSelectionRange(range)
  if (!isValidTerminalSelectionRange(normalizedRange, cols, bufferLength)) {
    return null
  }
  const length = terminalSelectionRangeLength(normalizedRange, cols)
  if (!isPositiveInteger(length)) {
    return null
  }
  return {
    endRow: normalizedRange.end.y,
    length,
    startColumn: normalizedRange.start.x,
    startRow: normalizedRange.start.y
  }
}

const readTerminalSelectionRestoreSnapshot = (
  terminal: TerminalSelectionRestoreTarget
): TerminalSelectionRestoreSnapshot | null => {
  if (terminal.select === undefined) {
    return null
  }
  const cols = readTerminalSelectionCols(terminal)
  const activeBuffer = readTerminalSelectionActiveBuffer(terminal)
  if (cols === null || activeBuffer === null) {
    return null
  }
  const rangeSnapshot = readTerminalSelectionNormalizedRangeSnapshot(terminal, cols, activeBuffer.length)
  if (rangeSnapshot === null) {
    return null
  }
  return {
    ...rangeSnapshot,
    buffer: activeBuffer,
    cols
  }
}

const canRestoreTerminalSelection = (
  terminal: TerminalSelectionRestoreTarget,
  snapshot: TerminalSelectionRestoreSnapshot
): boolean => {
  if (terminal.select === undefined || terminal.cols !== snapshot.cols) {
    return false
  }
  const activeBuffer = readTerminalSelectionActiveBuffer(terminal)
  return activeBuffer !== null &&
    activeBuffer.type === snapshot.buffer.type &&
    snapshot.endRow < activeBuffer.length
}

const didRestoreTerminalSelection = (
  terminal: TerminalSelectionRestoreTarget,
  snapshot: TerminalSelectionRestoreSnapshot
): boolean => {
  if (!canRestoreTerminalSelection(terminal, snapshot)) {
    return false
  }
  terminal.select?.(snapshot.startColumn, snapshot.startRow, snapshot.length)
  return true
}

export class TerminalSelectionContextSnapshot {
  private restoreSnapshot: TerminalSelectionRestoreSnapshot | null = null
  private selection = ""
  private timer: ReturnType<typeof setTimeout> | null = null

  readonly clear = (): void => {
    this.restoreSnapshot = null
    this.selection = ""
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  readonly has = (): boolean => this.selection.length > 0

  readonly read = (): string => this.selection

  readonly refresh = (): boolean => {
    const selection = this.terminal.getSelection()
    if (selection.length === 0) {
      this.clear()
      return false
    }
    this.selection = selection
    this.restoreSnapshot = readTerminalSelectionRestoreSnapshot(this.terminal)
    if (this.timer !== null) {
      clearTimeout(this.timer)
    }
    this.timer = setTimeout(this.clear, terminalSelectionContextSnapshotTtlMs)
    return true
  }

  /**
   * Restores xterm's visual selection after redraws reset its live selection model.
   *
   * @returns True iff a cached coordinate snapshot was valid for the current buffer and was reselected.
   * @pure false - calls the injected xterm selection facade.
   * @effect terminal.select(column,row,length).
   * @invariant restored => terminal buffer type and column count match the captured selection snapshot.
   * @precondition A previous non-empty terminal selection may have been captured.
   * @postcondition Success asks xterm to redraw an equivalent selection range in the current buffer.
   * @complexity O(1).
   * @throws Never under the validated integer/range preconditions.
   */
  // CHANGE: restore xterm's own selection from a cached coordinate snapshot
  // WHY: Claude Code can reset xterm's buffer-bound selection during redraw while the user still expects it to remain visible
  // QUOTE(ТЗ): "даже если терминал перендерился то почему оно спало?"
  // REF: user-message-2026-06-15-terminal-selection-reselect
  // SOURCE: n/a
  // FORMAT THEOREM: valid(snapshot,currentBuffer) => visibleSelection(restored(snapshot))
  // PURITY: SHELL
  // EFFECT: terminal.select(column,row,length)
  // INVARIANT: restore never crosses buffer type or column-count boundaries
  // COMPLEXITY: O(1)/O(1)
  readonly restore = (): boolean => {
    if (this.restoreSnapshot === null) {
      return false
    }
    return didRestoreTerminalSelection(this.terminal, this.restoreSnapshot)
  }

  readonly writeToClipboardData = (clipboardData: TerminalCopyClipboardData | null): boolean => {
    if (clipboardData === null || this.selection.length === 0) {
      return false
    }
    clipboardData.setData("text/plain", this.selection)
    return true
  }

  constructor(private readonly terminal: TerminalSelectionTarget & TerminalSelectionRestoreTarget) {}
}

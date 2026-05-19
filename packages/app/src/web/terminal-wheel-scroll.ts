export type TerminalWheelMouseTrackingMode = "any" | "drag" | "none" | "vt200" | "x10"

export type TerminalWheelScrollTerminal = {
  readonly modes: {
    readonly mouseTrackingMode: TerminalWheelMouseTrackingMode
  }
  readonly rows: number
  readonly scrollLines: (amount: number) => void
}

type TerminalWheelScrollEvent = {
  readonly deltaMode: number
  readonly deltaY: number
  readonly stopImmediatePropagation?: () => void
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

type TerminalWheelScrollHost = {
  readonly addEventListener: (
    type: "wheel",
    listener: (event: TerminalWheelScrollEvent) => void,
    options: AddEventListenerOptions
  ) => void
  readonly removeEventListener: (
    type: "wheel",
    listener: (event: TerminalWheelScrollEvent) => void,
    options: boolean
  ) => void
}

type TerminalWheelScrollDelta = {
  readonly deltaMode: number
  readonly deltaY: number
  readonly previousPixelDeltaY: number
  readonly rows: number
}

export type ResolvedTerminalWheelScrollDelta = {
  readonly lines: number
  readonly nextPixelDeltaY: number
}

type TerminalWheelScrollArgs = {
  readonly host: TerminalWheelScrollHost
  readonly terminal: TerminalWheelScrollTerminal
}

const wheelPixelDeltaMode = 0
const wheelLineDeltaMode = 1
const wheelPageDeltaMode = 2
const pixelsPerTerminalLine = 15

const hasActiveMouseTracking = (terminal: TerminalWheelScrollTerminal): boolean =>
  terminal.modes.mouseTrackingMode !== "none"

const validTerminalRows = (rows: number): number => {
  if (!Number.isFinite(rows) || rows < 1) {
    return 1
  }
  return Math.trunc(rows)
}

const finiteDelta = (delta: number): number => {
  if (!Number.isFinite(delta)) {
    return 0
  }
  return delta
}

export const resolveTerminalWheelScrollDelta = (
  delta: TerminalWheelScrollDelta
): ResolvedTerminalWheelScrollDelta => {
  const deltaY = finiteDelta(delta.deltaY)
  if (delta.deltaMode === wheelLineDeltaMode) {
    return { lines: Math.trunc(deltaY), nextPixelDeltaY: 0 }
  }
  if (delta.deltaMode === wheelPageDeltaMode) {
    return { lines: Math.trunc(deltaY * validTerminalRows(delta.rows)), nextPixelDeltaY: 0 }
  }
  if (delta.deltaMode !== wheelPixelDeltaMode) {
    return { lines: Math.trunc(deltaY), nextPixelDeltaY: 0 }
  }
  const nextPixelDeltaY = finiteDelta(delta.previousPixelDeltaY) + deltaY
  const lines = Math.trunc(nextPixelDeltaY / pixelsPerTerminalLine)
  return {
    lines,
    nextPixelDeltaY: nextPixelDeltaY - lines * pixelsPerTerminalLine
  }
}

export const attachTerminalWheelScroll = (
  args: TerminalWheelScrollArgs
): { readonly dispose: () => void } => {
  let previousPixelDeltaY = 0
  const onWheel = (event: TerminalWheelScrollEvent): void => {
    if (!hasActiveMouseTracking(args.terminal)) {
      return
    }
    const scrollDelta = resolveTerminalWheelScrollDelta({
      deltaMode: event.deltaMode,
      deltaY: event.deltaY,
      previousPixelDeltaY,
      rows: args.terminal.rows
    })
    previousPixelDeltaY = scrollDelta.nextPixelDeltaY
    event.preventDefault()
    event.stopPropagation()
    event.stopImmediatePropagation?.()
    if (scrollDelta.lines !== 0) {
      args.terminal.scrollLines(scrollDelta.lines)
    }
  }

  args.host.addEventListener("wheel", onWheel, { capture: true, passive: false })

  return {
    dispose: () => {
      args.host.removeEventListener("wheel", onWheel, true)
    }
  }
}

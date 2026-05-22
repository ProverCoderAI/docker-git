import { expect } from "@effect/vitest"

type TerminalCopyTestClipboardData = {
  readonly setData: (format: string, data: string) => void
}

type TerminalCopyTestClipboardEvent = {
  readonly clipboardData: TerminalCopyTestClipboardData | null
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

export type TerminalCopyTestMouseEvent = Event & {
  readonly altKey: boolean
  readonly button: number
  readonly buttons: number
  readonly clientX: number
  readonly clientY: number
  readonly screenX: number
  readonly screenY: number
  readonly shiftKey: boolean
}

type TerminalCopyTestMouseType = "mousedown" | "mousemove" | "mouseup"
type TerminalCopyTestEventType = "copy" | TerminalCopyTestMouseType
type TerminalCopyTestCopyListener = (event: TerminalCopyTestClipboardEvent) => void
type TerminalCopyTestMouseListener = (event: TerminalCopyTestMouseEvent) => void
type TerminalCopyTestListener =
  | { readonly listener: TerminalCopyTestCopyListener; readonly type: "copy" }
  | {
    readonly listener: TerminalCopyTestMouseListener
    readonly phase: "bubble" | "capture"
    readonly type: TerminalCopyTestMouseType
  }
type TerminalCopyTestAnyListener = TerminalCopyTestCopyListener | TerminalCopyTestMouseListener
type TerminalCopyTestMouseOptions = Pick<
  TerminalCopyTestMouseEvent,
  "altKey" | "buttons" | "clientX" | "clientY" | "screenX" | "screenY" | "shiftKey"
>

const isCopyTestListener = (
  type: TerminalCopyTestEventType,
  _listener: TerminalCopyTestAnyListener
): _listener is TerminalCopyTestCopyListener => type === "copy"

const isMouseTestListener = (
  type: TerminalCopyTestEventType,
  _listener: TerminalCopyTestAnyListener
): _listener is TerminalCopyTestMouseListener => type !== "copy"

const isMouseTestEventType = (
  type: string
): type is TerminalCopyTestMouseType => type === "mousedown" || type === "mousemove" || type === "mouseup"

const isMouseTestListenerEntry = (
  entry: TerminalCopyTestListener
): entry is {
  readonly listener: TerminalCopyTestMouseListener
  readonly phase: "bubble" | "capture"
  readonly type: TerminalCopyTestMouseType
} => entry.type !== "copy"

const isTerminalCopyTestMouseEvent = (event: Event): event is TerminalCopyTestMouseEvent =>
  "altKey" in event &&
  "button" in event &&
  "buttons" in event &&
  "clientX" in event &&
  "clientY" in event &&
  "screenX" in event &&
  "screenY" in event &&
  "shiftKey" in event

const optionalBoolean = (value: boolean | undefined): boolean => value ?? false

const optionalNumber = (value: number | undefined): number => value ?? 0

const defaultButtons = (type: TerminalCopyTestMouseType): number => type === "mouseup" ? 0 : 1

const resolveMouseOptions = (
  type: TerminalCopyTestMouseType,
  options: Partial<TerminalCopyTestMouseOptions>
): TerminalCopyTestMouseOptions => ({
  altKey: optionalBoolean(options.altKey),
  buttons: options.buttons ?? defaultButtons(type),
  clientX: optionalNumber(options.clientX),
  clientY: optionalNumber(options.clientY),
  screenX: optionalNumber(options.screenX),
  screenY: optionalNumber(options.screenY),
  shiftKey: optionalBoolean(options.shiftKey)
})

export class FakeTerminalCopyMouseEvent extends Event {
  altKey: boolean
  readonly button: number
  readonly buttons: number
  readonly clientX: number
  readonly clientY: number
  readonly screenX: number
  readonly screenY: number
  shiftKey: boolean
  preventDefaultCalls = 0
  stopImmediatePropagationCalls = 0
  stopPropagationCalls = 0

  constructor(
    type: TerminalCopyTestMouseType,
    button: number,
    options: Partial<TerminalCopyTestMouseOptions> = {}
  ) {
    super(type, { bubbles: true, cancelable: true })
    const resolved = resolveMouseOptions(type, options)
    this.altKey = resolved.altKey
    this.button = button
    this.buttons = resolved.buttons
    this.clientX = resolved.clientX
    this.clientY = resolved.clientY
    this.screenX = resolved.screenX
    this.screenY = resolved.screenY
    this.shiftKey = resolved.shiftKey
  }

  override preventDefault(): void {
    this.preventDefaultCalls += 1
    super.preventDefault()
  }

  override stopImmediatePropagation(): void {
    this.stopImmediatePropagationCalls += 1
    super.stopImmediatePropagation()
  }

  override stopPropagation(): void {
    this.stopPropagationCalls += 1
    super.stopPropagation()
  }
}

export class FakeTerminalCopyClipboardEvent {
  readonly clipboardData: TerminalCopyTestClipboardData | null
  preventDefaultCalls = 0
  stopPropagationCalls = 0

  constructor(clipboardData: TerminalCopyTestClipboardData | null) {
    this.clipboardData = clipboardData
  }

  preventDefault(): void {
    this.preventDefaultCalls += 1
  }

  stopPropagation(): void {
    this.stopPropagationCalls += 1
  }
}

const isPropagationStopped = (event: TerminalCopyTestMouseEvent): boolean =>
  event instanceof FakeTerminalCopyMouseEvent &&
  (event.stopPropagationCalls > 0 || event.stopImmediatePropagationCalls > 0)

const isImmediatePropagationStopped = (event: TerminalCopyTestMouseEvent): boolean =>
  event instanceof FakeTerminalCopyMouseEvent && event.stopImmediatePropagationCalls > 0

export class FakeTerminalCopyEventTarget {
  private listeners: Array<TerminalCopyTestListener> = []
  readonly dispatchedEvents: Array<Event> = []

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
      this.listeners.push({ listener, phase: "capture", type })
    }
  }

  addBubbleMouseListener(type: TerminalCopyTestMouseType, listener: TerminalCopyTestMouseListener): void {
    this.listeners.push({ listener, phase: "bubble", type })
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

  dispatchMousePhase(
    type: TerminalCopyTestMouseType,
    event: TerminalCopyTestMouseEvent,
    phase: "bubble" | "capture"
  ): void {
    for (const entry of this.listeners) {
      if (isImmediatePropagationStopped(event)) {
        return
      }
      if (isMouseTestListenerEntry(entry) && entry.phase === phase && entry.type === type) {
        entry.listener(event)
      }
    }
  }

  dispatchMouse(type: TerminalCopyTestMouseType, event: TerminalCopyTestMouseEvent): void {
    this.dispatchMousePhase(type, event, "capture")
    if (isPropagationStopped(event)) {
      return
    }
    this.dispatchMousePhase(type, event, "bubble")
  }

  dispatchCopy(event: TerminalCopyTestClipboardEvent): void {
    for (const entry of this.listeners) {
      if (entry.type === "copy") {
        entry.listener(event)
      }
    }
  }

  dispatchEvent(event: Event): boolean {
    this.dispatchedEvents.push(event)
    if (isMouseTestEventType(event.type) && isTerminalCopyTestMouseEvent(event)) {
      this.dispatchMouse(event.type, event)
    }
    return !event.defaultPrevented
  }

  listenerCount(type: TerminalCopyTestEventType): number {
    return this.listeners.filter((entry) => entry.type === type).length
  }

  captureListenerCount(type: TerminalCopyTestMouseType): number {
    return this.listeners.filter(
      (entry) => isMouseTestListenerEntry(entry) && entry.phase === "capture" && entry.type === type
    ).length
  }
}

export class FakeTerminalCopyHost extends FakeTerminalCopyEventTarget {
  readonly ownerDocument: FakeTerminalCopyEventTarget | null

  constructor(ownerDocument: FakeTerminalCopyEventTarget | null) {
    super()
    this.ownerDocument = ownerDocument
  }

  dispatchBubblingMouse(type: TerminalCopyTestMouseType, event: TerminalCopyTestMouseEvent): void {
    this.ownerDocument?.dispatchMousePhase(type, event, "capture")
    if (isPropagationStopped(event)) {
      return
    }
    this.dispatchMouse(type, event)
    if (isPropagationStopped(event)) {
      return
    }
    this.ownerDocument?.dispatchMousePhase(type, event, "bubble")
  }
}

export const mouseEvent = (
  button: number,
  type: TerminalCopyTestMouseType = "mousedown",
  options?: Partial<
    Pick<TerminalCopyTestMouseEvent, "altKey" | "buttons" | "clientX" | "clientY" | "screenX" | "screenY" | "shiftKey">
  >
): FakeTerminalCopyMouseEvent => new FakeTerminalCopyMouseEvent(type, button, options)

export const copyEvent = (
  clipboardData: TerminalCopyTestClipboardData | null
): FakeTerminalCopyClipboardEvent => new FakeTerminalCopyClipboardEvent(clipboardData)

export const expectNoDragListeners = (target: FakeTerminalCopyEventTarget): void => {
  expect(target.captureListenerCount("mousemove")).toBe(0)
  expect(target.captureListenerCount("mouseup")).toBe(0)
}

export const expectSingleMouseEvent = (
  events: ReadonlyArray<TerminalCopyTestMouseEvent>
): TerminalCopyTestMouseEvent => {
  expect(events).toHaveLength(1)
  const event = events[0]
  if (event === undefined) {
    throw new Error("Expected one mouse event.")
  }
  return event
}

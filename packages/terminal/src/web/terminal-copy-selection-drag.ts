export type TerminalMouseButtonEvent = {
  readonly button: number
}

export type TerminalSelectionModifierEvent = {
  readonly altKey: boolean
  readonly shiftKey: boolean
}

export type TerminalCopyMouseEvent = TerminalMouseButtonEvent & TerminalSelectionModifierEvent & {
  readonly buttons?: number | undefined
  readonly clientX?: number | undefined
  readonly clientY?: number | undefined
  readonly ctrlKey?: boolean | undefined
  readonly detail?: number | undefined
  readonly metaKey?: boolean | undefined
  readonly preventDefault?: (() => void) | undefined
  readonly screenX?: number | undefined
  readonly screenY?: number | undefined
  readonly stopImmediatePropagation?: (() => void) | undefined
  readonly stopPropagation?: (() => void) | undefined
}

export type TerminalSelectionDragEventType = "mousemove" | "mouseup"
export type TerminalCopyMouseEventType = "contextmenu" | "mousedown" | TerminalSelectionDragEventType

type TerminalSelectionDragListenerRegistration = (
  type: TerminalSelectionDragEventType,
  listener: (event: TerminalCopyMouseEvent) => void,
  options: true
) => void

export type TerminalSelectionDragTarget = {
  readonly addEventListener: TerminalSelectionDragListenerRegistration
  readonly dispatchEvent?: ((event: Event) => boolean) | undefined
  readonly removeEventListener: TerminalSelectionDragListenerRegistration
}

export type TerminalSelectionDragHost = TerminalSelectionDragTarget & {
  readonly ownerDocument?: TerminalSelectionDragTarget | null
}

type TerminalSelectionDragController = {
  readonly dispose: () => void
  readonly start: () => void
}

const macPlatformNames = new Set(["Mac68K", "MacIntel", "Macintosh", "MacPPC"])

const currentNavigatorPlatform = (): string => {
  if (typeof navigator === "undefined") {
    return ""
  }
  return navigator.platform
}

const terminalSelectionModifier = (platform: string): keyof TerminalSelectionModifierEvent =>
  macPlatformNames.has(platform) ? "altKey" : "shiftKey"

export const forceTerminalSelectionModifier = (
  event: TerminalSelectionModifierEvent,
  platform: string = currentNavigatorPlatform()
): boolean =>
  Reflect.defineProperty(event, terminalSelectionModifier(platform), {
    configurable: true,
    value: true
  })

const optionalNumber = (value: number | undefined): number => value ?? 0

const optionalBoolean = (value: boolean | undefined): boolean => value ?? false

const forcedTerminalMouseUpInit = (event: TerminalCopyMouseEvent): MouseEventInit => {
  const selectionModifier = terminalSelectionModifier(currentNavigatorPlatform())
  return {
    altKey: selectionModifier === "altKey" ? true : event.altKey,
    bubbles: true,
    button: event.button,
    buttons: 0,
    cancelable: true,
    clientX: optionalNumber(event.clientX),
    clientY: optionalNumber(event.clientY),
    ctrlKey: optionalBoolean(event.ctrlKey),
    detail: optionalNumber(event.detail),
    metaKey: optionalBoolean(event.metaKey),
    screenX: optionalNumber(event.screenX),
    screenY: optionalNumber(event.screenY),
    shiftKey: selectionModifier === "shiftKey" ? true : event.shiftKey
  }
}

const defineMouseEventProperty = (
  event: Event,
  property: string,
  value: boolean | number
): void => {
  Reflect.defineProperty(event, property, {
    configurable: true,
    value
  })
}

const copyMouseEventInitProperties = (
  event: Event,
  init: MouseEventInit
): void => {
  defineMouseEventProperty(event, "altKey", optionalBoolean(init.altKey))
  defineMouseEventProperty(event, "button", optionalNumber(init.button))
  defineMouseEventProperty(event, "buttons", optionalNumber(init.buttons))
  defineMouseEventProperty(event, "clientX", optionalNumber(init.clientX))
  defineMouseEventProperty(event, "clientY", optionalNumber(init.clientY))
  defineMouseEventProperty(event, "ctrlKey", optionalBoolean(init.ctrlKey))
  defineMouseEventProperty(event, "detail", optionalNumber(init.detail))
  defineMouseEventProperty(event, "metaKey", optionalBoolean(init.metaKey))
  defineMouseEventProperty(event, "screenX", optionalNumber(init.screenX))
  defineMouseEventProperty(event, "screenY", optionalNumber(init.screenY))
  defineMouseEventProperty(event, "shiftKey", optionalBoolean(init.shiftKey))
}

const createForcedTerminalMouseUpEvent = (
  sourceEvent: TerminalCopyMouseEvent
): Event => {
  const init = forcedTerminalMouseUpInit(sourceEvent)
  const event = typeof MouseEvent === "function"
    ? new MouseEvent("mouseup", init)
    : new Event("mouseup", { bubbles: true, cancelable: true })
  copyMouseEventInitProperties(event, init)
  return event
}

const suppressOriginalTerminalMouseUp = (event: TerminalCopyMouseEvent): void => {
  event.preventDefault?.()
  event.stopPropagation?.()
  event.stopImmediatePropagation?.()
}

export const suppressTerminalMouseReport = (event: TerminalCopyMouseEvent): void => {
  event.stopPropagation?.()
  event.stopImmediatePropagation?.()
}

const replayForcedTerminalMouseUp = (
  target: TerminalSelectionDragTarget,
  event: TerminalCopyMouseEvent
): void => {
  target.dispatchEvent?.(createForcedTerminalMouseUpEvent(event))
}

const resolveTerminalSelectionDragTarget = (
  host: TerminalSelectionDragHost
): TerminalSelectionDragTarget => host.ownerDocument ?? host

class TerminalSelectionDragControllerImpl implements TerminalSelectionDragController {
  private forcedSelectionDrag = false
  private selectionDragTarget: TerminalSelectionDragTarget | null = null

  constructor(private readonly host: TerminalSelectionDragHost) {}

  readonly dispose = (): void => {
    if (this.selectionDragTarget === null) {
      this.forcedSelectionDrag = false
      return
    }
    this.selectionDragTarget.removeEventListener("mousemove", this.onMouseMove, true)
    this.selectionDragTarget.removeEventListener("mouseup", this.onMouseUp, true)
    this.selectionDragTarget = null
    this.forcedSelectionDrag = false
  }

  readonly start = (): void => {
    this.dispose()
    this.forcedSelectionDrag = true
    this.selectionDragTarget = resolveTerminalSelectionDragTarget(this.host)
    this.selectionDragTarget.addEventListener("mousemove", this.onMouseMove, true)
    this.selectionDragTarget.addEventListener("mouseup", this.onMouseUp, true)
  }

  private readonly onMouseMove = (event: TerminalCopyMouseEvent): void => {
    if (this.forcedSelectionDrag) {
      forceTerminalSelectionModifier(event)
    }
  }

  private readonly onMouseUp = (event: TerminalCopyMouseEvent): void => {
    if (!this.forcedSelectionDrag) {
      return
    }
    const target = this.selectionDragTarget
    forceTerminalSelectionModifier(event)
    if (target?.dispatchEvent === undefined) {
      this.dispose()
      return
    }
    suppressOriginalTerminalMouseUp(event)
    this.dispose()
    replayForcedTerminalMouseUp(target, event)
  }
}

export const createTerminalSelectionDragController = (
  host: TerminalSelectionDragHost
): TerminalSelectionDragController => new TerminalSelectionDragControllerImpl(host)

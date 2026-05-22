export type TerminalMouseTrackingMode = "any" | "drag" | "none" | "vt200" | "x10"

type TerminalSelectionTarget = {
  readonly getSelection: () => string
  readonly hasSelection: () => boolean
}

export type TerminalCopyInteractionTerminal = TerminalSelectionTarget & {
  readonly modes: {
    readonly mouseTrackingMode: TerminalMouseTrackingMode
  }
}

type TerminalMouseButtonEvent = {
  readonly button: number
}

type TerminalSelectionModifierEvent = {
  readonly altKey: boolean
  readonly shiftKey: boolean
}

type TerminalCopyClipboardData = {
  readonly setData: (format: string, data: string) => void
}

type TerminalCopyClipboardEvent = {
  readonly clipboardData: TerminalCopyClipboardData | null
  readonly preventDefault: () => void
  readonly stopPropagation: () => void
}

type TerminalCopyMouseEvent = TerminalMouseButtonEvent & TerminalSelectionModifierEvent & {
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

type TerminalSelectionDragEventType = "mousemove" | "mouseup"
type TerminalCopyMouseEventType = "mousedown" | TerminalSelectionDragEventType

type TerminalSelectionDragListenerRegistration = (
  type: TerminalSelectionDragEventType,
  listener: (event: TerminalCopyMouseEvent) => void,
  options: true
) => void

type TerminalSelectionDragTarget = {
  readonly addEventListener: TerminalSelectionDragListenerRegistration
  readonly dispatchEvent?: ((event: Event) => boolean) | undefined
  readonly removeEventListener: TerminalSelectionDragListenerRegistration
}

type TerminalCopyListenerRegistration = {
  (type: "copy", listener: (event: TerminalCopyClipboardEvent) => void, options: true): void
  (type: TerminalCopyMouseEventType, listener: (event: TerminalCopyMouseEvent) => void, options: true): void
}

type TerminalCopyInteractionHost = {
  readonly ownerDocument?: TerminalSelectionDragTarget | null
  readonly addEventListener: TerminalCopyListenerRegistration
  readonly removeEventListener: TerminalCopyListenerRegistration
}

type TerminalCopyInteractionArgs = {
  readonly host: TerminalCopyInteractionHost
  readonly terminal: TerminalCopyInteractionTerminal
}

type TerminalSelectionDragController = {
  readonly dispose: () => void
  readonly start: () => void
}

const primaryMouseButton = 0
const secondaryMouseButton = 2

const macPlatformNames = new Set(["Mac68K", "MacIntel", "Macintosh", "MacPPC"])

const currentNavigatorPlatform = (): string => {
  if (typeof navigator === "undefined") {
    return ""
  }
  return navigator.platform
}

const isPrimaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === primaryMouseButton

const isSecondaryMouseButton = (event: TerminalMouseButtonEvent): boolean => event.button === secondaryMouseButton

const hasActiveMouseTracking = (terminal: TerminalCopyInteractionTerminal): boolean =>
  terminal.modes.mouseTrackingMode !== "none"

export const shouldForceBrowserTerminalSelection = (
  event: TerminalMouseButtonEvent,
  terminal: TerminalCopyInteractionTerminal
): boolean => isPrimaryMouseButton(event) && hasActiveMouseTracking(terminal)

export const shouldForceTerminalSelectionContext = (
  event: TerminalMouseButtonEvent,
  terminal: TerminalCopyInteractionTerminal
): boolean => isSecondaryMouseButton(event) && terminal.hasSelection()

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

export const writeTerminalSelectionToClipboardData = (
  terminal: TerminalSelectionTarget,
  clipboardData: TerminalCopyClipboardData | null
): boolean => {
  if (clipboardData === null || !terminal.hasSelection()) {
    return false
  }
  const selection = terminal.getSelection()
  if (selection.length === 0) {
    return false
  }
  clipboardData.setData("text/plain", selection)
  return true
}

const resolveTerminalSelectionDragTarget = (
  host: TerminalCopyInteractionHost
): TerminalSelectionDragTarget => host.ownerDocument ?? host

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

const suppressTerminalMouseReport = (event: TerminalCopyMouseEvent): void => {
  event.stopPropagation?.()
  event.stopImmediatePropagation?.()
}

const replayForcedTerminalMouseUp = (
  target: TerminalSelectionDragTarget,
  event: TerminalCopyMouseEvent
): void => {
  target.dispatchEvent?.(createForcedTerminalMouseUpEvent(event))
}

const createTerminalSelectionDragController = (
  host: TerminalCopyInteractionHost
): TerminalSelectionDragController => {
  let forcedSelectionDrag = false
  let selectionDragTarget: TerminalSelectionDragTarget | null = null

  const clearSelectionDrag = (): void => {
    if (selectionDragTarget === null) {
      forcedSelectionDrag = false
      return
    }
    selectionDragTarget.removeEventListener("mousemove", onMouseMove, true)
    selectionDragTarget.removeEventListener("mouseup", onMouseUp, true)
    selectionDragTarget = null
    forcedSelectionDrag = false
  }

  const onMouseMove = (event: TerminalCopyMouseEvent): void => {
    if (!forcedSelectionDrag) {
      return
    }
    forceTerminalSelectionModifier(event)
  }

  const onMouseUp = (event: TerminalCopyMouseEvent): void => {
    if (!forcedSelectionDrag) {
      return
    }
    const target = selectionDragTarget
    forceTerminalSelectionModifier(event)
    if (target?.dispatchEvent !== undefined) {
      // CHANGE: replay a clean document mouseup for xterm selection finalization.
      // WHY: xterm's mouse-report mouseup treats the original release as pty input,
      // which triggers onUserInput and clears the just-created selection.
      suppressOriginalTerminalMouseUp(event)
      clearSelectionDrag()
      replayForcedTerminalMouseUp(target, event)
      return
    }
    clearSelectionDrag()
  }

  const startSelectionDrag = (): void => {
    clearSelectionDrag()
    forcedSelectionDrag = true
    selectionDragTarget = resolveTerminalSelectionDragTarget(host)
    selectionDragTarget.addEventListener("mousemove", onMouseMove, true)
    selectionDragTarget.addEventListener("mouseup", onMouseUp, true)
  }

  return {
    dispose: clearSelectionDrag,
    start: startSelectionDrag
  }
}

export const attachTerminalCopyInteraction = (
  args: TerminalCopyInteractionArgs
): { readonly dispose: () => void } => {
  const selectionDrag = createTerminalSelectionDragController(args.host)

  const onMouseDown = (event: TerminalCopyMouseEvent): void => {
    const forceBrowserSelection = shouldForceBrowserTerminalSelection(event, args.terminal)
    const forceSelectionContext = shouldForceTerminalSelectionContext(event, args.terminal)
    if (!forceBrowserSelection && !forceSelectionContext) {
      return
    }
    forceTerminalSelectionModifier(event)
    if (forceSelectionContext) {
      suppressTerminalMouseReport(event)
      return
    }
    if (forceBrowserSelection) {
      selectionDrag.start()
    }
  }
  const onCopy = (event: TerminalCopyClipboardEvent): void => {
    if (!writeTerminalSelectionToClipboardData(args.terminal, event.clipboardData)) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
  }

  args.host.addEventListener("mousedown", onMouseDown, true)
  args.host.addEventListener("copy", onCopy, true)

  return {
    dispose: () => {
      selectionDrag.dispose()
      args.host.removeEventListener("mousedown", onMouseDown, true)
      args.host.removeEventListener("copy", onCopy, true)
    }
  }
}

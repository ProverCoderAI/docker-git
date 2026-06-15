import type { TerminalCopyMouseEvent } from "./terminal-copy-selection-drag.js"

export type TerminalCopyTextarea = {
  readonly focus: () => void
  readonly select: () => void
  readonly style: {
    height: string
    left: string
    top: string
    width: string
    zIndex: string
  }
  value: string
}

type TerminalCopyScreenElement = {
  readonly getBoundingClientRect: () => {
    readonly left: number
    readonly top: number
  }
}

export type TerminalNativeCopyMenuHost = {
  readonly getBoundingClientRect?: TerminalCopyScreenElement["getBoundingClientRect"]
  readonly querySelector?: (selector: string) => TerminalCopyScreenElement | null
}

type PrepareNativeBrowserCopyMenuArgs = {
  readonly event: TerminalCopyMouseEvent
  readonly host: TerminalNativeCopyMenuHost
  readonly selection: string
  readonly textarea: TerminalCopyTextarea | undefined
}

const terminalContextMenuTextareaOffsetPx = 10
const terminalContextMenuTextareaSizePx = 20
const xtermScreenSelector = ".xterm-screen"

const optionalNumber = (value: number | undefined): number => value ?? 0

const resolveContextMenuHostScreenElement = (
  host: TerminalNativeCopyMenuHost
): TerminalCopyScreenElement | null => {
  const getBoundingClientRect = host.getBoundingClientRect
  if (getBoundingClientRect === undefined) {
    return null
  }
  return {
    getBoundingClientRect: () => getBoundingClientRect.call(host)
  }
}

const resolveContextMenuScreenElement = (
  host: TerminalNativeCopyMenuHost
): TerminalCopyScreenElement | null =>
  host.querySelector?.(xtermScreenSelector) ?? resolveContextMenuHostScreenElement(host)

export const prepareNativeBrowserCopyMenu = (
  { event, host, selection, textarea }: PrepareNativeBrowserCopyMenuArgs
): boolean => {
  const screenElement = resolveContextMenuScreenElement(host)
  if (selection.length === 0 || textarea === undefined || screenElement === null) {
    return false
  }
  const screenPosition = screenElement.getBoundingClientRect()
  textarea.style.width = `${terminalContextMenuTextareaSizePx}px`
  textarea.style.height = `${terminalContextMenuTextareaSizePx}px`
  textarea.style.left = `${optionalNumber(event.clientX) - screenPosition.left - terminalContextMenuTextareaOffsetPx}px`
  textarea.style.top = `${optionalNumber(event.clientY) - screenPosition.top - terminalContextMenuTextareaOffsetPx}px`
  textarea.style.zIndex = "1000"
  textarea.focus()
  textarea.value = selection
  textarea.select()
  return true
}

export const clearNativeBrowserCopyMenu = (
  textarea: TerminalCopyTextarea | undefined
): void => {
  if (textarea !== undefined) {
    textarea.value = ""
  }
}

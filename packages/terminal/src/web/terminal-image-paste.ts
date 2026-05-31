import type { Terminal } from "xterm"

import type { TerminalPasteGuard, TerminalSocketRef } from "./terminal-panel-runtime-types.js"

type TerminalImagePasteArgs = {
  readonly host: HTMLDivElement
  readonly notifyMessage: (message: string) => void
  readonly pasteGuard: TerminalPasteGuard
  readonly socketRef: TerminalSocketRef
  readonly terminal: Terminal
}

type TerminalImagePasteClientMessage = {
  readonly data: string
  readonly mediaType: string
  readonly name: string
  readonly size: number
  readonly type: "image"
}

type TerminalPasteTrapState = {
  active: boolean
  restoreTimer: ReturnType<typeof setTimeout> | null
}

const terminalImagePasteMaxBytes = 10 * 1024 * 1024
const dataUrlBase64Marker = ";base64,"
const nativeImagePasteControlInput = "\u0016"
const nativeImagePasteSuppressWindowMs = 800
const pasteTrapRestoreDelayMs = 800
const supportedImageMediaTypes = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"])

export const extractTerminalImageBase64 = (dataUrl: string): string | null => {
  const markerIndex = dataUrl.indexOf(dataUrlBase64Marker)
  return markerIndex === -1 ? null : dataUrl.slice(markerIndex + dataUrlBase64Marker.length)
}

const fileLabel = (file: File): string => {
  const trimmed = file.name.trim()
  return trimmed.length > 0 ? trimmed : "clipboard-image"
}

const isSupportedImageFile = (file: File): boolean => supportedImageMediaTypes.has(file.type.toLowerCase())

const imageFilesFromItems = (items: DataTransferItemList): ReadonlyArray<File> =>
  [...items].flatMap((item) => {
    if (item.kind !== "file" || !item.type.toLowerCase().startsWith("image/")) {
      return []
    }
    const file = item.getAsFile()
    return file === null ? [] : [file]
  })

export const terminalImageFilesFromTransfer = (
  dataTransfer: DataTransfer | null
): ReadonlyArray<File> => {
  if (dataTransfer === null) {
    return []
  }
  const files = [...dataTransfer.files].filter((file) => file.type.toLowerCase().startsWith("image/"))
  return files.length > 0 ? files : imageFilesFromItems(dataTransfer.items)
}

const hasImageFileTransfer = (dataTransfer: DataTransfer | null): boolean => {
  if (dataTransfer === null) {
    return false
  }
  return [...dataTransfer.items].some((item) => item.kind === "file" && item.type.toLowerCase().startsWith("image/")) ||
    [...dataTransfer.files].some((file) => file.type.toLowerCase().startsWith("image/"))
}

const socketCanSend = (socket: WebSocket | null): socket is WebSocket =>
  socket !== null && socket.readyState === WebSocket.OPEN

const sendTerminalInput = (
  args: TerminalImagePasteArgs,
  data: string
): void => {
  const socket = args.socketRef.current
  if (!socketCanSend(socket)) {
    args.notifyMessage("Terminal is not connected; clipboard was not pasted.")
    return
  }
  socket.send(JSON.stringify({ data, type: "input" }))
}

const createImagePasteMessage = (
  file: File,
  base64: string
): TerminalImagePasteClientMessage => ({
  data: base64,
  mediaType: file.type,
  name: fileLabel(file),
  size: file.size,
  type: "image"
})

const sendImagePasteMessage = (
  args: TerminalImagePasteArgs,
  file: File,
  base64: string
): void => {
  const socket = args.socketRef.current
  if (!socketCanSend(socket)) {
    args.notifyMessage("Terminal is not connected; image was not pasted.")
    return
  }
  socket.send(JSON.stringify(createImagePasteMessage(file, base64)))
}

const readAndSendImageFile = (
  args: TerminalImagePasteArgs,
  file: File
): void => {
  if (!isSupportedImageFile(file)) {
    args.notifyMessage(`Unsupported image type: ${file.type || "unknown"}.`)
    return
  }
  if (file.size <= 0) {
    args.notifyMessage("Image clipboard item is empty.")
    return
  }
  if (file.size > terminalImagePasteMaxBytes) {
    args.notifyMessage(`Image is too large. Max size is ${terminalImagePasteMaxBytes} bytes.`)
    return
  }
  const reader = new FileReader()
  reader.addEventListener("load", () => {
    if (typeof reader.result !== "string") {
      args.notifyMessage("Could not read pasted image.")
      return
    }
    const base64 = extractTerminalImageBase64(reader.result)
    if (base64 === null) {
      args.notifyMessage("Could not encode pasted image.")
      return
    }
    sendImagePasteMessage(args, file, base64)
  })
  reader.addEventListener("error", () => {
    args.notifyMessage("Could not read pasted image.")
  })
  reader.readAsDataURL(file)
}

const handleImageFiles = (
  args: TerminalImagePasteArgs,
  files: ReadonlyArray<File>
): void => {
  if (files.length === 0) {
    return
  }
  args.notifyMessage(files.length === 1 ? "Uploading pasted image..." : `Uploading ${files.length} pasted images...`)
  for (const file of files) {
    readAndSendImageFile(args, file)
  }
  args.terminal.focus()
}

const textFromTransfer = (dataTransfer: DataTransfer | null): string => dataTransfer?.getData("text/plain") ?? ""

const handleTerminalClipboardTransfer = (
  args: TerminalImagePasteArgs,
  dataTransfer: DataTransfer | null,
  includeText: boolean
): boolean => {
  const files = terminalImageFilesFromTransfer(dataTransfer)
  if (files.length > 0) {
    handleImageFiles(args, files)
    return true
  }
  if (!includeText) {
    return false
  }
  const text = textFromTransfer(dataTransfer)
  if (text.length === 0) {
    return false
  }
  sendTerminalInput(args, text)
  args.terminal.focus()
  return true
}

const handleTerminalImageDragOver = (event: DragEvent): void => {
  if (!hasImageFileTransfer(event.dataTransfer)) {
    return
  }
  event.preventDefault()
  if (event.dataTransfer !== null) {
    event.dataTransfer.dropEffect = "copy"
  }
}

type TerminalPasteShortcutEvent = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey">

export const createTerminalPasteGuard = (
  currentTimeMillis: () => number = () => Date.now()
): TerminalPasteGuard => {
  let expiresAtMs = 0
  let pending = false
  return {
    shouldSuppressTerminalInput: (data) => {
      if (!pending || data !== nativeImagePasteControlInput || currentTimeMillis() > expiresAtMs) {
        return false
      }
      pending = false
      return true
    },
    suppressNextNativeImagePaste: () => {
      pending = true
      expiresAtMs = currentTimeMillis() + nativeImagePasteSuppressWindowMs
    }
  }
}

export const isTerminalPasteShortcut = (event: TerminalPasteShortcutEvent): boolean =>
  (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === "v"

const eventTargetInsideHost = (
  host: HTMLDivElement,
  event: Event
): boolean => event.target instanceof Node && host.contains(event.target)

const createTerminalPasteTrap = (host: HTMLDivElement): HTMLTextAreaElement => {
  const trap = document.createElement("textarea")
  trap.setAttribute("aria-hidden", "true")
  trap.tabIndex = -1
  trap.style.position = "fixed"
  trap.style.left = "-10000px"
  trap.style.top = "0"
  trap.style.width = "1px"
  trap.style.height = "1px"
  trap.style.opacity = "0"
  trap.style.pointerEvents = "none"
  host.append(trap)
  return trap
}

const clearPasteTrapTimer = (state: TerminalPasteTrapState): void => {
  if (state.restoreTimer !== null) {
    clearTimeout(state.restoreTimer)
    state.restoreTimer = null
  }
}

const deactivatePasteTrap = (
  args: TerminalImagePasteArgs,
  state: TerminalPasteTrapState
): void => {
  clearPasteTrapTimer(state)
  state.active = false
  args.terminal.focus()
}

const activatePasteTrap = (
  args: TerminalImagePasteArgs,
  trap: HTMLTextAreaElement,
  state: TerminalPasteTrapState
): void => {
  clearPasteTrapTimer(state)
  state.active = true
  trap.value = ""
  trap.focus()
  trap.select()
  state.restoreTimer = setTimeout(() => {
    deactivatePasteTrap(args, state)
  }, pasteTrapRestoreDelayMs)
}

export const attachTerminalImagePaste = (
  args: TerminalImagePasteArgs
): { readonly dispose: () => void } => {
  const pasteTrap = createTerminalPasteTrap(args.host)
  const trapState: TerminalPasteTrapState = { active: false, restoreTimer: null }
  const onPaste = (event: ClipboardEvent): void => {
    const handled = handleTerminalClipboardTransfer(args, event.clipboardData, trapState.active)
    if (!handled) {
      return
    }
    event.preventDefault()
    event.stopPropagation()
    deactivatePasteTrap(args, trapState)
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!isTerminalPasteShortcut(event) || !eventTargetInsideHost(args.host, event)) {
      return
    }
    args.pasteGuard.suppressNextNativeImagePaste()
    event.stopImmediatePropagation()
    event.stopPropagation()
    activatePasteTrap(args, pasteTrap, trapState)
  }
  const onDrop = (event: DragEvent): void => {
    const files = terminalImageFilesFromTransfer(event.dataTransfer)
    if (files.length === 0) {
      return
    }
    event.preventDefault()
    handleImageFiles(args, files)
  }

  args.host.addEventListener("paste", onPaste, true)
  globalThis.addEventListener("keydown", onKeyDown, true)
  args.host.addEventListener("dragover", handleTerminalImageDragOver, true)
  args.host.addEventListener("drop", onDrop, true)

  return {
    dispose: () => {
      clearPasteTrapTimer(trapState)
      args.host.removeEventListener("paste", onPaste, true)
      globalThis.removeEventListener("keydown", onKeyDown, true)
      args.host.removeEventListener("dragover", handleTerminalImageDragOver, true)
      args.host.removeEventListener("drop", onDrop, true)
      pasteTrap.remove()
    }
  }
}

import type { IDisposable, ILink, Terminal } from "xterm"

import { detectTerminalImagePathMatches } from "./terminal-image-paths.js"
import { resolveTerminalImageFetchUrl } from "./terminal-image-url.js"
import type { TerminalLifecycleState } from "./terminal-panel-runtime-types.js"
import type { ActiveTerminalSession } from "./terminal.js"

export const terminalInlineImagePreviewLimit = 20
export const terminalInlineImagePreviewRows = 4

export const terminalInlineImageSpacer = "\r\n".repeat(terminalInlineImagePreviewRows)

const terminalInlineImagePreviewColumns = 16
const terminalInlineImagePreviewHeightPx = 56
const terminalInlineImagePreviewWidthPx = 96

export type TerminalInlineImageEntry =
  | {
    readonly _tag: "AvailableTerminalInlineImage"
    readonly displayUrl: string
    readonly fetchUrl: string
    readonly path: string
  }
  | {
    readonly _tag: "UnavailableTerminalInlineImage"
    readonly fetchUrl: string
    readonly path: string
  }

type TerminalInlineImageObjectUrlCache = Map<string, string>

const availableTerminalInlineImageEntry = (
  path: string,
  fetchUrl: string,
  displayUrl: string
): TerminalInlineImageEntry => ({
  _tag: "AvailableTerminalInlineImage",
  displayUrl,
  fetchUrl,
  path
})

export const unavailableTerminalInlineImageEntry = (
  path: string,
  fetchUrl: string
): TerminalInlineImageEntry => ({
  _tag: "UnavailableTerminalInlineImage",
  fetchUrl,
  path
})

export const cachedTerminalInlineImageEntry = (
  cache: TerminalInlineImageObjectUrlCache,
  path: string,
  fetchUrl: string
): TerminalInlineImageEntry | null => {
  const displayUrl = cache.get(path)
  return displayUrl === undefined ? null : availableTerminalInlineImageEntry(path, fetchUrl, displayUrl)
}

const revokeTerminalInlineImageObjectUrl = (displayUrl: string): void => {
  URL.revokeObjectURL(displayUrl)
}

const trimTerminalInlineImageObjectUrlCache = (
  cache: TerminalInlineImageObjectUrlCache
): void => {
  while (cache.size > terminalInlineImagePreviewLimit) {
    const first = cache.entries().next()
    if (first.done) {
      return
    }
    const [path, displayUrl] = first.value
    cache.delete(path)
    revokeTerminalInlineImageObjectUrl(displayUrl)
  }
}

export const cacheTerminalInlineImageBlob = (
  cache: TerminalInlineImageObjectUrlCache,
  path: string,
  fetchUrl: string,
  blob: Blob
): TerminalInlineImageEntry => {
  const cached = cachedTerminalInlineImageEntry(cache, path, fetchUrl)
  if (cached !== null) {
    return cached
  }
  const displayUrl = URL.createObjectURL(blob)
  cache.set(path, displayUrl)
  trimTerminalInlineImageObjectUrlCache(cache)
  return availableTerminalInlineImageEntry(path, fetchUrl, displayUrl)
}

export const revokeTerminalInlineImageObjectUrlCache = (
  cache: TerminalInlineImageObjectUrlCache
): void => {
  for (const displayUrl of cache.values()) {
    revokeTerminalInlineImageObjectUrl(displayUrl)
  }
  cache.clear()
}

const terminalInlineImageLinkUrl = (entry: TerminalInlineImageEntry): string =>
  entry._tag === "AvailableTerminalInlineImage" ? entry.displayUrl : entry.fetchUrl

const terminalInlineImageTitle = (entry: TerminalInlineImageEntry): string =>
  entry._tag === "AvailableTerminalInlineImage" ? entry.path : `${entry.path} unavailable`

const createTerminalInlineImageLink = (entry: TerminalInlineImageEntry): HTMLAnchorElement => {
  const link = document.createElement("a")
  link.href = terminalInlineImageLinkUrl(entry)
  link.rel = "noreferrer"
  link.target = "_blank"
  link.title = terminalInlineImageTitle(entry)
  link.style.alignItems = "center"
  link.style.background = "#0d1218"
  link.style.border = "1px solid #3a4652"
  link.style.borderRadius = "6px"
  link.style.boxSizing = "border-box"
  link.style.cursor = "pointer"
  link.style.display = "inline-flex"
  link.style.height = `min(${terminalInlineImagePreviewHeightPx}px, calc(100% - 8px))`
  link.style.justifyContent = "center"
  link.style.margin = "4px 0"
  link.style.padding = "4px"
  link.style.pointerEvents = "auto"
  link.style.width = `min(${terminalInlineImagePreviewWidthPx}px, 100%)`
  return link
}

const appendAvailableTerminalInlineImage = (
  link: HTMLAnchorElement,
  entry: Extract<TerminalInlineImageEntry, { readonly _tag: "AvailableTerminalInlineImage" }>
): void => {
  const image = document.createElement("img")
  image.alt = entry.path
  image.src = entry.displayUrl
  image.style.borderRadius = "4px"
  image.style.display = "block"
  image.style.height = "100%"
  image.style.objectFit = "contain"
  image.style.width = "100%"
  link.append(image)
}

const appendUnavailableTerminalInlineImage = (link: HTMLAnchorElement): void => {
  const label = document.createElement("span")
  label.textContent = "unavailable"
  label.style.color = "#9aa8b6"
  label.style.fontFamily = "'IBM Plex Mono', ui-monospace, monospace"
  label.style.fontSize = "11px"
  label.style.lineHeight = "1"
  label.style.overflow = "hidden"
  label.style.textOverflow = "ellipsis"
  label.style.whiteSpace = "nowrap"
  link.append(label)
}

const appendTerminalInlineImageContent = (
  link: HTMLAnchorElement,
  entry: TerminalInlineImageEntry
): void => {
  if (entry._tag === "AvailableTerminalInlineImage") {
    appendAvailableTerminalInlineImage(link, entry)
    return
  }
  appendUnavailableTerminalInlineImage(link)
}

const openImage = (fetchUrl: string): void => {
  const imageWindow = window.open(fetchUrl, "_blank", "noopener,noreferrer")
  if (imageWindow === null) {
    return
  }
  imageWindow.opener = null
}

const appendDecorationDisposable = (
  lifecycle: TerminalLifecycleState,
  disposable: IDisposable
): void => {
  lifecycle.inlineImageDisposables.push(disposable)
  if (lifecycle.inlineImageDisposables.length <= terminalInlineImagePreviewLimit) {
    return
  }
  lifecycle.inlineImageDisposables.shift()?.dispose()
}

const renderInlineImageElement = (
  element: HTMLElement,
  entry: TerminalInlineImageEntry
): void => {
  if (element.dataset["path"] === entry.path && element.dataset["tag"] === entry._tag) {
    return
  }

  const link = createTerminalInlineImageLink(entry)
  appendTerminalInlineImageContent(link, entry)

  element.dataset["path"] = entry.path
  element.dataset["tag"] = entry._tag
  element.style.pointerEvents = "none"
  element.replaceChildren(link)
}

export const appendTerminalInlineImagePreview = (
  terminal: Terminal,
  lifecycle: TerminalLifecycleState,
  entry: TerminalInlineImageEntry
): boolean => {
  const marker = terminal.registerMarker(0)
  const decoration = terminal.registerDecoration({
    height: terminalInlineImagePreviewRows,
    layer: "top",
    marker,
    width: Math.min(terminalInlineImagePreviewColumns, Math.max(1, terminal.cols))
  })
  if (decoration === undefined) {
    marker.dispose()
    return false
  }

  decoration.onRender((element) => {
    renderInlineImageElement(element, entry)
  })
  appendDecorationDisposable(lifecycle, decoration)
  return true
}

const imageLink = (
  session: ActiveTerminalSession,
  bufferLineNumber: number,
  match: ReturnType<typeof detectTerminalImagePathMatches>[number]
): ILink => {
  const fetchUrl = resolveTerminalImageFetchUrl(session.websocketPath, match.path)
  return {
    activate: () => {
      openImage(fetchUrl)
    },
    decorations: {
      pointerCursor: true,
      underline: true
    },
    range: {
      end: {
        x: match.endIndex,
        y: bufferLineNumber
      },
      start: {
        x: match.startIndex + 1,
        y: bufferLineNumber
      }
    },
    text: match.path
  }
}

export const attachTerminalImageLinks = (
  terminal: Terminal,
  session: ActiveTerminalSession
): IDisposable =>
  terminal.registerLinkProvider({
    provideLinks: (bufferLineNumber, callback) => {
      const line = terminal.buffer.active.getLine(bufferLineNumber - 1)
      if (line === undefined) {
        callback([])
        return
      }
      const text = line.translateToString(true)
      const matches = detectTerminalImagePathMatches(text)
      callback(matches.map((match) => imageLink(session, bufferLineNumber, match)))
    }
  })

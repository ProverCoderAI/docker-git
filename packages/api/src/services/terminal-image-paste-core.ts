export type TerminalImagePastePayload = {
  readonly data: string
  readonly mediaType: string
  readonly name: string
  readonly size: number
}

export type TerminalImagePastePlan =
  | {
    readonly _tag: "InvalidTerminalImagePaste"
    readonly message: string
  }
  | {
    readonly _tag: "ValidTerminalImagePaste"
    readonly containerPath: string
    readonly decodedBytes: number
    readonly normalizedBase64: string
  }

export const terminalImagePasteDirectory = "/home/dev/.docker-git/pasted-images"
export const terminalImagePasteMaxBytes = 10 * 1024 * 1024

const base64Pattern = /^(?:[+/0-9A-Za-z]{4})*(?:[+/0-9A-Za-z]{2}==|[+/0-9A-Za-z]{3}=)?$/u
const terminalImagePasteMaxBase64Length = Math.ceil(terminalImagePasteMaxBytes / 3) * 4
const safeFileNameMaxLength = 72

const imageMediaTypeExtensions = new Map<string, string>([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
])

export const isSupportedTerminalImageMediaType = (mediaType: string): boolean =>
  imageMediaTypeExtensions.has(mediaType.toLowerCase())

const extensionForMediaType = (mediaType: string): string | null =>
  imageMediaTypeExtensions.get(mediaType.toLowerCase()) ?? null

const normalizeBase64 = (data: string): string => data.replace(/\s+/gu, "")

const decodedBase64Bytes = (data: string): number | null => {
  if (data.length === 0 || data.length % 4 !== 0 || !base64Pattern.test(data)) {
    return null
  }
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0
  return data.length / 4 * 3 - padding
}

const lastPathSegment = (name: string): string => {
  const segments = name.split(/[\\/]/u)
  return segments.at(-1) ?? ""
}

export const sanitizeTerminalImageBaseName = (name: string): string => {
  const withoutExtension = lastPathSegment(name).replace(/\.[^.]*$/u, "")
  const sanitized = withoutExtension
    .replace(/[^0-9A-Za-z._-]+/gu, "-")
    .replace(/^[.-]+/u, "")
    .replace(/[.-]+$/u, "")
    .slice(0, safeFileNameMaxLength)
  return sanitized.length > 0 ? sanitized : "clipboard-image"
}

const terminalImageFileName = (
  id: string,
  name: string,
  mediaType: string
): string | null => {
  const extension = extensionForMediaType(mediaType)
  if (extension === null) {
    return null
  }
  return `${id}-${sanitizeTerminalImageBaseName(name)}.${extension}`
}

export const createTerminalImagePastePlan = (
  payload: TerminalImagePastePayload,
  id: string
): TerminalImagePastePlan => {
  const mediaType = payload.mediaType.toLowerCase()
  const fileName = terminalImageFileName(id, payload.name, mediaType)
  if (fileName === null) {
    return {
      _tag: "InvalidTerminalImagePaste",
      message: `Unsupported image type: ${payload.mediaType || "unknown"}.`
    }
  }
  if (!Number.isFinite(payload.size) || payload.size <= 0) {
    return {
      _tag: "InvalidTerminalImagePaste",
      message: "Image payload is empty."
    }
  }
  if (payload.size > terminalImagePasteMaxBytes) {
    return {
      _tag: "InvalidTerminalImagePaste",
      message: `Image is too large. Max size is ${terminalImagePasteMaxBytes} bytes.`
    }
  }
  const normalizedBase64 = normalizeBase64(payload.data)
  if (normalizedBase64.length > terminalImagePasteMaxBase64Length) {
    return {
      _tag: "InvalidTerminalImagePaste",
      message: `Image is too large. Max size is ${terminalImagePasteMaxBytes} bytes.`
    }
  }
  const decodedBytes = decodedBase64Bytes(normalizedBase64)
  if (decodedBytes === null) {
    return {
      _tag: "InvalidTerminalImagePaste",
      message: "Image payload is not valid base64."
    }
  }
  if (decodedBytes !== payload.size) {
    return {
      _tag: "InvalidTerminalImagePaste",
      message: "Image payload size does not match its base64 data."
    }
  }
  return {
    _tag: "ValidTerminalImagePaste",
    containerPath: `${terminalImagePasteDirectory}/${fileName}`,
    decodedBytes,
    normalizedBase64
  }
}

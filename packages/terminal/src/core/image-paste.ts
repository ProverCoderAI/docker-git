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

type InvalidTerminalImagePastePlan = Extract<
  TerminalImagePastePlan,
  { readonly _tag: "InvalidTerminalImagePaste" }
>

/**
 * Container directory used for image paste files.
 *
 * @pure true
 * @invariant all valid paste plans place files under this absolute directory.
 * @complexity O(1)
 */
// CHANGE: define the shared paste directory in terminal core.
// WHY: API/runtime adapters need one deterministic container path root.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: ∀validPlan: startsWith(validPlan.containerPath, terminalImagePasteDirectory + "/")
// PURITY: CORE
// INVARIANT: paste directory is absolute and deterministic.
// COMPLEXITY: O(1)/O(1)
export const terminalImagePasteDirectory = "/home/dev/.docker-git/pasted-images"

/**
 * Maximum accepted pasted image payload size in bytes.
 *
 * @pure true
 * @invariant terminalImagePasteMaxBytes > 0
 * @complexity O(1)
 */
export const terminalImagePasteMaxBytes = 10 * 1024 * 1024

const base64Pattern = /^(?:[+/0-9A-Za-z]{4})*(?:[+/0-9A-Za-z]{2}==|[+/0-9A-Za-z]{3}=)?$/u
const terminalImagePasteMaxBase64Length = Math.ceil(terminalImagePasteMaxBytes / 3) * 4
const terminalImagePasteTooLargeMessage = `Image is too large. Max size is ${terminalImagePasteMaxBytes} bytes.`
const safeFileNameMaxLength = 72

const imageMediaTypeExtensions = new Map<string, string>([
  ["image/gif", "gif"],
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"]
])

type TerminalImagePasteDataValidation =
  | {
    readonly _tag: "InvalidTerminalImagePaste"
    readonly message: string
  }
  | {
    readonly _tag: "ValidTerminalImagePasteData"
    readonly decodedBytes: number
  }

const invalidTerminalImagePaste = (
  message: string
): InvalidTerminalImagePastePlan => ({
  _tag: "InvalidTerminalImagePaste",
  message
})

/**
 * Checks whether a pasted image media type can be persisted by terminal core.
 *
 * @pure true
 * @param mediaType - Browser supplied image media type.
 * @returns true when the media type maps to a supported file extension.
 * @invariant result = true iff lower(mediaType) is in imageMediaTypeExtensions.
 * @precondition mediaType may be any string.
 * @postcondition input is not mutated.
 * @complexity O(1)
 */
// CHANGE: expose media-type support as pure terminal core logic.
// WHY: callers can reject unsupported clipboard payloads before shell effects.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: supported(m) ⇔ lower(m) ∈ keys(imageMediaTypeExtensions)
// PURITY: CORE
// INVARIANT: support check is deterministic and case-insensitive.
// COMPLEXITY: O(1)/O(1)
export const isSupportedTerminalImageMediaType = (mediaType: string): boolean =>
  imageMediaTypeExtensions.has(mediaType.toLowerCase())

const extensionForMediaType = (mediaType: string): string | null =>
  imageMediaTypeExtensions.get(mediaType.toLowerCase()) ?? null

const normalizeBase64 = (data: string): string => data.replaceAll(/\s+/gu, "")

const base64PaddingLength = (data: string): number => {
  if (data.endsWith("==")) {
    return 2
  }
  if (data.endsWith("=")) {
    return 1
  }
  return 0
}

const decodedBase64Bytes = (data: string): number | null => {
  if (data.length === 0 || data.length % 4 !== 0 || !base64Pattern.test(data)) {
    return null
  }
  const padding = base64PaddingLength(data)
  return (data.length / 4) * 3 - padding
}

const lastPathSegment = (name: string): string => {
  const segments = name.split(/[\\/]/u)
  return segments.at(-1) ?? ""
}

const withoutLastExtension = (name: string): string => {
  const lastDot = name.lastIndexOf(".")
  return lastDot === -1 ? name : name.slice(0, lastDot)
}

const isFileNameBoundaryChar = (char: string | undefined): boolean => char === "." || char === "-"

const leftFileNameBoundaryIndex = (name: string, index: number): number =>
  isFileNameBoundaryChar(name[index])
    ? leftFileNameBoundaryIndex(name, index + 1)
    : index

const rightFileNameBoundaryIndex = (name: string, end: number): number =>
  end > 0 && isFileNameBoundaryChar(name[end - 1])
    ? rightFileNameBoundaryIndex(name, end - 1)
    : end

const trimFileNameBoundaryChars = (name: string): string => {
  const start = leftFileNameBoundaryIndex(name, 0)
  const end = rightFileNameBoundaryIndex(name, name.length)
  return name.slice(start, Math.max(start, end))
}

const normalizeTerminalImagePathSegmentChars = (value: string): string =>
  value.replaceAll(/[^0-9A-Za-z._-]+/gu, "-").replaceAll(/\.{2,}/gu, ".")

/**
 * Sanitizes a user-provided file name into a single safe image base name.
 *
 * @pure true
 * @param name - Browser or clipboard supplied image filename.
 * @returns Safe non-empty file basename without extension.
 * @invariant result.length > 0
 * @invariant result excludes "/" and "\\".
 * @invariant result excludes "..".
 * @precondition name may be any string.
 * @postcondition result can be used as one POSIX path segment.
 * @complexity O(n) where n = name.length
 */
// CHANGE: centralize terminal image filename sanitization.
// WHY: pasted images cross a browser-to-container boundary.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: ∀name: segment(sanitizeTerminalImageBaseName(name))
// PURITY: CORE
// INVARIANT: sanitized base name is one non-empty non-traversal path segment.
// COMPLEXITY: O(n)/O(n)
export const sanitizeTerminalImageBaseName = (name: string): string => {
  const withoutExtension = withoutLastExtension(lastPathSegment(name))
  const sanitized = trimFileNameBoundaryChars(
    normalizeTerminalImagePathSegmentChars(withoutExtension)
  ).slice(0, safeFileNameMaxLength)
  return sanitized.length > 0 ? sanitized : "clipboard-image"
}

const sanitizeTerminalImageIdSegment = (id: string): string => {
  const sanitized = trimFileNameBoundaryChars(
    normalizeTerminalImagePathSegmentChars(lastPathSegment(id))
  ).slice(0, safeFileNameMaxLength)
  return sanitized.length > 0 ? sanitized : "paste"
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
  return `${sanitizeTerminalImageIdSegment(id)}-${sanitizeTerminalImageBaseName(name)}.${extension}`
}

const validateTerminalImagePasteData = (
  payload: TerminalImagePastePayload,
  normalizedBase64: string
): TerminalImagePasteDataValidation => {
  if (normalizedBase64.length > terminalImagePasteMaxBase64Length) {
    return invalidTerminalImagePaste(terminalImagePasteTooLargeMessage)
  }
  const decodedBytes = decodedBase64Bytes(normalizedBase64)
  if (decodedBytes === null) {
    return invalidTerminalImagePaste("Image payload is not valid base64.")
  }
  if (decodedBytes !== payload.size) {
    return invalidTerminalImagePaste("Image payload size does not match its base64 data.")
  }
  return {
    _tag: "ValidTerminalImagePasteData",
    decodedBytes
  }
}

/**
 * Builds a pure paste plan for writing an image payload inside the container.
 *
 * @pure true
 * @param payload - Clipboard image payload encoded as base64.
 * @param id - Caller supplied paste id; sanitized before it becomes a filename segment.
 * @returns A valid write plan or typed validation failure.
 * @invariant valid.decodedBytes = payload.size
 * @invariant valid.containerPath starts with terminalImagePasteDirectory + "/"
 * @invariant valid.containerPath contains no caller-controlled path separators after the directory prefix
 * @precondition payload.data is expected to be base64 text, possibly with whitespace.
 * @postcondition no filesystem or process effects are performed.
 * @complexity O(n) where n = payload.data.length + payload.name.length + id.length
 */
// CHANGE: plan terminal image paste writes as pure data.
// WHY: API runtime should perform effects only after core validates size, type, and path.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: valid(plan(payload,id)) → bytes(base64(payload.data)) = payload.size
// PURITY: CORE
// INVARIANT: valid plans never escape terminalImagePasteDirectory.
// COMPLEXITY: O(n)/O(n)
export const createTerminalImagePastePlan = (
  payload: TerminalImagePastePayload,
  id: string
): TerminalImagePastePlan => {
  const mediaType = payload.mediaType.toLowerCase()
  const fileName = terminalImageFileName(id, payload.name, mediaType)
  if (fileName === null) {
    return invalidTerminalImagePaste(`Unsupported image type: ${payload.mediaType || "unknown"}.`)
  }
  if (!Number.isFinite(payload.size) || payload.size <= 0) {
    return invalidTerminalImagePaste("Image payload is empty.")
  }
  if (payload.size > terminalImagePasteMaxBytes) {
    return invalidTerminalImagePaste(terminalImagePasteTooLargeMessage)
  }
  const normalizedBase64 = normalizeBase64(payload.data)
  const validation = validateTerminalImagePasteData(payload, normalizedBase64)
  if (validation._tag === "InvalidTerminalImagePaste") {
    return validation
  }
  return {
    _tag: "ValidTerminalImagePaste",
    containerPath: `${terminalImagePasteDirectory}/${fileName}`,
    decodedBytes: validation.decodedBytes,
    normalizedBase64
  }
}

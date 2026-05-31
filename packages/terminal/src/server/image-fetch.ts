export type TerminalImageFetchPlan =
  | {
    readonly _tag: "InvalidTerminalImageFetch"
    readonly message: string
  }
  | {
    readonly _tag: "ValidTerminalImageFetch"
    readonly containerPath: string
    readonly mediaType: string
  }

type InvalidTerminalImageFetchPlan = Extract<
  TerminalImageFetchPlan,
  { readonly _tag: "InvalidTerminalImageFetch" }
>

/**
 * Maximum accepted fetched image size in bytes.
 *
 * @pure true
 * @invariant terminalImageFetchMaxBytes > 0
 * @complexity O(1)
 */
// CHANGE: expose a shared fetch size budget for terminal image adapters.
// WHY: server runtimes need one deterministic image fetch bound.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: terminalImageFetchMaxBytes = 10 MiB
// PURITY: CORE
// INVARIANT: fetch budget is positive and deterministic.
// COMPLEXITY: O(1)/O(1)
export const terminalImageFetchMaxBytes = 10 * 1024 * 1024

const supportedExtensionMediaTypes = new Map<string, string>([
  ["gif", "image/gif"],
  ["jpeg", "image/jpeg"],
  ["jpg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"]
])

const controlCharRange = `${String.fromCodePoint(0)}-${String.fromCodePoint(0x1F)}`
const deleteChar = String.fromCodePoint(0x7F)
const invalidCharacterPattern = new RegExp(
  String.raw`[\s${controlCharRange}${deleteChar}]`,
  "u"
)
const traversalPattern = /(?:^|\/)(?:\.|\.\.)(?=\/|$)/u
const urlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/u
const fileUrlPattern = /^file:\/\//iu
const encodedPathSeparatorPattern = /%(?:2f|5c)/iu
const encodedSpacePattern = /%20/giu
const fileUrlBackslashPattern = /\\/u
const fileUrlTraversalPattern = /(?:^|[\\/])(?:\.|%2e)(?:(?:\.|%2e))?(?=[\\/]|$)/iu
const invalidPercentEncodingPattern = /%(?![0-9A-Fa-f]{2})/u

type TerminalImagePathNormalization =
  | {
    readonly _tag: "InvalidTerminalImagePath"
    readonly message: string
  }
  | {
    readonly _tag: "ValidTerminalImagePath"
    readonly path: string
  }

type InvalidTerminalImagePathNormalization = Extract<
  TerminalImagePathNormalization,
  { readonly _tag: "InvalidTerminalImagePath" }
>

type TerminalImageContainerPathResolution =
  | InvalidTerminalImageFetchPlan
  | {
    readonly _tag: "ValidTerminalImageContainerPath"
    readonly containerPath: string
  }

const invalidTerminalImageFetch = (
  message: string
): InvalidTerminalImageFetchPlan => ({
  _tag: "InvalidTerminalImageFetch",
  message
})

const invalidTerminalImagePath = (
  message: string
): InvalidTerminalImagePathNormalization => ({
  _tag: "InvalidTerminalImagePath",
  message
})

const validTerminalImagePath = (
  path: string
): TerminalImagePathNormalization => ({
  _tag: "ValidTerminalImagePath",
  path
})

const validTerminalImageContainerPath = (
  containerPath: string
): TerminalImageContainerPathResolution => ({
  _tag: "ValidTerminalImageContainerPath",
  containerPath
})

const lowercaseExtension = (path: string): string | null => {
  const lastDot = path.lastIndexOf(".")
  if (lastDot === -1 || lastDot === path.length - 1) {
    return null
  }
  return path.slice(lastDot + 1).toLowerCase()
}

const rawFileUrlPathname = (path: string): string => {
  const withoutScheme = path.slice("file://".length)
  const pathStart = withoutScheme.indexOf("/")
  if (pathStart === -1) {
    return ""
  }
  const pathAndSuffix = withoutScheme.slice(pathStart)
  const queryStart = pathAndSuffix.indexOf("?")
  const hashStart = pathAndSuffix.indexOf("#")
  if (queryStart === -1 && hashStart === -1) {
    return pathAndSuffix
  }
  if (queryStart === -1) {
    return pathAndSuffix.slice(0, hashStart)
  }
  if (hashStart === -1) {
    return pathAndSuffix.slice(0, queryStart)
  }
  return pathAndSuffix.slice(0, Math.min(queryStart, hashStart))
}

const normalizedFileUrlPathname = (pathname: string): string => pathname.replaceAll(encodedSpacePattern, " ")

const validateRawFileUrlPathname = (
  path: string,
  rawPathname: string
): InvalidTerminalImagePathNormalization | null => {
  if (invalidPercentEncodingPattern.test(rawPathname) || !URL.canParse(path)) {
    return invalidTerminalImagePath("Image file URL is invalid.")
  }
  if (fileUrlTraversalPattern.test(rawPathname)) {
    return invalidTerminalImagePath("Image path must not contain '.' or '..' segments.")
  }
  if (
    encodedPathSeparatorPattern.test(rawPathname) ||
    fileUrlBackslashPattern.test(rawPathname)
  ) {
    return invalidTerminalImagePath(
      "Image file URL must not contain encoded or backslash path separators."
    )
  }
  return null
}

const validateFileUrl = (
  url: URL
): InvalidTerminalImagePathNormalization | null => {
  if (
    url.protocol !== "file:" ||
    (url.hostname !== "" && url.hostname !== "localhost")
  ) {
    return invalidTerminalImagePath("Image file URL must point to a local path.")
  }
  if (url.search.length > 0 || url.hash.length > 0) {
    return invalidTerminalImagePath("Image file URL must not include query or fragment.")
  }
  return null
}

const normalizeTerminalImagePath = (
  path: string
): TerminalImagePathNormalization => {
  if (!urlSchemePattern.test(path)) {
    return validTerminalImagePath(path)
  }
  if (!fileUrlPattern.test(path)) {
    return invalidTerminalImagePath("Only file:// image URLs are supported.")
  }

  const rawPathname = rawFileUrlPathname(path)
  const rawPathnameValidation = validateRawFileUrlPathname(path, rawPathname)
  if (rawPathnameValidation !== null) {
    return rawPathnameValidation
  }

  const url = new URL(path)
  const urlValidation = validateFileUrl(url)
  if (urlValidation !== null) {
    return urlValidation
  }
  return validTerminalImagePath(normalizedFileUrlPathname(url.pathname))
}

export type TerminalImageFetchOptions = {
  readonly baseDir?: string
}

const isAbsolutePosixPath = (value: string): boolean => value.startsWith("/")

const trimRightSlashEnd = (value: string, end: number): number =>
  end > 0 && value[end - 1] === "/" ? trimRightSlashEnd(value, end - 1) : end

const trimRightSlash = (value: string): string => value.slice(0, trimRightSlashEnd(value, value.length))

const joinBaseDirAndRelativePath = (
  baseDir: string,
  relativePath: string
): string => {
  const trimmedBase = trimRightSlash(baseDir)
  return `${trimmedBase}/${relativePath}`
}

const isInvalidTerminalImagePathString = (value: string): boolean =>
  invalidCharacterPattern.test(value) || traversalPattern.test(value)

const resolveRelativeTerminalImagePath = (
  relativePath: string,
  options: TerminalImageFetchOptions
): TerminalImageContainerPathResolution => {
  const baseDir = options.baseDir
  if (baseDir === undefined || !isAbsolutePosixPath(baseDir)) {
    return invalidTerminalImageFetch("Image path must be absolute.")
  }
  if (isInvalidTerminalImagePathString(baseDir)) {
    return invalidTerminalImageFetch("Image base directory is invalid.")
  }
  return validTerminalImageContainerPath(joinBaseDirAndRelativePath(baseDir, relativePath))
}

const resolveTerminalImageContainerPath = (
  path: string,
  options: TerminalImageFetchOptions
): TerminalImageContainerPathResolution => {
  if (isAbsolutePosixPath(path)) {
    return validTerminalImageContainerPath(path)
  }
  return resolveRelativeTerminalImagePath(path, options)
}

const validateTerminalImageContainerPath = (
  containerPath: string
): InvalidTerminalImageFetchPlan | null => {
  if (invalidCharacterPattern.test(containerPath)) {
    return invalidTerminalImageFetch("Image path contains invalid characters.")
  }
  if (traversalPattern.test(containerPath)) {
    return invalidTerminalImageFetch("Image path must not contain '.' or '..' segments.")
  }
  return null
}

const terminalImageFetchPlanForPath = (
  containerPath: string
): TerminalImageFetchPlan => {
  const extension = lowercaseExtension(containerPath)
  if (extension === null) {
    return invalidTerminalImageFetch("Image path must include a file extension.")
  }
  const mediaType = supportedExtensionMediaTypes.get(extension)
  if (mediaType === undefined) {
    return invalidTerminalImageFetch(`Unsupported image extension: .${extension}`)
  }
  return { _tag: "ValidTerminalImageFetch", containerPath, mediaType }
}

/**
 * Builds a pure fetch plan for an image path inside the terminal container.
 *
 * @pure true
 * @param path - Absolute path, relative path with baseDir, or local file URL.
 * @param options - Optional base directory for relative image paths.
 * @returns A valid fetch plan with media type or typed validation failure.
 * @invariant valid.containerPath is absolute.
 * @invariant valid.containerPath contains no "." or ".." path segments.
 * @invariant valid.mediaType is determined only by the lowercase file extension.
 * @precondition relative paths require an absolute options.baseDir.
 * @postcondition no filesystem or network effects are performed.
 * @complexity O(n) where n = path.length + baseDir.length
 */
// CHANGE: plan terminal image fetches as pure validation data.
// WHY: runtime adapters should perform image IO only after path and media type validation.
// QUOTE(ТЗ): "терминал это наше отображение терминала из докера с общим шерингом"
// REF: issue-361-terminal-package
// SOURCE: n/a
// FORMAT THEOREM: valid(plan(path)) → absolute(containerPath) ∧ mediaType = ext(containerPath)
// PURITY: CORE
// INVARIANT: valid fetch plans never contain traversal segments.
// COMPLEXITY: O(n)/O(n)
export const planTerminalImageFetch = (
  path: string,
  options: TerminalImageFetchOptions = {}
): TerminalImageFetchPlan => {
  if (path.length === 0) {
    return invalidTerminalImageFetch("Image path is required.")
  }
  const normalized = normalizeTerminalImagePath(path)
  if (normalized._tag === "InvalidTerminalImagePath") {
    return invalidTerminalImageFetch(normalized.message)
  }
  const resolution = resolveTerminalImageContainerPath(normalized.path, options)
  if (resolution._tag === "InvalidTerminalImageFetch") {
    return resolution
  }
  const validation = validateTerminalImageContainerPath(resolution.containerPath)
  if (validation !== null) {
    return validation
  }
  return terminalImageFetchPlanForPath(resolution.containerPath)
}

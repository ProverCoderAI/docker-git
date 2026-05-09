import { fileURLToPath } from "node:url"

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
const invalidCharacterPattern = new RegExp(String.raw`[\s${controlCharRange}${deleteChar}]`, "u")
const traversalPattern = /(?:^|\/)(?:\.|\.\.)(?=\/|$)/u
const urlSchemePattern = /^[A-Za-z][A-Za-z0-9+.-]*:/u
const fileUrlPattern = /^file:\/\//iu
const encodedPathSeparatorPattern = /%(?:2f|5c)/iu
const fileUrlBackslashPattern = /\\/u
const fileUrlTraversalPattern = /(?:^|[\\/])(?:\.|%2e)(?:(?:\.|%2e))?(?=[\\/]|$)/iu

type TerminalImagePathNormalization =
  | {
    readonly _tag: "InvalidTerminalImagePath"
    readonly message: string
  }
  | {
    readonly _tag: "ValidTerminalImagePath"
    readonly path: string
  }

const lowercaseExtension = (path: string): string | null => {
  const lastDot = path.lastIndexOf(".")
  if (lastDot < 0 || lastDot === path.length - 1) {
    return null
  }
  return path.slice(lastDot + 1).toLowerCase()
}

const rawFileUrlPathname = (path: string): string => {
  const withoutScheme = path.slice("file://".length)
  const pathStart = withoutScheme.indexOf("/")
  if (pathStart < 0) {
    return ""
  }
  const pathAndSuffix = withoutScheme.slice(pathStart)
  const queryStart = pathAndSuffix.indexOf("?")
  const hashStart = pathAndSuffix.indexOf("#")
  if (queryStart < 0 && hashStart < 0) {
    return pathAndSuffix
  }
  if (queryStart < 0) {
    return pathAndSuffix.slice(0, hashStart)
  }
  if (hashStart < 0) {
    return pathAndSuffix.slice(0, queryStart)
  }
  return pathAndSuffix.slice(0, Math.min(queryStart, hashStart))
}

const normalizeTerminalImagePath = (path: string): TerminalImagePathNormalization => {
  if (!urlSchemePattern.test(path)) {
    return { _tag: "ValidTerminalImagePath", path }
  }
  if (!fileUrlPattern.test(path)) {
    return { _tag: "InvalidTerminalImagePath", message: "Only file:// image URLs are supported." }
  }

  const rawPathname = rawFileUrlPathname(path)
  if (fileUrlTraversalPattern.test(rawPathname)) {
    return { _tag: "InvalidTerminalImagePath", message: "Image path must not contain '.' or '..' segments." }
  }
  if (encodedPathSeparatorPattern.test(rawPathname) || fileUrlBackslashPattern.test(rawPathname)) {
    return {
      _tag: "InvalidTerminalImagePath",
      message: "Image file URL must not contain encoded or backslash path separators."
    }
  }

  try {
    const url = new URL(path)
    if (url.protocol !== "file:" || (url.hostname !== "" && url.hostname !== "localhost")) {
      return { _tag: "InvalidTerminalImagePath", message: "Image file URL must point to a local path." }
    }
    if (url.search.length > 0 || url.hash.length > 0) {
      return { _tag: "InvalidTerminalImagePath", message: "Image file URL must not include query or fragment." }
    }
    return { _tag: "ValidTerminalImagePath", path: fileURLToPath(url, { windows: false }) }
  } catch {
    return { _tag: "InvalidTerminalImagePath", message: "Image file URL is invalid." }
  }
}

export type TerminalImageFetchOptions = {
  readonly baseDir?: string
}

const isAbsolutePosixPath = (value: string): boolean => value.startsWith("/")

const joinBaseDirAndRelativePath = (baseDir: string, relativePath: string): string => {
  const trimmedBase = baseDir.replace(/\/+$/u, "")
  return `${trimmedBase}/${relativePath}`
}

export const planTerminalImageFetch = (
  path: string,
  options: TerminalImageFetchOptions = {}
): TerminalImageFetchPlan => {
  if (typeof path !== "string" || path.length === 0) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path is required." }
  }
  const normalized = normalizeTerminalImagePath(path)
  if (normalized._tag === "InvalidTerminalImagePath") {
    return { _tag: "InvalidTerminalImageFetch", message: normalized.message }
  }
  const normalizedPath = normalized.path
  let containerPath = normalizedPath
  if (!isAbsolutePosixPath(containerPath)) {
    const baseDir = options.baseDir
    if (baseDir === undefined || !isAbsolutePosixPath(baseDir)) {
      return { _tag: "InvalidTerminalImageFetch", message: "Image path must be absolute." }
    }
    if (invalidCharacterPattern.test(baseDir) || traversalPattern.test(baseDir)) {
      return { _tag: "InvalidTerminalImageFetch", message: "Image base directory is invalid." }
    }
    containerPath = joinBaseDirAndRelativePath(baseDir, containerPath)
  }
  if (invalidCharacterPattern.test(containerPath)) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path contains invalid characters." }
  }
  if (traversalPattern.test(containerPath)) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path must not contain '.' or '..' segments." }
  }
  const extension = lowercaseExtension(containerPath)
  if (extension === null) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path must include a file extension." }
  }
  const mediaType = supportedExtensionMediaTypes.get(extension)
  if (mediaType === undefined) {
    return { _tag: "InvalidTerminalImageFetch", message: `Unsupported image extension: .${extension}` }
  }
  return { _tag: "ValidTerminalImageFetch", containerPath, mediaType }
}

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

const lowercaseExtension = (path: string): string | null => {
  const lastDot = path.lastIndexOf(".")
  if (lastDot < 0 || lastDot === path.length - 1) {
    return null
  }
  return path.slice(lastDot + 1).toLowerCase()
}

export const planTerminalImageFetch = (path: string): TerminalImageFetchPlan => {
  if (typeof path !== "string" || path.length === 0) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path is required." }
  }
  if (!path.startsWith("/")) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path must be absolute." }
  }
  if (invalidCharacterPattern.test(path)) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path contains invalid characters." }
  }
  if (traversalPattern.test(path)) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path must not contain '.' or '..' segments." }
  }
  const extension = lowercaseExtension(path)
  if (extension === null) {
    return { _tag: "InvalidTerminalImageFetch", message: "Image path must include a file extension." }
  }
  const mediaType = supportedExtensionMediaTypes.get(extension)
  if (mediaType === undefined) {
    return { _tag: "InvalidTerminalImageFetch", message: `Unsupported image extension: .${extension}` }
  }
  return { _tag: "ValidTerminalImageFetch", containerPath: path, mediaType }
}

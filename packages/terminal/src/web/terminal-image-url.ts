import { resolveTerminalApiOriginUrl } from "./terminal.js"

const websocketSuffixPattern = /\/ws$/u

export const resolveTerminalImageBasePath = (websocketPath: string): string =>
  websocketPath.replace(websocketSuffixPattern, "/image")

export const resolveTerminalImageFetchUrl = (websocketPath: string, imagePath: string): string => {
  const apiUrl = resolveTerminalApiOriginUrl()
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/$/u, "")}${resolveTerminalImageBasePath(websocketPath)}`
  apiUrl.searchParams.set("path", imagePath)
  return apiUrl.href
}

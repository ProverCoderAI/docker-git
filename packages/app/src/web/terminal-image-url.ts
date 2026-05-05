import { resolveApiBaseUrl } from "./api-http.js"

const websocketSuffixPattern = /\/ws$/u

const resolveBackendOrigin = (): URL => {
  const configured = resolveApiBaseUrl()
  if (configured.startsWith("http://") || configured.startsWith("https://")) {
    return new URL(configured)
  }
  return new URL(configured, globalThis.location.origin)
}

export const resolveTerminalImageBasePath = (websocketPath: string): string =>
  websocketPath.replace(websocketSuffixPattern, "/image")

export const resolveTerminalImageFetchUrl = (websocketPath: string, imagePath: string): string => {
  const apiUrl = resolveBackendOrigin()
  apiUrl.pathname = `${apiUrl.pathname.replace(/\/$/u, "")}${resolveTerminalImageBasePath(websocketPath)}`
  apiUrl.searchParams.set("path", imagePath)
  return apiUrl.toString()
}

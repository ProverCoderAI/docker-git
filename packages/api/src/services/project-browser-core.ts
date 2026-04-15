import { projectShortKey } from "./project-port-proxy-core.js"

export const browserNoVncPort = 6080
export const browserCdpPort = 9223
export const browserVncPort = 5900

export type ProjectBrowserProxyPath =
  | {
    readonly _tag: "NoVnc"
    readonly projectKey: string
    readonly upstreamPath: string
  }
  | {
    readonly _tag: "Cdp"
    readonly projectKey: string
    readonly upstreamPath: string
  }

const browserPathPattern = /^\/(?:api\/)?b\/([a-f0-9]{12})(?:\/(.*))?$/u

export const renderProjectBrowserProxyPath = (projectId: string): string =>
  `/b/${projectShortKey(projectId)}/`

export const renderProjectBrowserNoVncPath = (projectId: string): string => {
  const projectKey = projectShortKey(projectId)
  const params = new URLSearchParams({
    autoconnect: "true",
    resize: "remote",
    path: `b/${projectKey}/websockify`
  })
  return `/b/${projectKey}/vnc.html?${params.toString()}`
}

export const renderProjectBrowserCdpPath = (projectId: string): string =>
  `/b/${projectShortKey(projectId)}/cdp/json/version`

export const parseProjectBrowserProxyPath = (pathname: string): ProjectBrowserProxyPath | null => {
  const match = browserPathPattern.exec(pathname)
  if (match === null) {
    return null
  }
  const projectKey = match[1]
  const rawPath = match[2] ?? ""
  if (projectKey === undefined) {
    return null
  }
  if (rawPath === "cdp" || rawPath.startsWith("cdp/")) {
    return {
      _tag: "Cdp",
      projectKey,
      upstreamPath: `/${rawPath.slice("cdp".length).replace(/^\/?/u, "")}`
    }
  }
  return {
    _tag: "NoVnc",
    projectKey,
    upstreamPath: `/${rawPath}`
  }
}

export const renderExternalUrl = (origin: string, path: string): string => {
  const trimmed = origin.endsWith("/") ? origin.slice(0, -1) : origin
  return `${trimmed}${path}`
}

export const rewriteCdpWebSocketUrl = (
  value: string,
  externalOrigin: string,
  projectId: string
): string => {
  const match = /^wss?:\/\/[^/]+\/(.+)$/u.exec(value)
  const upstreamPath = match?.[1]
  if (upstreamPath === undefined || upstreamPath.length === 0) {
    return value
  }
  const external = new URL(externalOrigin)
  external.protocol = external.protocol === "https:" ? "wss:" : "ws:"
  external.pathname = `/b/${projectShortKey(projectId)}/cdp/${upstreamPath}`
  external.search = ""
  external.hash = ""
  return external.toString()
}

export const rewriteCdpVersionPayload = (
  payload: string,
  externalOrigin: string,
  projectId: string
): string => {
  let decoded: unknown
  try {
    decoded = JSON.parse(payload)
  } catch {
    return payload
  }
  if (typeof decoded !== "object" || decoded === null || !("webSocketDebuggerUrl" in decoded)) {
    return payload
  }
  const current = decoded.webSocketDebuggerUrl
  if (typeof current !== "string") {
    return payload
  }
  return JSON.stringify({
    ...decoded,
    webSocketDebuggerUrl: rewriteCdpWebSocketUrl(current, externalOrigin, projectId)
  })
}

import { createHash } from "node:crypto"

export type ProjectPortProxyPath = {
  readonly _tag: "ProjectId"
  readonly projectId: string
  readonly targetPort: number
  readonly upstreamPath: string
} | {
  readonly _tag: "ProjectKey"
  readonly projectKey: string
  readonly targetPort: number
  readonly upstreamPath: string
}

const legacyProxyPathPattern = /^\/projects\/([^/]+)\/ports\/([1-9][0-9]*)\/proxy(?:\/(.*))?$/u
const shortProxyPathPattern = /^\/p\/([a-f0-9]{12})\/([1-9][0-9]*)(?:\/(.*))?$/u

const trimTrailingSlash = (value: string): string => {
  let next = value
  while (next.length > 1 && next.endsWith("/")) {
    next = next.slice(0, -1)
  }
  return next
}

export const projectShortKey = (projectId: string): string =>
  createHash("sha256").update(projectId).digest("hex").slice(0, 12)

export const renderForwardProxyPath = (projectId: string, targetPort: number): string =>
  `/p/${projectShortKey(projectId)}/${targetPort}/`

export const renderLegacyForwardProxyPath = (projectId: string, targetPort: number): string =>
  `/projects/${encodeURIComponent(projectId)}/ports/${targetPort}/proxy/`

export const parseProjectPortProxyPath = (pathname: string): ProjectPortProxyPath | null => {
  const shortMatch = shortProxyPathPattern.exec(pathname)
  if (shortMatch !== null) {
    const [, projectKey, rawPort, rawPath] = shortMatch
    if (projectKey === undefined || rawPort === undefined) {
      return null
    }
    const targetPort = Number.parseInt(rawPort, 10)
    if (!Number.isInteger(targetPort) || targetPort <= 0 || targetPort > 65_535) {
      return null
    }
    return {
      _tag: "ProjectKey",
      projectKey,
      targetPort,
      upstreamPath: `/${rawPath ?? ""}`
    }
  }

  const match = legacyProxyPathPattern.exec(pathname)
  if (match === null) {
    return null
  }

  const [, encodedProjectId, rawPort, rawPath] = match
  if (encodedProjectId === undefined || rawPort === undefined) {
    return null
  }
  const targetPort = Number.parseInt(rawPort, 10)
  if (!Number.isInteger(targetPort) || targetPort <= 0 || targetPort > 65_535) {
    return null
  }
  let projectId: string
  try {
    projectId = decodeURIComponent(encodedProjectId)
  } catch {
    return null
  }
  return {
    _tag: "ProjectId",
    projectId,
    targetPort,
    upstreamPath: `/${rawPath ?? ""}`
  }
}

export const parseLinuxDefaultGatewayIp = (routeTable: string): string | null => {
  const defaultRow = routeTable
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => {
      const columns = line.split(/\s+/u)
      return columns[1] === "00000000" && columns[2] !== undefined
    })

  const gatewayHex = defaultRow?.split(/\s+/u)[2]
  if (gatewayHex === undefined || !/^[0-9a-fA-F]{8}$/u.test(gatewayHex)) {
    return null
  }

  return [0, 2, 4, 6]
    .map((offset) => Number.parseInt(gatewayHex.slice(offset, offset + 2), 16))
    .reverse()
    .join(".")
}

export const normalizeForwardedPrefix = (value: string | undefined): string => {
  const first = value?.split(",")[0]?.trim()
  if (first === undefined || first.length === 0 || !first.startsWith("/")) {
    return ""
  }
  return trimTrailingSlash(first)
}

export const rewriteProxyLocation = (
  location: string,
  proxyPath: string,
  upstreamOrigin: string,
  externalPrefix = ""
): string => {
  const proxyBase = trimTrailingSlash(`${normalizeForwardedPrefix(externalPrefix)}${proxyPath}`)
  if (location.startsWith("/")) {
    return `${proxyBase}${location}`
  }

  try {
    const parsed = new URL(location)
    if (parsed.origin === upstreamOrigin) {
      return `${proxyBase}${parsed.pathname}${parsed.search}${parsed.hash}`
    }
  } catch {
    return location
  }

  return location
}

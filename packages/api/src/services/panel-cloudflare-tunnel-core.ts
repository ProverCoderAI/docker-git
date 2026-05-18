import { existsSync, readFileSync } from "node:fs"

import { parseLinuxDefaultGatewayIp } from "./project-port-proxy-core.js"

export type PanelTunnelTarget =
  | {
    readonly ok: true
    readonly panelUrl: string
    readonly targetUrl: string
  }
  | {
    readonly ok: false
    readonly message: string
  }

const tryCloudflareHostSuffix = ".trycloudflare.com"
const tryCloudflareUrlPattern = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/iu

const stripIpv6Brackets = (value: string): string =>
  value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value

export const isTryCloudflareHostname = (hostname: string): boolean =>
  hostname.toLowerCase().endsWith(tryCloudflareHostSuffix)

export const isLocalPanelHostname = (hostname: string): boolean => {
  const normalized = stripIpv6Brackets(hostname).toLowerCase()
  return normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "0.0.0.0" ||
    normalized === "::1"
}

export const parseTryCloudflareUrl = (output: string): string | null =>
  tryCloudflareUrlPattern.exec(output)?.[0] ?? null

const normalizePanelUrl = (value: string): PanelTunnelTarget => {
  const trimmed = value.trim()
  if (trimmed.length === 0) {
    return { ok: false, message: "panelUrl must be a non-empty URL." }
  }

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "panelUrl must use http or https." }
    }
    if (isTryCloudflareHostname(url.hostname)) {
      return { ok: false, message: "Open docker-git locally before starting a new Cloudflare tunnel." }
    }
    url.pathname = "/"
    url.search = ""
    url.hash = ""
    return {
      ok: true,
      panelUrl: url.toString(),
      targetUrl: url.toString()
    }
  } catch {
    return { ok: false, message: "panelUrl must be a valid URL." }
  }
}

export const resolvePanelTunnelTargetUrl = (
  panelUrl: string,
  localhostHost: string
): PanelTunnelTarget => {
  const normalized = normalizePanelUrl(panelUrl)
  if (!normalized.ok) {
    return normalized
  }

  const target = new URL(normalized.targetUrl)
  if (isLocalPanelHostname(target.hostname)) {
    target.hostname = localhostHost
  }

  return {
    ok: true,
    panelUrl: normalized.panelUrl,
    targetUrl: target.toString()
  }
}

const readDefaultGatewayIp = (): string | null => {
  try {
    return parseLinuxDefaultGatewayIp(readFileSync("/proc/net/route", "utf8"))
  } catch {
    return null
  }
}

export const defaultPanelTunnelLocalhostHost = (): string => {
  const configured = process.env["DOCKER_GIT_PANEL_TUNNEL_LOCALHOST_HOST"]?.trim()
  if (configured !== undefined && configured.length > 0) {
    return configured
  }
  return existsSync("/.dockerenv") ? readDefaultGatewayIp() ?? "172.17.0.1" : "127.0.0.1"
}

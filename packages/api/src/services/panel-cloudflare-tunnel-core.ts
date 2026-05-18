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
const explicitLocalHostnames: ReadonlySet<string> = new Set([
  "localhost",
  "host.docker.internal"
])

const stripIpv6Brackets = (value: string): string =>
  value.startsWith("[") && value.endsWith("]") ? value.slice(1, -1) : value

type Ipv4Octets = readonly [number, number, number, number]

const parseIpv4Octets = (hostname: string): Ipv4Octets | null => {
  const parts = hostname.split(".")
  if (parts.length !== 4) {
    return null
  }
  const octets = parts.map((part) => Number(part))
  return parts.every((part) => /^\d{1,3}$/u.test(part)) &&
    octets.every((part) => Number.isInteger(part) && part >= 0 && part <= 255)
    ? [octets[0] ?? 0, octets[1] ?? 0, octets[2] ?? 0, octets[3] ?? 0]
    : null
}

const isLoopbackIpv4Hostname = (hostname: string): boolean => parseIpv4Octets(hostname)?.[0] === 127

const isPrivateIpv4Hostname = (hostname: string): boolean => {
  const octets = parseIpv4Octets(hostname)
  if (octets === null) {
    return false
  }
  const [first, second] = octets
  return first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
}

const firstIpv6Hextet = (hostname: string): number | null => {
  const [first] = hostname.split(":")
  if (first === undefined || first.length === 0) {
    return null
  }
  const parsed = Number.parseInt(first, 16)
  return Number.isFinite(parsed) ? parsed : null
}

const isPrivateIpv6Hostname = (hostname: string): boolean => {
  if (!hostname.includes(":")) {
    return false
  }
  const hextet = firstIpv6Hextet(hostname)
  return hostname === "::1" ||
    (hextet !== null && (hextet & 0xfe00) === 0xfc00) ||
    (hextet !== null && (hextet & 0xffc0) === 0xfe80)
}

const isLoopbackPanelHostname = (hostname: string): boolean => {
  const normalized = stripIpv6Brackets(hostname).toLowerCase()
  return normalized === "localhost" ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    isLoopbackIpv4Hostname(normalized)
}

export const isTryCloudflareHostname = (hostname: string): boolean =>
  hostname.toLowerCase().endsWith(tryCloudflareHostSuffix)

export const isLocalPanelHostname = (hostname: string): boolean => {
  const normalized = stripIpv6Brackets(hostname).toLowerCase()
  return explicitLocalHostnames.has(normalized) ||
    isPrivateIpv4Hostname(normalized) ||
    isPrivateIpv6Hostname(normalized)
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
  if (!isLocalPanelHostname(target.hostname)) {
    return { ok: false, message: "panelUrl must point to localhost or a private LAN address." }
  }

  if (isLoopbackPanelHostname(target.hostname)) {
    target.hostname = localhostHost
  }

  return {
    ok: true,
    panelUrl: normalized.panelUrl,
    targetUrl: target.toString()
  }
}

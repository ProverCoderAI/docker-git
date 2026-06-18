export const firstHeader = (value) => Array.isArray(value) ? value[0] : value

const firstHeaderToken = (value) => {
  const header = firstHeader(value)
  const token = header?.split(",")[0]?.trim()
  return token === undefined || token.length === 0 ? undefined : token
}

const tryCloudflareHostSuffix = ".trycloudflare.com"

const isTryCloudflareHost = (host) => {
  const hostname = firstHeaderToken(host)?.split(":")[0]?.toLowerCase()
  return hostname !== undefined && hostname.endsWith(tryCloudflareHostSuffix)
}

const cfVisitorScheme = (value) => {
  const scheme = /"scheme"\s*:\s*"([^"]+)"/iu.exec(firstHeader(value) ?? "")?.[1]?.toLowerCase()
  return scheme === "http" || scheme === "https" ? scheme : undefined
}

export const resolveForwardedHost = (headers) =>
  firstHeaderToken(headers["x-forwarded-host"]) ?? firstHeaderToken(headers.host)

// CHANGE: Preserve HTTPS semantics for Cloudflare Quick Tunnel requests.
// WHY: Hosted Skiller Web receives a trycloudflare HTTPS backend URL and follow-up API calls must not be downgraded to http in docker-git.
// QUOTE(ТЗ): "Failed to fetch"
// REF: user-message-2026-06-18-skiller-vercel-failed-fetch
// SOURCE: n/a
// FORMAT THEOREM: host.endsWith(".trycloudflare.com") -> forwardedProto = https unless x-forwarded-proto explicitly says otherwise
// PURITY: CORE
// EFFECT: none
// INVARIANT: Explicit x-forwarded-proto has priority over Cloudflare-derived inference.
// COMPLEXITY: O(n) where n is header length.
export const resolveForwardedProto = (headers, forwardedHost = resolveForwardedHost(headers)) =>
  firstHeaderToken(headers["x-forwarded-proto"]) ??
  cfVisitorScheme(headers["cf-visitor"]) ??
  (isTryCloudflareHost(forwardedHost) ? "https" : "http")

export const defaultApiPort = "3334"
export const defaultApiHost = "127.0.0.1"

export type DockerNetworkIps = Readonly<Record<string, string>>

export type ApiBaseUrlCandidatesInput = {
  readonly explicitApiBaseUrl?: string | undefined
  readonly defaultLocalApiBaseUrl?: string | undefined
  readonly cachedApiBaseUrl?: string | undefined
  readonly defaultApiBaseUrl: string
  readonly currentContainerNetworks: DockerNetworkIps
  readonly controllerNetworks: DockerNetworkIps
  readonly port: string
}

export const trimTrailingSlashes = (value: string): string => {
  const parts = value.split("/")
  let end = parts.length

  while (end > 0 && parts[end - 1] === "") {
    end -= 1
  }

  return end === parts.length ? value : parts.slice(0, end).join("/")
}

const normalizePort = (value: string | undefined): string => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : defaultApiPort
}

const normalizeApiBaseUrl = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed !== undefined && trimmed.length > 0 ? trimTrailingSlashes(trimmed) : undefined
}

export const resolveApiPort = (): string => normalizePort(process.env["DOCKER_GIT_API_PORT"])

const defaultLocalHostnames = new Set(["127.0.0.1", "localhost", "[::1]"])

const isRootApiUrlPath = (url: URL): boolean => url.pathname === "/" && url.search.length === 0 && url.hash.length === 0

const isDefaultLocalApiUrlObject = (url: URL, port: string): boolean =>
  url.protocol === "http:" &&
  defaultLocalHostnames.has(url.hostname) &&
  url.port === port &&
  isRootApiUrlPath(url)

// CHANGE: classify default localhost API URLs as non-strict bootstrap hints.
// WHY: Windows shells can persist DOCKER_GIT_API_URL=http://127.0.0.1:3334, which should not block local controller startup.
// QUOTE(ТЗ): "сделать из коробки что бы всё само работало"
// REF: user-request-2026-05-29-default-local-api-url-bootstrap
// SOURCE: n/a
// FORMAT THEOREM: local_http(url, port) and empty(path, query, hash) -> default_local(url)
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: only localhost loopback HTTP URLs on the configured API port are default-local.
// COMPLEXITY: O(n) where n = |value|.
export const isDefaultLocalApiBaseUrl = (value: string, port = resolveApiPort()): boolean => {
  const normalized = normalizeApiBaseUrl(value)
  if (normalized === undefined || !URL.canParse(normalized)) {
    return false
  }
  return isDefaultLocalApiUrlObject(new URL(normalized), port)
}

// CHANGE: preserve default-local DOCKER_GIT_API_URL as an endpoint candidate instead of a strict override.
// WHY: a stale default localhost env var should still allow compose bootstrap when nothing is listening yet.
// QUOTE(ТЗ): "fallback только для дефолтного localhost URL"
// REF: user-request-2026-05-29-default-local-api-url-bootstrap
// SOURCE: n/a
// FORMAT THEOREM: default_local(env) -> env; otherwise -> undefined
// PURITY: SHELL
// EFFECT: reads process.env
// INVARIANT: custom DOCKER_GIT_API_URL values are never returned here.
// COMPLEXITY: O(n) where n = |DOCKER_GIT_API_URL|.
export const resolveDefaultLocalApiBaseUrl = (): string | undefined => {
  const explicit = normalizeApiBaseUrl(process.env["DOCKER_GIT_API_URL"])
  return explicit !== undefined && isDefaultLocalApiBaseUrl(explicit) ? explicit : undefined
}

// CHANGE: treat only custom DOCKER_GIT_API_URL values as strict explicit controller endpoints.
// WHY: custom remote backends should fail loudly when unreachable, while default localhost should bootstrap locally.
// QUOTE(ТЗ): "кастомные URL остаются строгими"
// REF: user-request-2026-05-29-default-local-api-url-bootstrap
// SOURCE: n/a
// FORMAT THEOREM: nonempty(env) and not default_local(env) -> env; otherwise -> undefined
// PURITY: SHELL
// EFFECT: reads process.env
// INVARIANT: default-local URLs do not block local bootstrap.
// COMPLEXITY: O(n) where n = |DOCKER_GIT_API_URL|.
export const resolveExplicitApiBaseUrl = (): string | undefined => {
  const explicit = normalizeApiBaseUrl(process.env["DOCKER_GIT_API_URL"])
  return explicit !== undefined && !isDefaultLocalApiBaseUrl(explicit) ? explicit : undefined
}

export const resolveConfiguredApiBaseUrl = (): string => {
  const host = process.env["DOCKER_GIT_API_BIND_HOST"]?.trim() || defaultApiHost
  return `http://${host}:${resolveApiPort()}`
}

export const resolveControllerDnsApiBaseUrl = (): string => {
  const host = process.env["DOCKER_GIT_API_CONTAINER_NAME"]?.trim() || "docker-git-api"
  return `http://${host}:${resolveApiPort()}`
}

export const uniqueStrings = (values: ReadonlyArray<string>): ReadonlyArray<string> => {
  const seen = new Set<string>()
  const result: Array<string> = []

  for (const value of values) {
    if (seen.has(value)) {
      continue
    }
    seen.add(value)
    result.push(value)
  }

  return result
}

const parseNetworkEntry = (line: string): readonly [string, string] | null => {
  const trimmed = line.trim()
  if (trimmed.length === 0) {
    return null
  }

  const separatorIndex = trimmed.indexOf("=")
  if (separatorIndex <= 0) {
    return null
  }

  const name = trimmed.slice(0, separatorIndex).trim()
  const ip = trimmed.slice(separatorIndex + 1).trim()
  if (name.length === 0 || ip.length === 0) {
    return null
  }

  return [name, ip]
}

export const parseDockerNetworkIps = (output: string): DockerNetworkIps =>
  Object.fromEntries(
    output
      .split(/\r?\n/u)
      .flatMap((line) => {
        const entry = parseNetworkEntry(line)
        return entry === null ? [] : [entry]
      })
  )

export const formatNetworkIps = (networks: DockerNetworkIps): string => {
  const entries = Object.entries(networks)
  return entries.length === 0
    ? "unavailable"
    : entries.map(([name, ip]) => `${name}=${ip}`).join(", ")
}

export const isRemoteDockerHost = (dockerHost = process.env["DOCKER_HOST"]): boolean => {
  const trimmed = dockerHost?.trim() ?? ""
  return trimmed.startsWith("tcp://") || trimmed.startsWith("ssh://")
}

// CHANGE: allow remote Docker bootstrap when the current runtime is inspectable on that daemon
// WHY: containerized hosts often reach Docker through tcp://host.docker.internal while sharing daemon networks
// QUOTE(ТЗ): "Надо проверить запускается ли сервер теперь"
// REF: user-request-2026-05-27-pr-351-browser-e2e
// SOURCE: n/a
// FORMAT THEOREM: remote(dockerHost) ∧ noExplicitApi ∧ empty(networks) -> require_explicit_api
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: remote Docker is allowed only when network-derived controller candidates can be constructed
// COMPLEXITY: O(k) where k = |currentContainerNetworks|
export const shouldRequireExplicitApiUrlForRemoteDocker = (
  dockerHost: string | undefined,
  explicitApiBaseUrl: string | undefined,
  currentContainerNetworks: DockerNetworkIps
): boolean =>
  isRemoteDockerHost(dockerHost) &&
  explicitApiBaseUrl === undefined &&
  Object.keys(currentContainerNetworks).length === 0

export const buildApiBaseUrlCandidates = ({
  cachedApiBaseUrl,
  controllerNetworks,
  currentContainerNetworks,
  defaultApiBaseUrl,
  defaultLocalApiBaseUrl,
  explicitApiBaseUrl,
  port
}: ApiBaseUrlCandidatesInput): ReadonlyArray<string> => {
  if (explicitApiBaseUrl !== undefined) {
    return [trimTrailingSlashes(explicitApiBaseUrl)]
  }

  const sharedNetworkUrls = Object.keys(currentContainerNetworks).flatMap((networkName) => {
    if (networkName === "bridge") {
      return []
    }

    const ip = controllerNetworks[networkName]?.trim() ?? ""
    return ip.length === 0 ? [] : [`http://${ip}:${port}`]
  })

  const bridgeIp = controllerNetworks["bridge"]?.trim() ?? ""
  const bridgeUrl = bridgeIp.length === 0 ? [] : [`http://${bridgeIp}:${port}`]
  const hostDockerInternalUrl = Object.keys(currentContainerNetworks).length > 0
    ? [`http://host.docker.internal:${port}`]
    : []

  return uniqueStrings(
    [
      defaultLocalApiBaseUrl ?? "",
      cachedApiBaseUrl ?? "",
      defaultApiBaseUrl,
      resolveControllerDnsApiBaseUrl(),
      ...hostDockerInternalUrl,
      ...sharedNetworkUrls,
      ...bridgeUrl
    ]
      .map((value) => trimTrailingSlashes(value.trim()))
      .filter((value) => value.length > 0)
  )
}

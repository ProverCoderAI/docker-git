export const defaultApiPort = "3334"
export const defaultApiHost = "127.0.0.1"

export type DockerNetworkIps = Readonly<Record<string, string>>

export type ApiBaseUrlCandidatesInput = {
  readonly explicitApiBaseUrl?: string | undefined
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

export const resolveApiPort = (): string => normalizePort(process.env["DOCKER_GIT_API_PORT"])

export const resolveExplicitApiBaseUrl = (): string | undefined => {
  const explicit = process.env["DOCKER_GIT_API_URL"]?.trim()
  return explicit !== undefined && explicit.length > 0 ? trimTrailingSlashes(explicit) : undefined
}

export const resolveConfiguredApiBaseUrl = (): string => {
  const host = process.env["DOCKER_GIT_API_BIND_HOST"]?.trim() || defaultApiHost
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

  return [name, ip] as const
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

export const buildApiBaseUrlCandidates = ({
  cachedApiBaseUrl,
  controllerNetworks,
  currentContainerNetworks,
  defaultApiBaseUrl,
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
      cachedApiBaseUrl ?? "",
      defaultApiBaseUrl,
      ...hostDockerInternalUrl,
      ...sharedNetworkUrls,
      ...bridgeUrl
    ]
      .map((value) => trimTrailingSlashes(value.trim()))
      .filter((value) => value.length > 0)
  )
}

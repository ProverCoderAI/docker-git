import { join, posix } from "node:path"

export type DockerContainerMount = {
  readonly destination: string
  readonly rw: boolean
  readonly source: string
}

export type SkillerContainerScope = {
  readonly containerCodexSkillsPath: string
  readonly containerHomePath: string
  readonly containerName: string
  readonly containerProjectPath: string
  readonly hostCodexSkillsPath: string
  readonly hostEnvGlobalPath: string
  readonly hostHomePath: string
  readonly hostProjectPath: string
  readonly projectId: string
  readonly projectKey: string
  readonly sshUser: string
}

export type SkillerBrowserPathRoot = {
  readonly containerPath: string
  readonly hostPath: string
  readonly id: "project" | "home" | "codexSkills"
  readonly label: string
}

export type SkillerBrowserScope = {
  readonly containerName: string
  readonly currentProject: SkillerBrowserPathRoot
  readonly projectKey: string
  readonly roots: ReadonlyArray<SkillerBrowserPathRoot>
  readonly sessionId: string | null
}

export type ConfiguredSkillerWebUrl =
  | { readonly _tag: "Disabled" }
  | { readonly _tag: "Enabled"; readonly baseUrl: string }
  | { readonly _tag: "Invalid"; readonly message: string }

export type ExternalSkillerLaunchUrlInput = {
  readonly backendUrl: string
  readonly projectKey: string | undefined
  readonly sessionId: string | undefined
  readonly skillerWebUrl: string
}

export type ExternalSkillerLaunchWrapperInput = {
  readonly targetUrl: string
}

export type DockerGitSkillerBackendUrlDecision =
  | { readonly _tag: "Configured"; readonly backendUrl: string }
  | { readonly _tag: "Request"; readonly backendUrl: string }
  | { readonly _tag: "Tunnel"; readonly forwardedPrefix: string; readonly panelUrl: string }

export type SkillerConnectProject = {
  readonly status: "running" | "stopped" | "unknown"
}

const trimTrailingSlashes = (value: string): string =>
  value.replace(/\/+$/u, "")

const firstNonEmptySkillerBackendUrl = (
  env: Record<string, string | undefined>
): string | undefined =>
  [
    env["DOCKER_GIT_SKILLER_BACKEND_URL"],
    env["DOCKER_GIT_API_PUBLIC_URL"]
  ]
    .map((value) => value?.trim())
    .find((value) => value !== undefined && value.length > 0)

const isHttpsUrl = (value: string): boolean =>
  URL.canParse(value) && new URL(value).protocol === "https:"

export const joinSkillerBackendUrl = (
  baseUrl: string,
  forwardedPrefix: string
): string =>
  `${trimTrailingSlashes(baseUrl)}${forwardedPrefix}`

const configuredOrigin = (raw: string): string | null => {
  const value = raw.trim()
  if (!URL.canParse(value)) {
    return null
  }
  const parsed = new URL(value)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null
  }
  return parsed.origin
}

const uniqueOrigins = (origins: ReadonlyArray<string>): ReadonlyArray<string> =>
  [...new Set(origins)]

const defaultSkillerWebCorsOrigins = [
  "https://skiller-web-henna.vercel.app",
  "http://localhost:5180",
  "http://127.0.0.1:5180"
] as const

export const resolveConfiguredSkillerWebUrl = (
  env: Record<string, string | undefined>
): ConfiguredSkillerWebUrl => {
  const raw = env["DOCKER_GIT_SKILLER_WEB_URL"]?.trim()
  if (raw === undefined || raw.length === 0) {
    return { _tag: "Disabled" }
  }
  if (!URL.canParse(raw)) {
    return { _tag: "Invalid", message: `Invalid DOCKER_GIT_SKILLER_WEB_URL: ${raw}` }
  }
  const parsed = new URL(raw)
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { _tag: "Invalid", message: "DOCKER_GIT_SKILLER_WEB_URL must use http or https." }
  }
  parsed.hash = ""
  parsed.search = ""
  return { _tag: "Enabled", baseUrl: trimTrailingSlashes(parsed.toString()) }
}

export const resolveDockerGitSkillerBackendUrl = (
  env: Record<string, string | undefined>,
  requestOrigin: string
): string => {
  const configured = firstNonEmptySkillerBackendUrl(env)
  return configured ?? requestOrigin
}

/**
 * Resolves how the docker-git API URL should be exposed to external Skiller Web.
 *
 * @param env - Environment map containing optional Skiller web/backend overrides.
 * @param requestOrigin - Browser-visible request origin from trusted forwarding headers.
 * @param forwardedPrefix - Normalized API proxy prefix, such as `/api` or an empty string.
 * @returns A pure strategy: use configured URL, use HTTPS request URL, or start a panel tunnel.
 *
 * @pure true
 * @effect none
 * @invariant If an explicit backend URL exists, it is returned before derived URLs.
 * @precondition forwardedPrefix is empty or starts with `/` and has no trailing slash.
 * @postcondition Tunnel is selected only for enabled external Skiller Web over non-HTTPS request URLs.
 * @complexity O(n) where n is the total configured URL length.
 * @throws Never
 */
export const resolveDockerGitSkillerBackendUrlDecision = (
  env: Record<string, string | undefined>,
  requestOrigin: string,
  forwardedPrefix: string
): DockerGitSkillerBackendUrlDecision => {
  const configured = firstNonEmptySkillerBackendUrl(env)
  if (configured !== undefined) {
    return { _tag: "Configured", backendUrl: configured }
  }

  const requestBackendUrl = joinSkillerBackendUrl(requestOrigin, forwardedPrefix)
  if (isHttpsUrl(requestBackendUrl)) {
    return { _tag: "Request", backendUrl: requestBackendUrl }
  }

  return resolveConfiguredSkillerWebUrl(env)._tag === "Enabled"
    ? { _tag: "Tunnel", forwardedPrefix, panelUrl: requestOrigin }
    : { _tag: "Request", backendUrl: requestBackendUrl }
}

export const configuredSkillerWebCorsOrigins = (
  env: Record<string, string | undefined>
): ReadonlyArray<string> => {
  const configuredWeb = resolveConfiguredSkillerWebUrl(env)
  const fromWeb = configuredWeb._tag === "Enabled"
    ? [configuredOrigin(configuredWeb.baseUrl)].filter((origin): origin is string => origin !== null)
    : []
  const fromAllowed = (env["DOCKER_GIT_SKILLER_ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map(configuredOrigin)
    .filter((origin): origin is string => origin !== null)
  return uniqueOrigins([
    ...fromWeb,
    ...fromAllowed,
    ...defaultSkillerWebCorsOrigins
  ])
}

export const isSkillerWebCorsOriginAllowed = (
  origin: string | undefined,
  env: Record<string, string | undefined>
): boolean =>
  origin !== undefined && configuredSkillerWebCorsOrigins(env).includes(origin)

/**
 * Keeps the Skiller external project picker scoped to currently usable projects.
 *
 * @param projects - Docker-git project summaries with conservative runtime status.
 * @returns Projects whose known status is `running`.
 *
 * @pure true
 * @effect none
 * @invariant every returned project has status = running.
 * @precondition status belongs to the ProjectStatus finite domain.
 * @postcondition stopped and unknown projects are not visible in Skiller connect.
 * @complexity O(n) time where n is project count; O(n) space for the filtered result.
 * @throws Never
 */
export const activeSkillerConnectProjects = <Project extends SkillerConnectProject>(
  projects: ReadonlyArray<Project>
): ReadonlyArray<Project> =>
  projects.filter((project) => project.status === "running")

export const externalSkillerLaunchUrl = (input: ExternalSkillerLaunchUrlInput): string => {
  const url = new URL(`${trimTrailingSlashes(input.skillerWebUrl)}/launch`)
  url.searchParams.set("backendUrl", input.backendUrl)
  if (input.projectKey !== undefined) {
    url.searchParams.set("projectKey", input.projectKey)
  }
  if (input.sessionId !== undefined) {
    url.searchParams.set("sessionId", input.sessionId)
  }
  return url.toString()
}

export const externalSkillerLaunchWrapperPath = (launchId: string): string =>
  `/api/skiller/external-launch/${encodeURIComponent(launchId)}`

const htmlAttributeReplacements: Readonly<Record<string, string>> = {
  "\"": "&quot;",
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;"
}

export const escapeHtmlAttribute = (value: string): string =>
  value.replace(/[&"<>]/gu, (character) => htmlAttributeReplacements[character] ?? character)

export const externalSkillerLaunchWrapperHtml = (input: ExternalSkillerLaunchWrapperInput): string => {
  const targetUrl = escapeHtmlAttribute(input.targetUrl)
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Skiller Web</title>
  <style>
    html,
    body {
      width: 100%;
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #fff;
    }
    iframe {
      position: fixed;
      inset: 0;
      display: block;
      width: 100vw;
      height: 100vh;
      border: 0;
      background: #fff;
    }
  </style>
</head>
<body>
  <iframe title="Skiller Web" src="${targetUrl}" allow="clipboard-read; clipboard-write; fullscreen" referrerpolicy="no-referrer" credentialless></iframe>
  <noscript><a href="${targetUrl}">Open Skiller Web</a></noscript>
</body>
</html>`
}

export const parseDockerMountLines = (output: string): ReadonlyArray<DockerContainerMount> =>
  output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const [source = "", destination = "", rawRw = ""] = line.split("\t")
      const normalizedSource = source.trim()
      const normalizedDestination = destination.trim()
      return normalizedSource.length === 0 || normalizedDestination.length === 0
        ? []
        : [{
          destination: normalizeContainerPath(normalizedDestination),
          rw: rawRw.trim().toLowerCase() === "true",
          source: normalizedSource
        }]
    })

export const normalizeContainerPath = (path: string): string => {
  const trimmed = path.trim()
  const absolute = trimmed.startsWith("/") ? trimmed : `/${trimmed}`
  return posix.normalize(absolute)
}

export const containerCodexSkillsPath = (containerHomePath: string): string =>
  posix.join(normalizeContainerPath(containerHomePath), ".codex", "skills")

const isPathInside = (basePath: string, targetPath: string): boolean =>
  targetPath === basePath || targetPath.startsWith(`${basePath}/`)

const normalizeHostPath = (path: string): string =>
  join(path, ".")

const isHostPathInside = (basePath: string, targetPath: string): boolean => {
  const base = normalizeHostPath(basePath)
  const target = normalizeHostPath(targetPath)
  return target === base || target.startsWith(`${base}/`)
}

const mountedPathDepth = (mount: DockerContainerMount): number =>
  mount.destination.split("/").filter((part) => part.length > 0).length

const selectWritableMount = (
  mounts: ReadonlyArray<DockerContainerMount>,
  containerPath: string
): DockerContainerMount | null => {
  const normalizedPath = normalizeContainerPath(containerPath)
  const matches = mounts
    .filter((mount) => mount.rw && isPathInside(mount.destination, normalizedPath))
    .sort((left, right) => mountedPathDepth(right) - mountedPathDepth(left))
  return matches[0] ?? null
}

export const remapContainerPathToMountedHost = (
  mounts: ReadonlyArray<DockerContainerMount>,
  containerPath: string
): string | null => {
  const normalizedPath = normalizeContainerPath(containerPath)
  const mount = selectWritableMount(mounts, normalizedPath)
  if (mount === null) {
    return null
  }
  const relativePath = posix.relative(mount.destination, normalizedPath)
  return relativePath.length === 0
    ? mount.source
    : join(mount.source, ...relativePath.split(posix.sep))
}

export const sameSkillerScope = (
  left: SkillerContainerScope | null,
  right: SkillerContainerScope | null
): boolean => {
  if (left === null || right === null) {
    return left === right
  }
  return left.projectKey === right.projectKey &&
    left.containerName === right.containerName &&
    left.hostCodexSkillsPath === right.hostCodexSkillsPath &&
    left.hostEnvGlobalPath === right.hostEnvGlobalPath &&
    left.hostHomePath === right.hostHomePath &&
    left.hostProjectPath === right.hostProjectPath
}

const skillerBrowserRoots = (scope: SkillerContainerScope): ReadonlyArray<SkillerBrowserPathRoot> => [
  {
    containerPath: normalizeContainerPath(scope.containerProjectPath),
    hostPath: scope.hostProjectPath,
    id: "project",
    label: "Current project"
  },
  {
    containerPath: normalizeContainerPath(scope.containerHomePath),
    hostPath: scope.hostHomePath,
    id: "home",
    label: "Home"
  },
  {
    containerPath: normalizeContainerPath(scope.containerCodexSkillsPath),
    hostPath: scope.hostCodexSkillsPath,
    id: "codexSkills",
    label: "Codex skills"
  }
]

const rootDepth = (root: Pick<SkillerBrowserPathRoot, "containerPath" | "hostPath">, key: "containerPath" | "hostPath"): number =>
  root[key].split("/").filter((part) => part.length > 0).length

export const skillerBrowserScopeForContainer = (
  scope: SkillerContainerScope,
  sessionId: string | null
): SkillerBrowserScope => {
  const roots = skillerBrowserRoots(scope)
  return {
    containerName: scope.containerName,
    currentProject: roots[0] ?? {
      containerPath: normalizeContainerPath(scope.containerProjectPath),
      hostPath: scope.hostProjectPath,
      id: "project",
      label: "Current project"
    },
    projectKey: scope.projectKey,
    roots,
    sessionId
  }
}

export const remapSkillerBrowserContainerPath = (
  browserScope: SkillerBrowserScope,
  containerPath: string
): string | null => {
  const normalizedPath = normalizeContainerPath(containerPath)
  const root = [...browserScope.roots]
    .filter((candidate) => isPathInside(normalizeContainerPath(candidate.containerPath), normalizedPath))
    .sort((left, right) => rootDepth(right, "containerPath") - rootDepth(left, "containerPath"))[0]
  if (root === undefined) {
    return null
  }
  const relativePath = posix.relative(normalizeContainerPath(root.containerPath), normalizedPath)
  return relativePath.length === 0
    ? root.hostPath
    : join(root.hostPath, ...relativePath.split(posix.sep))
}

export const remapSkillerBrowserHostPath = (
  browserScope: SkillerBrowserScope,
  hostPath: string
): string => {
  const normalizedHostPath = normalizeHostPath(hostPath)
  const root = [...browserScope.roots]
    .filter((candidate) => isHostPathInside(candidate.hostPath, normalizedHostPath))
    .sort((left, right) => rootDepth(right, "hostPath") - rootDepth(left, "hostPath"))[0]
  if (root === undefined) {
    return hostPath
  }
  const relativePath = normalizedHostPath.slice(normalizeHostPath(root.hostPath).length).replace(/^\/+/u, "")
  return relativePath.length === 0
    ? normalizeContainerPath(root.containerPath)
    : posix.join(normalizeContainerPath(root.containerPath), ...relativePath.split("/"))
}

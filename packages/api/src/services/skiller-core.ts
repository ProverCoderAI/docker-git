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

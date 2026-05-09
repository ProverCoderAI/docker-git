import { join, posix } from "node:path"

export type DockerContainerMount = {
  readonly destination: string
  readonly rw: boolean
  readonly source: string
}

export type SkillerContainerScope = {
  readonly containerHomePath: string
  readonly containerName: string
  readonly containerProjectPath: string
  readonly hostHomePath: string
  readonly hostProjectPath: string
  readonly projectId: string
  readonly projectKey: string
  readonly sshUser: string
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

const isPathInside = (basePath: string, targetPath: string): boolean =>
  targetPath === basePath || targetPath.startsWith(`${basePath}/`)

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
    left.hostHomePath === right.hostHomePath &&
    left.hostProjectPath === right.hostProjectPath
}

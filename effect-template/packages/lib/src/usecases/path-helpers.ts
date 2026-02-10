import type { PlatformError } from "@effect/platform/Error"
import type * as FileSystem from "@effect/platform/FileSystem"
import type * as Path from "@effect/platform/Path"
import { Effect } from "effect"

export const resolveAuthorizedKeysPath = (
  path: Path.Path,
  baseDir: string,
  authorizedKeysPath: string
): string =>
  path.isAbsolute(authorizedKeysPath)
    ? authorizedKeysPath
    : path.resolve(baseDir, authorizedKeysPath)

export const resolvePathFromCwd = (
  path: Path.Path,
  cwd: string,
  targetPath: string
): string =>
  path.isAbsolute(targetPath)
    ? targetPath
    : (() => {
      const expandHome = (value: string): string => {
        const home = process.env["HOME"] ?? process.env["USERPROFILE"]
        if (!home || home.length === 0) {
          return value
        }
        if (value === "~") {
          return home
        }
        if (value.startsWith("~/") || value.startsWith("~\\")) {
          return `${home}${value.slice(1)}`
        }
        return value
      }

      const trimTrailingSlash = (value: string): string => value.replace(/[\\/]+$/, "")

      const defaultProjectsRoot = (): string => {
        const explicit = process.env["DOCKER_GIT_PROJECTS_ROOT"]?.trim()
        if (explicit && explicit.length > 0) {
          return expandHome(explicit)
        }
        const home = process.env["HOME"] ?? process.env["USERPROFILE"]
        if (home && home.trim().length > 0) {
          return `${trimTrailingSlash(home.trim())}/.docker-git`
        }
        return `${cwd}/.docker-git`
      }

      const projectsRoot = path.resolve(defaultProjectsRoot())
      const normalized = targetPath
        .replaceAll("\\", "/")
        .replace(/^\.\//, "")
        .trim()

      if (normalized === ".docker-git") {
        return projectsRoot
      }
      const prefix = ".docker-git/"
      if (normalized.startsWith(prefix)) {
        return path.join(projectsRoot, normalized.slice(prefix.length))
      }

      return path.resolve(cwd, targetPath)
    })()

export const findExistingUpwards = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  startDir: string,
  fileName: string,
  maxDepth: number
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    let current = startDir

    for (let depth = 0; depth <= maxDepth; depth += 1) {
      const candidate = path.join(current, fileName)
      const exists = yield* _(fs.exists(candidate))
      if (exists) {
        return candidate
      }

      const parent = path.dirname(current)
      if (parent === current) {
        return null
      }

      current = parent
    }

    return null
  })

export const resolveEnvPath = (key: string): string | null => {
  const value = process.env[key]?.trim()
  return value && value.length > 0 ? value : null
}

export const findExistingPath = (
  fs: FileSystem.FileSystem,
  candidate: string | null
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  candidate === null
    ? Effect.succeed(null)
    : Effect.flatMap(fs.exists(candidate), (exists) => (exists ? Effect.succeed(candidate) : Effect.succeed(null)))

export const findFirstExisting = (
  fs: FileSystem.FileSystem,
  candidates: ReadonlyArray<string>
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    for (const candidate of candidates) {
      const existing = yield* _(findExistingPath(fs, candidate))
      if (existing !== null) {
        return existing
      }
    }

    return null
  })

export type KeyLookupSpec = {
  readonly envVar: string
  readonly devKeyName: string
  readonly fallbackName?: string
  readonly homeCandidates: ReadonlyArray<string>
}

export const findKeyByPriority = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string,
  spec: KeyLookupSpec
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const envPath = resolveEnvPath(spec.envVar)
    const envExisting = yield* _(findExistingPath(fs, envPath))
    if (envExisting !== null) {
      return envExisting
    }

    const devKey = yield* _(findExistingUpwards(fs, path, cwd, spec.devKeyName, 6))
    if (devKey !== null) {
      return devKey
    }

    if (spec.fallbackName !== undefined) {
      const fallback = yield* _(findExistingUpwards(fs, path, cwd, spec.fallbackName, 6))
      if (fallback !== null) {
        return fallback
      }
    }

    const home = resolveEnvPath("HOME")
    if (home === null) {
      return null
    }

    return yield* _(
      findFirstExisting(
        fs,
        spec.homeCandidates.map((candidate) => path.join(home, ".ssh", candidate))
      )
    )
  })

const authorizedKeysSpec: KeyLookupSpec = {
  envVar: "DOCKER_GIT_AUTHORIZED_KEYS",
  devKeyName: "dev_ssh_key.pub",
  fallbackName: "authorized_keys",
  homeCandidates: ["id_ed25519.pub", "id_rsa.pub"]
}

const sshPrivateKeySpec: KeyLookupSpec = {
  envVar: "DOCKER_GIT_SSH_KEY",
  devKeyName: "dev_ssh_key",
  homeCandidates: ["id_ed25519", "id_rsa"]
}

const makeKeyFinder = (spec: KeyLookupSpec) =>
(
  fs: FileSystem.FileSystem,
  path: Path.Path,
  cwd: string
): Effect.Effect<string | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  findKeyByPriority(fs, path, cwd, spec)

export const findAuthorizedKeysSource = makeKeyFinder(authorizedKeysSpec)

export const findSshPrivateKey = makeKeyFinder(sshPrivateKeySpec)

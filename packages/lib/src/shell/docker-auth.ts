import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { Effect } from "effect"

import { runCommandCapture, runCommandExitCode, runCommandWithExitCodes } from "./command-runner.js"

export type DockerVolume = {
  readonly hostPath: string
  readonly containerPath: string
}

export type DockerAuthSpec = {
  readonly cwd: string
  readonly image: string
  readonly volume: DockerVolume
  readonly network?: string
  readonly entrypoint?: string
  readonly user?: string
  readonly tmpfs?: string | ReadonlyArray<string>
  readonly envFile?: string | ReadonlyArray<string>
  readonly env?: string | ReadonlyArray<string>
  readonly args: ReadonlyArray<string>
  readonly interactive: boolean
}

type DockerMountBinding = {
  readonly source: string
  readonly destination: string
}

export const resolveDockerEnvValue = (key: string): string | null => {
  const value = process.env[key]?.trim()
  return value && value.length > 0 ? value : null
}

export const trimDockerPathTrailingSlash = (value: string): string => {
  let end = value.length
  while (end > 0) {
    const char = value[end - 1]
    if (char !== "/" && char !== "\\") {
      break
    }
    end -= 1
  }
  return value.slice(0, end)
}

const windowsDrivePathPattern = /^[a-z]:(?:\/|\\|$)/iu

const normalizeDockerPathForCompare = (value: string): string => {
  const withoutTrailingSlash = trimDockerPathTrailingSlash(value.trim())
  const normalized = withoutTrailingSlash.replaceAll("\\", "/")
  return windowsDrivePathPattern.test(normalized)
    ? normalized.toLowerCase()
    : normalized
}

const originalPrefixLength = (prefix: string): number => trimDockerPathTrailingSlash(prefix.trim()).length

const isPathUnderPrefix = (candidate: string, prefix: string): boolean => {
  const normalizedCandidate = normalizeDockerPathForCompare(candidate)
  const normalizedPrefix = normalizeDockerPathForCompare(prefix)
  return normalizedCandidate === normalizedPrefix || normalizedCandidate.startsWith(`${normalizedPrefix}/`)
}

const translatePathPrefix = (candidate: string, sourcePrefix: string, targetPrefix: string): string | null =>
  isPathUnderPrefix(candidate, sourcePrefix)
    ? `${targetPrefix}${candidate.slice(originalPrefixLength(sourcePrefix))}`
    : null

const resolveContainerProjectsRoot = (): string | null => {
  const explicit = resolveDockerEnvValue("DOCKER_GIT_PROJECTS_ROOT")
  if (explicit !== null) {
    return explicit
  }

  const home = resolveDockerEnvValue("HOME") ?? resolveDockerEnvValue("USERPROFILE")
  return home === null ? null : `${trimDockerPathTrailingSlash(home)}/.docker-git`
}

const resolveProjectsRootHostOverride = (): string | null => resolveDockerEnvValue("DOCKER_GIT_PROJECTS_ROOT_HOST")

const resolveCurrentContainerId = (
  cwd: string
): Effect.Effect<string | null, never, CommandExecutor.CommandExecutor> => {
  const fromEnv = resolveDockerEnvValue("HOSTNAME")
  if (fromEnv !== null) {
    return Effect.succeed(fromEnv)
  }

  return runCommandCapture(
    {
      cwd,
      command: "hostname",
      args: []
    },
    [0],
    () => new Error("hostname failed")
  ).pipe(
    Effect.map((value) => value.trim()),
    Effect.orElseSucceed(() => ""),
    Effect.map((value) => (value.length > 0 ? value : null))
  )
}

const parseDockerInspectMounts = (raw: string): ReadonlyArray<DockerMountBinding> =>
  raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .flatMap((line) => {
      const separator = line.indexOf("\t")
      if (separator <= 0 || separator >= line.length - 1) {
        return []
      }
      const source = line.slice(0, separator).trim()
      const destination = line.slice(separator + 1).trim()
      if (source.length === 0 || destination.length === 0) {
        return []
      }
      return [{ source, destination }]
    })

export const remapDockerBindHostPathFromMounts = (
  hostPath: string,
  mounts: ReadonlyArray<DockerMountBinding>
): string => {
  let match: DockerMountBinding | null = null
  for (const mount of mounts) {
    if (!isPathUnderPrefix(hostPath, mount.destination)) {
      continue
    }
    if (match === null || mount.destination.length > match.destination.length) {
      match = mount
    }
  }

  if (match === null) {
    return hostPath
  }

  return `${match.source}${hostPath.slice(originalPrefixLength(match.destination))}`
}

export const buildDockerBindMountArg = (volume: DockerVolume): string =>
  `type=bind,source=${volume.hostPath},target=${volume.containerPath}`

export const resolveDockerVolumeHostPath = (
  cwd: string,
  hostPath: string
): Effect.Effect<string, never, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const containerProjectsRoot = resolveContainerProjectsRoot()
    const hostProjectsRoot = resolveProjectsRootHostOverride()
    if (containerProjectsRoot !== null && hostProjectsRoot !== null) {
      const remapped = translatePathPrefix(hostPath, containerProjectsRoot, hostProjectsRoot)
      if (remapped !== null) {
        return remapped
      }
    }

    const containerId = yield* _(resolveCurrentContainerId(cwd))
    if (containerId === null) {
      return hostPath
    }

    const mountsJson = yield* _(
      runCommandCapture(
        {
          cwd,
          command: "docker",
          args: [
            "inspect",
            containerId,
            "--format",
            String.raw`{{range .Mounts}}{{println .Source "\t" .Destination}}{{end}}`
          ]
        },
        [0],
        () => new Error("docker inspect current container failed")
      ).pipe(Effect.orElseSucceed(() => ""))
    )

    return remapDockerBindHostPathFromMounts(hostPath, parseDockerInspectMounts(mountsJson))
  })

export const resolveDefaultDockerUser = (): string | null => {
  const getUid = Reflect.get(process, "getuid")
  const getGid = Reflect.get(process, "getgid")
  if (typeof getUid !== "function" || typeof getGid !== "function") {
    return null
  }
  const uid = getUid.call(process)
  const gid = getGid.call(process)
  if (typeof uid !== "number" || typeof gid !== "number") {
    return null
  }
  return `${uid}:${gid}`
}

const appendEnvArgs = (base: Array<string>, env: string | ReadonlyArray<string>) => {
  if (typeof env === "string") {
    const trimmed = env.trim()
    if (trimmed.length > 0) {
      base.push("-e", trimmed)
    }
    return
  }
  for (const entry of env) {
    const trimmed = entry.trim()
    if (trimmed.length === 0) {
      continue
    }
    base.push("-e", trimmed)
  }
}

const appendRepeatedOptionArgs = (base: Array<string>, name: string, value: string | ReadonlyArray<string>) => {
  const values = typeof value === "string" ? [value] : value
  for (const entry of values) {
    const normalized = normalizeDockerArgValue(entry)
    if (normalized !== null) {
      base.push(name, normalized)
    }
  }
}

const normalizeDockerArgValue = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim() ?? ""
  return trimmed.length > 0 ? trimmed : null
}

const resolveDockerRunNetwork = (network: string | undefined): string | null =>
  normalizeDockerArgValue(network) ?? resolveDockerEnvValue("DOCKER_GIT_AUTH_DOCKER_NETWORK")

const appendOptionArg = (base: Array<string>, name: string, value: string | null | undefined) => {
  const normalized = normalizeDockerArgValue(value)
  if (normalized !== null) {
    base.push(name, normalized)
  }
}

const appendDockerRunOptions = (base: Array<string>, spec: DockerAuthSpec) => {
  appendOptionArg(base, "--network", resolveDockerRunNetwork(spec.network))
  appendOptionArg(base, "--user", normalizeDockerArgValue(spec.user) ?? resolveDefaultDockerUser())
  if (spec.interactive) {
    base.push("-it")
  }
  appendOptionArg(base, "--entrypoint", spec.entrypoint)
  base.push("--mount", buildDockerBindMountArg(spec.volume))
  if (spec.tmpfs !== undefined) {
    appendRepeatedOptionArgs(base, "--tmpfs", spec.tmpfs)
  }
  if (spec.envFile !== undefined) {
    appendRepeatedOptionArgs(base, "--env-file", spec.envFile)
  }
  if (spec.env !== undefined) {
    appendEnvArgs(base, spec.env)
  }
}

const buildDockerArgs = (spec: DockerAuthSpec): ReadonlyArray<string> => {
  const base: Array<string> = ["run", "--rm"]
  appendDockerRunOptions(base, spec)
  return [...base, spec.image, ...spec.args]
}

// CHANGE: expose docker CLI args builder for advanced auth flows (stdin piping)
// WHY: some OAuth CLIs (Claude Code) don't reliably render their input UI; docker-git needs to drive stdin explicitly
// REF: issue-61
// SOURCE: n/a
// PURITY: CORE
// INVARIANT: args match those used by runDockerAuth / runDockerAuthCapture
export const buildDockerAuthArgs = (spec: DockerAuthSpec): ReadonlyArray<string> => buildDockerArgs(spec)

// CHANGE: run a docker auth command with controlled exit codes
// WHY: reuse container auth flow for gh/codex
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(cmd) in ok -> success
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError | E, CommandExecutor>
// INVARIANT: container is removed after execution
// COMPLEXITY: O(command)
export const runDockerAuth = <E>(
  spec: DockerAuthSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<void, E | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const hostPath = yield* _(resolveDockerVolumeHostPath(spec.cwd, spec.volume.hostPath))
    yield* _(
      runCommandWithExitCodes(
        {
          cwd: spec.cwd,
          command: "docker",
          args: buildDockerArgs({ ...spec, volume: { ...spec.volume, hostPath } })
        },
        okExitCodes,
        onFailure
      )
    )
  })

// CHANGE: run a docker auth command and capture stdout
// WHY: obtain tokens from container auth flows
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: capture(cmd) -> stdout
// PURITY: SHELL
// EFFECT: Effect<string, PlatformError | E, CommandExecutor>
// INVARIANT: container is removed after execution
// COMPLEXITY: O(command)
export const runDockerAuthCapture = <E>(
  spec: DockerAuthSpec,
  okExitCodes: ReadonlyArray<number>,
  onFailure: (exitCode: number) => E
): Effect.Effect<string, E | PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const hostPath = yield* _(resolveDockerVolumeHostPath(spec.cwd, spec.volume.hostPath))
    return yield* _(
      runCommandCapture(
        {
          cwd: spec.cwd,
          command: "docker",
          args: buildDockerArgs({ ...spec, volume: { ...spec.volume, hostPath } })
        },
        okExitCodes,
        onFailure
      )
    )
  })

// CHANGE: run a docker auth command and return the exit code
// WHY: allow status checks without throwing
// QUOTE(ТЗ): "поднимал отдельный контейнер где будет установлен чисто gh или чисто codex"
// REF: user-request-2026-01-28-auth
// SOURCE: n/a
// FORMAT THEOREM: forall cmd: exitCode(cmd) = n
// PURITY: SHELL
// EFFECT: Effect<number, PlatformError, CommandExecutor>
// INVARIANT: container is removed after execution
// COMPLEXITY: O(command)
export const runDockerAuthExitCode = (
  spec: DockerAuthSpec
): Effect.Effect<number, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const hostPath = yield* _(resolveDockerVolumeHostPath(spec.cwd, spec.volume.hostPath))
    return yield* _(
      runCommandExitCode({
        cwd: spec.cwd,
        command: "docker",
        args: buildDockerArgs({ ...spec, volume: { ...spec.volume, hostPath } })
      })
    )
  })

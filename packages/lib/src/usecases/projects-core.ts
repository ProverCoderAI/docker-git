import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { ProjectConfig } from "../core/domain.js"
import { deriveRepoPathParts } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { runDockerInspectContainerIp } from "../shell/docker.js"
import type { ConfigDecodeError, ConfigNotFoundError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { findDockerGitConfigPaths } from "./docker-git-config-search.js"
import { renderError } from "./errors.js"
import { defaultProjectsRoot, formatConnectionInfo } from "./menu-helpers.js"
import { findSshPrivateKey, resolveAuthorizedKeysPath, resolvePathFromCwd } from "./path-helpers.js"
import {
  type ProjectRuntimeKnownStatus,
  type ProjectRuntimeStartAction,
  readProjectRuntimeState
} from "./project-runtime-state.js"
import { withFsPathContext } from "./runtime.js"
import { buildEditorSshAccess, buildSshCommand, formatEditorSshAccessDetails } from "./ssh-access.js"

export type ProjectLoadError = PlatformError | ConfigNotFoundError | ConfigDecodeError

export type ProjectSummary = {
  readonly projectDir: string
  readonly config: ProjectConfig
  readonly sshCommand: string
  readonly sshKeyPath: string | null
  readonly ipAddress?: string | undefined
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
}

export type ProjectItem = {
  readonly projectDir: string
  readonly displayName: string
  readonly repoUrl: string
  readonly repoRef: string
  readonly containerName: string
  readonly serviceName: string
  readonly sshUser: string
  readonly sshPort: number
  readonly gpu: "none" | "all"
  readonly targetDir: string
  readonly sshCommand: string
  readonly ipAddress?: string | undefined
  readonly sshKeyPath: string | null
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
  readonly clonedOnHostname?: string | undefined
  readonly lastStartedAtIso: string | null
  readonly lastStartedAtEpochMs: number | null
  readonly lastStartAction: ProjectRuntimeStartAction | null
  readonly lastKnownStatus: ProjectRuntimeKnownStatus
}

export type ProjectStatus = {
  readonly projectDir: string
  readonly config: ProjectConfig
}

type ComposePsRow = {
  readonly name: string
  readonly status: string
  readonly ports: string
  readonly image: string
}

type ProjectBase = {
  readonly fs: FileSystem.FileSystem
  readonly path: Path.Path
  readonly projectDir: string
  readonly config: ProjectConfig
}

export const getContainerIpIfInsideContainer = (
  fs: FileSystem.FileSystem,
  projectDir: string,
  containerName: string
): Effect.Effect<string | undefined, PlatformError, CommandExecutor.CommandExecutor> =>
  Effect.gen(function*(_) {
    const isInsideContainer = yield* _(fs.exists("/.dockerenv"))
    if (!isInsideContainer) {
      return
    }
    return yield* _(
      runDockerInspectContainerIp(projectDir, containerName).pipe(
        Effect.orElse(() => Effect.succeed("")),
        Effect.map((ip) => (ip.length > 0 ? ip : undefined))
      )
    )
  })

const loadProjectBase = (
  configPath: string
): Effect.Effect<ProjectBase, ProjectLoadError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(configPath))
    const projectDir = path.dirname(resolved)
    const config = yield* _(readProjectConfig(projectDir))
    return { fs, path, projectDir, config }
  })

const findProjectConfigPaths = (
  projectsRoot: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) => findDockerGitConfigPaths(fs, path, path.resolve(projectsRoot)))

export const loadProjectSummary = (
  configPath: string,
  sshKey: string | null
): Effect.Effect<
  ProjectSummary,
  ProjectLoadError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { config, fs, path, projectDir } = yield* _(loadProjectBase(configPath))

    const resolvedAuthorizedKeys = resolveAuthorizedKeysPath(
      path,
      projectDir,
      config.template.authorizedKeysPath
    )
    const authExists = yield* _(fs.exists(resolvedAuthorizedKeys))
    const sshCommand = buildSshCommand(config.template, sshKey)

    return {
      projectDir,
      config,
      sshCommand,
      sshKeyPath: sshKey,
      authorizedKeysPath: resolvedAuthorizedKeys,
      authorizedKeysExists: authExists
    }
  })

export const loadProjectStatus = (
  configPath: string
): Effect.Effect<ProjectStatus, ProjectLoadError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const { config, projectDir } = yield* _(loadProjectBase(configPath))
    return { projectDir, config }
  })

export const renderProjectSummary = (summary: ProjectSummary): string =>
  formatConnectionInfo(
    summary.projectDir,
    summary.config,
    {
      authorizedKeysPath: summary.authorizedKeysPath,
      authorizedKeysExists: summary.authorizedKeysExists,
      sshCommand: summary.sshCommand,
      editorAccessDetails: formatEditorSshAccessDetails(
        buildEditorSshAccess(summary.config.template, summary.sshKeyPath, summary.ipAddress),
        summary.config.template.clonedOnHostname
      )
    }
  )

const formatDisplayName = (repoUrl: string): string => {
  const parts = deriveRepoPathParts(repoUrl)
  if (parts.pathParts.length > 0) {
    return parts.pathParts.join("/")
  }
  return repoUrl
}

// CHANGE: keep project inventory reads DB-only
// WHY: `.docker-git` is the project database; list/select must not depend on Docker runtime responsiveness
// QUOTE(ТЗ): ".docker-git это наша база данных можно скзаать"
// REF: user-message-2026-04-21-db-only-project-list
// SOURCE: n/a
// FORMAT THEOREM: forall c in docker_git_configs: loadProjectItem(c) reads filesystem(c) and not docker(c)
// PURITY: SHELL
// EFFECT: Effect<ProjectItem, ProjectLoadError, FileSystem | Path>
// INVARIANT: project inventory is derived only from docker-git.json and adjacent DB files
// COMPLEXITY: O(1) per project config
export const loadProjectItem = (
  configPath: string,
  sshKey: string | null
): Effect.Effect<ProjectItem, ProjectLoadError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const { config, fs, path, projectDir } = yield* _(loadProjectBase(configPath))
    const template = config.template

    const resolvedAuthorizedKeys = resolveAuthorizedKeysPath(path, projectDir, template.authorizedKeysPath)
    const authExists = yield* _(fs.exists(resolvedAuthorizedKeys))
    const sshCommand = buildSshCommand(template, sshKey)
    const displayName = formatDisplayName(template.repoUrl)
    const runtimeState = yield* _(readProjectRuntimeState(projectDir))

    return {
      projectDir,
      displayName,
      repoUrl: template.repoUrl,
      repoRef: template.repoRef,
      containerName: template.containerName,
      serviceName: template.serviceName,
      sshUser: template.sshUser,
      sshPort: template.sshPort,
      gpu: template.gpu,
      targetDir: template.targetDir,
      sshCommand,
      sshKeyPath: sshKey,
      authorizedKeysPath: resolvedAuthorizedKeys,
      authorizedKeysExists: authExists,
      envGlobalPath: resolvePathFromCwd(path, projectDir, template.envGlobalPath),
      envProjectPath: resolvePathFromCwd(path, projectDir, template.envProjectPath),
      codexAuthPath: resolvePathFromCwd(path, projectDir, template.codexAuthPath),
      codexHome: template.codexHome,
      clonedOnHostname: template.clonedOnHostname,
      lastStartedAtIso: runtimeState.lastStartedAtIso,
      lastStartedAtEpochMs: runtimeState.lastStartedAtEpochMs,
      lastStartAction: runtimeState.lastStartAction,
      lastKnownStatus: runtimeState.lastKnownStatus
    }
  })

export const renderProjectStatusHeader = (status: ProjectStatus): string => `Project: ${status.projectDir}`

export const skipWithWarning = <A>(configPath: string) => (error: ProjectLoadError) =>
  pipe(
    Effect.logWarning(`Skipping ${configPath}: ${renderError(error)}`),
    Effect.as<A | null>(null)
  )

export const forEachProjectStatus = <E, R>(
  configPaths: ReadonlyArray<string>,
  run: (status: ProjectStatus) => Effect.Effect<void, E, R>
): Effect.Effect<void, E | PlatformError, R | FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    for (const configPath of configPaths) {
      const status = yield* _(
        loadProjectStatus(configPath).pipe(
          Effect.matchEffect({
            onFailure: skipWithWarning<ProjectStatus>(configPath),
            onSuccess: (value) => Effect.succeed(value)
          })
        )
      )
      if (status === null) {
        continue
      }
      yield* _(run(status))
    }
  }).pipe(Effect.asVoid)

const normalizeCell = (value: string | undefined): string => value?.trim() ?? "-"

const parseComposeLine = (line: string): ComposePsRow => {
  const [name, status, ports, image] = line.split("\t")
  return {
    name: normalizeCell(name),
    status: normalizeCell(status),
    ports: normalizeCell(ports),
    image: normalizeCell(image)
  }
}

export const parseComposePsOutput = (raw: string): ReadonlyArray<ComposePsRow> => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  return lines.map((line) => parseComposeLine(line))
}

const padRight = (value: string, width: number): string =>
  value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`

export const formatComposeRows = (entries: ReadonlyArray<ComposePsRow>): string => {
  if (entries.length === 0) {
    return "  status: not running"
  }
  const nameWidth = Math.min(24, Math.max(...entries.map((row) => row.name.length), "name".length))
  const statusWidth = Math.min(28, Math.max(...entries.map((row) => row.status.length), "status".length))
  const portsWidth = Math.min(28, Math.max(...entries.map((row) => row.ports.length), "ports".length))
  const header = `  ${padRight("name", nameWidth)}  ${padRight("status", statusWidth)}  ${
    padRight("ports", portsWidth)
  }  image`
  const lines = entries.map((row) =>
    `  ${padRight(row.name, nameWidth)}  ${padRight(row.status, statusWidth)}  ${
      padRight(row.ports, portsWidth)
    }  ${row.image}`
  )
  return [header, ...lines].join("\n")
}

export type ProjectIndex = {
  readonly projectsRoot: string
  readonly configPaths: ReadonlyArray<string>
}

export const loadProjectIndex = (): Effect.Effect<
  ProjectIndex | null,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const projectsRoot = defaultProjectsRoot(process.cwd())
    const configPaths = yield* _(findProjectConfigPaths(projectsRoot))
    if (configPaths.length === 0) {
      yield* _(Effect.log(`No docker-git projects found in ${projectsRoot}`))
      return null
    }
    return { projectsRoot, configPaths }
  })

export const withProjectIndexAndSsh = <A, E, R>(
  run: (index: ProjectIndex, sshKey: string | null) => Effect.Effect<A, E, R>
): Effect.Effect<A | null, PlatformError | E, FileSystem.FileSystem | Path.Path | R> =>
  pipe(
    loadProjectIndex(),
    Effect.flatMap((index) =>
      index === null
        ? Effect.succeed(null)
        : Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
          return yield* _(run(index, sshKey))
        })
    )
  )

export { buildSshCommand } from "./ssh-access.js"

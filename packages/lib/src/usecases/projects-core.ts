import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { ProjectConfig, TemplateConfig } from "../core/domain.js"
import { deriveRepoPathParts } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import type { ConfigDecodeError, ConfigNotFoundError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { findDockerGitConfigPaths } from "./docker-git-config-search.js"
import { renderError } from "./errors.js"
import { defaultProjectsRoot, formatConnectionInfo } from "./menu-helpers.js"
import { findSshPrivateKey, resolveAuthorizedKeysPath, resolvePathFromCwd } from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"

const sshOptions = "-tt -Y -o LogLevel=ERROR -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

export type ProjectLoadError = PlatformError | ConfigNotFoundError | ConfigDecodeError

export const buildSshCommand = (
  config: TemplateConfig,
  sshKey: string | null
): string =>
  sshKey === null
    ? `ssh ${sshOptions} -p ${config.sshPort} ${config.sshUser}@localhost`
    : `ssh -i ${sshKey} ${sshOptions} -p ${config.sshPort} ${config.sshUser}@localhost`

export type ProjectSummary = {
  readonly projectDir: string
  readonly config: ProjectConfig
  readonly sshCommand: string
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
  readonly targetDir: string
  readonly sshCommand: string
  readonly sshKeyPath: string | null
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
  readonly envGlobalPath: string
  readonly envProjectPath: string
  readonly codexAuthPath: string
  readonly codexHome: string
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
): Effect.Effect<ProjectSummary, ProjectLoadError, FileSystem.FileSystem | Path.Path> =>
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
    summary.authorizedKeysPath,
    summary.authorizedKeysExists,
    summary.sshCommand
  )

const formatDisplayName = (repoUrl: string): string => {
  const parts = deriveRepoPathParts(repoUrl)
  if (parts.pathParts.length > 0) {
    return parts.pathParts.join("/")
  }
  return repoUrl
}

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

    return {
      projectDir,
      displayName,
      repoUrl: template.repoUrl,
      repoRef: template.repoRef,
      containerName: template.containerName,
      serviceName: template.serviceName,
      sshUser: template.sshUser,
      sshPort: template.sshPort,
      targetDir: template.targetDir,
      sshCommand,
      sshKeyPath: sshKey,
      authorizedKeysPath: resolvedAuthorizedKeys,
      authorizedKeysExists: authExists,
      envGlobalPath: resolvePathFromCwd(path, projectDir, template.envGlobalPath),
      envProjectPath: resolvePathFromCwd(path, projectDir, template.envProjectPath),
      codexAuthPath: resolvePathFromCwd(path, projectDir, template.codexAuthPath),
      codexHome: template.codexHome
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

type ProjectIndex = {
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

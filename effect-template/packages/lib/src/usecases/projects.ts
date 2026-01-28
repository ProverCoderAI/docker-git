import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { ProjectConfig, TemplateConfig } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { runDockerComposePs } from "../shell/docker.js"
import type { ConfigDecodeError, ConfigNotFoundError, DockerCommandError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { renderError } from "./errors.js"
import { defaultProjectsRoot, formatConnectionInfo } from "./menu-helpers.js"
import { findSshPrivateKey, resolveAuthorizedKeysPath } from "./path-helpers.js"

const sshOptions = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

export const buildSshCommand = (
  config: TemplateConfig,
  sshKey: string | null
): string =>
  sshKey === null
    ? `ssh ${sshOptions} -p ${config.sshPort} ${config.sshUser}@localhost`
    : `ssh -i ${sshKey} ${sshOptions} -p ${config.sshPort} ${config.sshUser}@localhost`

type ProjectSummary = {
  readonly projectDir: string
  readonly config: ProjectConfig
  readonly sshCommand: string
  readonly authorizedKeysPath: string
  readonly authorizedKeysExists: boolean
}

type ProjectStatus = {
  readonly projectDir: string
  readonly config: ProjectConfig
}

const isDockerGitConfig = (entry: string): boolean => entry.endsWith("docker-git.json")

const findProjectConfigPaths = (
  projectsRoot: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const exists = yield* _(fs.exists(projectsRoot))
    if (!exists) {
      return []
    }

    const entries: ReadonlyArray<string> = yield* _(fs.readDirectory(projectsRoot, { recursive: true }))
    return entries
      .filter((entry) => isDockerGitConfig(entry))
      .map((entry) => path.join(projectsRoot, entry))
  })

const loadProjectSummary = (
  configPath: string,
  sshKey: string | null
): Effect.Effect<
  ProjectSummary,
  PlatformError | ConfigNotFoundError | ConfigDecodeError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(configPath))
    const projectDir = path.dirname(resolved)
    const config = yield* _(readProjectConfig(projectDir))
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

const loadProjectStatus = (
  configPath: string
): Effect.Effect<
  ProjectStatus,
  PlatformError | ConfigNotFoundError | ConfigDecodeError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { path, resolved } = yield* _(resolveBaseDir(configPath))
    const projectDir = path.dirname(resolved)
    const config = yield* _(readProjectConfig(projectDir))
    return { projectDir, config }
  })

const renderProjectSummary = (summary: ProjectSummary): string =>
  formatConnectionInfo(
    summary.projectDir,
    summary.config,
    summary.authorizedKeysPath,
    summary.authorizedKeysExists,
    summary.sshCommand
  )

const renderProjectStatusHeader = (status: ProjectStatus): string =>
  `Project: ${status.projectDir} (container: ${status.config.template.containerName})`

type ProjectIndex = {
  readonly projectsRoot: string
  readonly configPaths: ReadonlyArray<string>
}

const loadProjectIndex = (): Effect.Effect<ProjectIndex | null, PlatformError, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function*(_) {
    const projectsRoot = defaultProjectsRoot(process.cwd())
    const configPaths = yield* _(findProjectConfigPaths(projectsRoot))
    if (configPaths.length === 0) {
      yield* _(Effect.log(`No docker-git projects found in ${projectsRoot}`))
      return null
    }
    return { projectsRoot, configPaths }
  })

const withProjectIndexAndSsh = <E, R>(
  run: (index: ProjectIndex, sshKey: string | null) => Effect.Effect<void, E, R>
): Effect.Effect<void, PlatformError | E, FileSystem.FileSystem | Path.Path | R> =>
  pipe(
    loadProjectIndex(),
    Effect.flatMap((index) =>
      index === null
        ? Effect.asVoid(Effect.succeed(null))
        : Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
          return yield* _(run(index, sshKey))
        })
    )
  )

// CHANGE: list docker-git projects with SSH connection info
// WHY: provide a deterministic inventory of created environments
// QUOTE(ТЗ): "мне нужны мои... доступы к ним по SSH"
// REF: user-request-2026-01-27-list
// SOURCE: n/a
// FORMAT THEOREM: forall root: list(root) -> summaries(root)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path>
// INVARIANT: output is deterministic for a stable filesystem
// COMPLEXITY: O(n) where n = |projects|
export const listProjects: Effect.Effect<
  void,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> = withProjectIndexAndSsh((index, sshKey) =>
  Effect.gen(function*(_) {
    const available: Array<ProjectSummary> = []

    for (const configPath of index.configPaths) {
      const summary = yield* _(
        loadProjectSummary(configPath, sshKey).pipe(
          Effect.catchAll((error) =>
            pipe(
              Effect.logWarning(`Skipping ${configPath}: ${renderError(error)}`),
              Effect.as<ProjectSummary | null>(null)
            )
          )
        )
      )
      if (summary !== null) {
        available.push(summary)
      }
    }
    if (available.length === 0) {
      yield* _(Effect.log(`No readable docker-git projects found in ${index.projectsRoot}`))
      return
    }

    yield* _(Effect.log(`Found ${available.length} docker-git project(s) in ${index.projectsRoot}`))
    for (const summary of available) {
      yield* _(Effect.log(renderProjectSummary(summary)))
    }
  })
)

// CHANGE: show docker compose status for all known docker-git projects
// WHY: allow checking active containers without switching directories
// QUOTE(ТЗ): "как посмотреть какие активны?"
// REF: user-request-2026-01-27-status
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: status(p) -> output(p)
// PURITY: SHELL
// EFFECT: Effect<void, PlatformError, FileSystem | Path | CommandExecutor>
// INVARIANT: each project emits a header before docker compose output
// COMPLEXITY: O(n) where n = |projects|
export const listProjectStatus: Effect.Effect<
  void,
  PlatformError,
  FileSystem.FileSystem | Path.Path | CommandExecutor.CommandExecutor
> = withProjectIndexAndSsh((index, sshKey) =>
  Effect.gen(function*(_) {
    for (const configPath of index.configPaths) {
      const status = yield* _(
        loadProjectStatus(configPath).pipe(
          Effect.catchAll((error) =>
            pipe(
              Effect.logWarning(`Skipping ${configPath}: ${renderError(error)}`),
              Effect.as<ProjectStatus | null>(null)
            )
          )
        )
      )
      if (status === null) {
        continue
      }

      yield* _(Effect.log(renderProjectStatusHeader(status)))
      yield* _(Effect.log(`SSH access: ${buildSshCommand(status.config.template, sshKey)}`))
      yield* _(
        runDockerComposePs(status.projectDir).pipe(
          Effect.catchAll((error: DockerCommandError | PlatformError) =>
            Effect.logWarning(`docker compose ps failed for ${status.projectDir}: ${renderError(error)}`)
          )
        )
      )
    }
  })
)

import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { Effect, pipe } from "effect"

import type { ProjectConfig, TemplateConfig } from "../core/domain.js"
import { deriveRepoPathParts } from "../core/domain.js"
import { readProjectConfig } from "../shell/config.js"
import { runCommandWithExitCodes } from "../shell/command-runner.js"
import { runDockerComposePsFormatted, runDockerComposeUp } from "../shell/docker.js"
import type { ConfigDecodeError, ConfigNotFoundError, DockerCommandError } from "../shell/errors.js"
import { CommandFailedError } from "../shell/errors.js"
import { resolveBaseDir } from "../shell/paths.js"
import { renderError } from "./errors.js"
import { defaultProjectsRoot, formatConnectionInfo } from "./menu-helpers.js"
import {
  findSshPrivateKey,
  resolveAuthorizedKeysPath,
  resolvePathFromCwd
} from "./path-helpers.js"
import { withFsPathContext } from "./runtime.js"

const sshOptions = "-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

type ProjectLoadError = PlatformError | ConfigNotFoundError | ConfigDecodeError

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

type ProjectStatus = {
  readonly projectDir: string
  readonly config: ProjectConfig
}

type ComposePsRow = {
  readonly name: string
  readonly status: string
  readonly ports: string
  readonly image: string
}

const isDockerGitConfig = (entry: string): boolean => entry.endsWith("docker-git.json")

const findProjectConfigPaths = (
  projectsRoot: string
): Effect.Effect<ReadonlyArray<string>, PlatformError, FileSystem.FileSystem | Path.Path> =>
  withFsPathContext(({ fs, path }) =>
    Effect.gen(function*(_) {
      const exists = yield* _(fs.exists(projectsRoot))
      if (!exists) {
        return []
      }

      const entries: ReadonlyArray<string> = yield* _(fs.readDirectory(projectsRoot, { recursive: true }))
      return entries
        .filter((entry) => isDockerGitConfig(entry))
        .map((entry) => path.join(projectsRoot, entry))
    })
  )

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

const formatDisplayName = (repoUrl: string): string => {
  const parts = deriveRepoPathParts(repoUrl)
  if (parts.pathParts.length > 0) {
    return parts.pathParts.join("/")
  }
  return repoUrl
}

const loadProjectItem = (
  configPath: string,
  sshKey: string | null
): Effect.Effect<
  ProjectItem,
  PlatformError | ConfigNotFoundError | ConfigDecodeError,
  FileSystem.FileSystem | Path.Path
> =>
  Effect.gen(function*(_) {
    const { fs, path, resolved } = yield* _(resolveBaseDir(configPath))
    const projectDir = path.dirname(resolved)
    const config = yield* _(readProjectConfig(projectDir))
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

const renderProjectStatusHeader = (status: ProjectStatus): string => `Project: ${status.projectDir}`

const skipWithWarning = <A>(configPath: string) => (error: ProjectLoadError) =>
  pipe(
    Effect.logWarning(`Skipping ${configPath}: ${renderError(error)}`),
    Effect.as<A | null>(null)
  )

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

const parseComposePsOutput = (raw: string): ReadonlyArray<ComposePsRow> => {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
  return lines.map((line) => parseComposeLine(line))
}

const padRight = (value: string, width: number): string =>
  value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`

const formatComposeRows = (entries: ReadonlyArray<ComposePsRow>): string => {
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
          Effect.matchEffect({
            onFailure: skipWithWarning<ProjectSummary>(configPath),
            onSuccess: (value) => Effect.succeed(value)
          })
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

// CHANGE: collect docker-git connection info lines without logging
// WHY: allow TUI to render connection info inline
// QUOTE(ТЗ): "А кнопка \"Show connection info\" ничего не отображает"
// REF: user-request-2026-02-01-tui-info
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: summary(p) -> line(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<string>, PlatformError, FileSystem | Path>
// INVARIANT: output order matches configPaths order
// COMPLEXITY: O(n) where n = |projects|
const emptySummaries = (): ReadonlyArray<string> => []

export const listProjectSummaries: Effect.Effect<
  ReadonlyArray<string>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> = pipe(
  loadProjectIndex(),
  Effect.flatMap((index) =>
    index === null
      ? Effect.succeed(emptySummaries())
      : Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
          const available: Array<string> = []

          for (const configPath of index.configPaths) {
            const summary = yield* _(
              loadProjectSummary(configPath, sshKey).pipe(
                Effect.matchEffect({
                  onFailure: () => Effect.succeed(null),
                  onSuccess: (value) => Effect.succeed(value)
                })
              )
            )
            if (summary !== null) {
              available.push(renderProjectSummary(summary))
            }
          }

          return available
        })
  )
)

// CHANGE: load docker-git projects for TUI selection
// WHY: provide structured project data without noisy logs
// QUOTE(ТЗ): "А ты можешь сделать удобный выбор проектов?"
// REF: user-request-2026-02-02-select-project
// SOURCE: n/a
// FORMAT THEOREM: forall p in projects: item(p) -> selectable(p)
// PURITY: SHELL
// EFFECT: Effect<ReadonlyArray<ProjectItem>, PlatformError, FileSystem | Path>
// INVARIANT: output order matches configPaths order
// COMPLEXITY: O(n) where n = |projects|
export const listProjectItems: Effect.Effect<
  ReadonlyArray<ProjectItem>,
  PlatformError,
  FileSystem.FileSystem | Path.Path
> = pipe(
  loadProjectIndex(),
  Effect.flatMap((index) =>
    index === null
      ? Effect.succeed([] as ReadonlyArray<ProjectItem>)
      : Effect.gen(function*(_) {
          const fs = yield* _(FileSystem.FileSystem)
          const path = yield* _(Path.Path)
          const sshKey = yield* _(findSshPrivateKey(fs, path, process.cwd()))
          const available: Array<ProjectItem> = []

          for (const configPath of index.configPaths) {
            const item = yield* _(
              loadProjectItem(configPath, sshKey).pipe(
                Effect.matchEffect({
                  onFailure: () => Effect.succeed(null),
                  onSuccess: (value) => Effect.succeed(value)
                })
              )
            )
            if (item !== null) {
              available.push(item)
            }
          }

          return available
        })
  )
)

const buildSshArgs = (item: ProjectItem): ReadonlyArray<string> => {
  const args: Array<string> = []
  if (item.sshKeyPath !== null) {
    args.push("-i", item.sshKeyPath)
  }
  args.push(
    "-tt",
    "-o",
    "StrictHostKeyChecking=no",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-p",
    String(item.sshPort),
    `${item.sshUser}@localhost`
  )
  return args
}

// CHANGE: connect to a project via SSH using its resolved settings
// WHY: allow TUI to open a shell immediately after selection
// QUOTE(ТЗ): "выбор проекта сразу подключает по SSH"
// REF: user-request-2026-02-02-select-ssh
// SOURCE: n/a
// FORMAT THEOREM: forall p: connect(p) -> ssh(p)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | PlatformError, CommandExecutor>
// INVARIANT: command is ssh with deterministic args
// COMPLEXITY: O(1)
export const connectProjectSsh = (
  item: ProjectItem
): Effect.Effect<void, CommandFailedError | PlatformError, CommandExecutor.CommandExecutor> =>
  runCommandWithExitCodes(
    {
      cwd: process.cwd(),
      command: "ssh",
      args: buildSshArgs(item)
    },
    [0],
    (exitCode) => new CommandFailedError({ command: "ssh", exitCode })
  )

// CHANGE: ensure docker compose is up before SSH connection
// WHY: selected project should auto-start when not running
// QUOTE(ТЗ): "Если не поднят то пусть поднимает"
// REF: user-request-2026-02-02-select-up
// SOURCE: n/a
// FORMAT THEOREM: forall p: up(p) -> ssh(p)
// PURITY: SHELL
// EFFECT: Effect<void, CommandFailedError | DockerCommandError | PlatformError, CommandExecutor>
// INVARIANT: docker compose up runs before ssh
// COMPLEXITY: O(1)
export const connectProjectSshWithUp = (
  item: ProjectItem
): Effect.Effect<
  void,
  CommandFailedError | DockerCommandError | PlatformError,
  CommandExecutor.CommandExecutor
> =>
  Effect.flatMap(
    runDockerComposeUp(item.projectDir),
    () => connectProjectSsh(item)
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
          Effect.matchEffect({
            onFailure: skipWithWarning<ProjectStatus>(configPath),
            onSuccess: (value) => Effect.succeed(value)
          })
        )
      )
      if (status === null) {
        continue
      }

      yield* _(Effect.log(renderProjectStatusHeader(status)))
      yield* _(Effect.log(`SSH access: ${buildSshCommand(status.config.template, sshKey)}`))
      yield* _(
        runDockerComposePsFormatted(status.projectDir).pipe(
          Effect.map((raw) => parseComposePsOutput(raw)),
          Effect.map((rows) => formatComposeRows(rows)),
          Effect.flatMap((text) => Effect.log(text)),
          Effect.matchEffect({
            onFailure: (error: DockerCommandError | PlatformError) =>
              Effect.logWarning(
                `docker compose ps failed for ${status.projectDir}: ${renderError(error)}`
              ),
            onSuccess: () => Effect.void
          })
        )
      )
    }
  })
)

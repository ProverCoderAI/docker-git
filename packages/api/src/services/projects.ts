import {
  type AppError,
  applyProjectConfig,
  buildCreateCommand,
  defaultTemplateConfig,
  createProject,
  formatParseError,
  applyAllDockerGitProjects,
  downAllDockerGitProjects,
  listProjectItems,
  readProjectConfig,
  recordProjectRuntimeStarted,
  recordProjectRuntimeStopped,
  renderError,
  runDockerComposeUpWithPortCheck
} from "@effect-template/lib"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { defaultProjectsRoot, resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { deleteDockerGitProject } from "@effect-template/lib/usecases/projects"
import { autoPullState } from "@effect-template/lib/usecases/state-repo"
import type { RawOptions } from "@effect-template/lib/core/command-options"
import type { CreateCommand as LibCreateCommand } from "@effect-template/lib/core/domain"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect, Either, Logger } from "effect"

import type {
  ApplyProjectRequest,
  CreateProjectAccepted,
  CreateProjectRequest,
  ProjectDetails,
  ProjectStatus,
  ProjectSummary
} from "../api/contracts.js"
import { ApiAuthRequiredError, ApiConflictError, ApiInternalError, ApiNotFoundError, ApiBadRequestError } from "../api/errors.js"
import { ensureGithubAuthForCreate, ensureGitlabAuthForCreate } from "./auth.js"
import { clearProjectEvents, emitProjectEvent, latestProjectCursor } from "./events.js"
import { resolveCreateAuthorizedKeysContents, resolveManagedAuthorizedKeysContents } from "./project-authorized-keys.js"
import { stopProjectBrowserRuntime, suspendProjectRuntime } from "./project-lifecycle-resources.js"
import { projectShortKey } from "./project-port-proxy-core.js"
import { loadProjectRuntimeByProject, runtimeForProject } from "./project-runtime.js"

type RuntimeStartAction = "create" | "up" | "recreate"

const readComposePsFormatted = (cwd: string) =>
  runCommandCapture(
    {
      cwd,
      command: "docker",
      args: [
        "compose",
        "--ansi",
        "never",
        "ps",
        "--format",
        "{{.Name}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"
      ]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: "docker compose ps", exitCode })
  )

const runComposeCapture = (
  projectId: string,
  cwd: string,
  args: ReadonlyArray<string>,
  okExitCodes: ReadonlyArray<number> = [0]
) =>
  runCommandCapture(
    {
      cwd,
      command: "docker",
      args: ["compose", "--ansi", "never", ...args]
    },
    okExitCodes,
    (exitCode) => new CommandFailedError({ command: `docker compose ${args.join(" ")}`, exitCode })
  ).pipe(
    Effect.tap((output) =>
      Effect.sync(() => {
        for (const line of output.split(/\r?\n/u)) {
          const trimmed = redactProjectLogLine(line.trimEnd())
          if (trimmed.length > 0) {
            emitProjectEvent(projectId, "project.deployment.log", {
              line: trimmed,
              command: `docker compose ${args.join(" ")}`
            })
          }
        }
      })
    )
  )

const runWithProjectEventLogs = <A, E, R>(
  projectId: string,
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function*(_) {
    const logger = Logger.make(({ message }) => {
      for (const line of String(message).split(/\r?\n/u)) {
        const trimmed = redactProjectLogLine(line.trimEnd())
        if (trimmed.length > 0) {
          emitProjectEvent(projectId, "project.deployment.log", { line: trimmed })
        }
      }
    })

    return yield* _(effect.pipe(Effect.provide(Logger.replace(Logger.defaultLogger, logger))))
  })

const redactProjectLogLine = (line: string): string =>
  line
    .replace(/https:\/\/([^:\s/@]+):([^@\s]+)@/gu, "https://$1:***@")
    .replace(/\b(GH_TOKEN|GITHUB_TOKEN|GIT_AUTH_TOKEN)=\S+/gu, "$1=***")

const toProjectStatus = (raw: string): ProjectStatus => {
  const normalized = raw.toLowerCase()
  if (normalized.includes("up") || normalized.includes("running")) {
    return "running"
  }
  if (normalized.includes("exited") || normalized.includes("stopped") || raw.trim().length === 0) {
    return "stopped"
  }
  return "unknown"
}

const statusLabelFromPs = (raw: string): string => {
  const lines = raw
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    return "stopped"
  }
  const statuses = lines
    .map((line) => {
      const parts = line.split("\t")
      return parts[1]?.trim() ?? "unknown"
    })
    .filter((value) => value.length > 0)
  return statuses.length > 0 ? statuses.join(", ") : "unknown"
}

const withProjectRuntime = (
  project: ProjectItem,
  runtime: ReturnType<typeof runtimeForProject>
) =>
  readComposePsFormatted(project.projectDir).pipe(
    Effect.catchAll(() => Effect.succeed("")),
    Effect.map((rawStatus) => ({
      id: project.projectDir,
      projectKey: projectShortKey(project.projectDir),
      displayName: project.displayName,
      repoUrl: project.repoUrl,
      repoRef: project.repoRef,
      containerName: project.containerName,
      status: toProjectStatus(rawStatus),
      statusLabel: statusLabelFromPs(rawStatus),
      sshSessions: runtime.sshSessions,
      startedAtIso: runtime.startedAtIso,
      startedAtEpochMs: runtime.startedAtEpochMs,
      ...(project.clonedOnHostname === undefined ? {} : { clonedOnHostname: project.clonedOnHostname })
    }))
  )

const cachedStatusLabel = (status: ProjectStatus): string =>
  status === "unknown" ? "unknown" : `last known: ${status}`

// CHANGE: derive project list/detail API payloads from `.docker-git` only
// WHY: project inventory is database state, while Docker runtime is queried only by explicit runtime actions
// QUOTE(ТЗ): ".docker-git это наша база данных можно скзаать"
// REF: user-message-2026-04-21-db-only-project-list
// SOURCE: n/a
// FORMAT THEOREM: forall p in DB: listProjects(p) does not require docker(p)
// PURITY: SHELL
// EFFECT: n/a
// INVARIANT: runtime fields are conservative defaults when not stored in `.docker-git`
// COMPLEXITY: O(1)
const dbProjectSummary = (
  project: ProjectItem
): ProjectSummary => ({
  id: project.projectDir,
  projectKey: projectShortKey(project.projectDir),
  displayName: project.displayName,
  repoUrl: project.repoUrl,
  repoRef: project.repoRef,
  containerName: project.containerName,
  status: project.lastKnownStatus,
  statusLabel: cachedStatusLabel(project.lastKnownStatus),
  sshSessions: 0,
  startedAtIso: project.lastStartedAtIso,
  startedAtEpochMs: project.lastStartedAtEpochMs,
  ...(project.clonedOnHostname === undefined ? {} : { clonedOnHostname: project.clonedOnHostname })
})

const toProjectDetails = (
  project: ProjectItem,
  summary: ProjectSummary
): ProjectDetails => ({
  ...summary,
  containerName: project.containerName,
  serviceName: project.serviceName,
  sshUser: project.sshUser,
  sshPort: project.sshPort,
  gpu: project.gpu,
  targetDir: project.targetDir,
  projectDir: project.projectDir,
  sshCommand: project.sshCommand,
  authorizedKeysPath: project.authorizedKeysPath,
  authorizedKeysExists: project.authorizedKeysExists,
  envGlobalPath: project.envGlobalPath,
  envProjectPath: project.envProjectPath,
  codexAuthPath: project.codexAuthPath,
  codexHome: project.codexHome
})

const dbProjectDetails = (project: ProjectItem): ProjectDetails => toProjectDetails(project, dbProjectSummary(project))

const toProjectInventoryReadError = (error: unknown): ApiInternalError =>
  new ApiInternalError({
    message: `Failed to read docker-git project inventory: ${String(error)}`,
    cause: error
  })

/**
 * Refreshes controller project inventory from the shared state repository.
 *
 * @returns Effect that completes after best-effort state auto-pull.
 *
 * @pure false
 * @effect FileSystem, Path, CommandExecutor through autoPullState.
 * @invariant Respects DOCKER_GIT_STATE_AUTO_PULL=false and never fails.
 * @precondition Controller state root may or may not be a git repository.
 * @postcondition If auto-pull is enabled and succeeds, local inventory includes latest remote state.
 * @complexity O(1) git remote round-trip when enabled.
 * @throws Never - failures are logged by autoPullState.
 */
// CHANGE: refresh shared state before project inventory reads
// WHY: shell and web both read `/projects`; stale controller state caused issue #372
// QUOTE(ТЗ): "project not synchronized"
// REF: issue-372
// SOURCE: https://github.com/ProverCoderAI/docker-git/issues/372
// FORMAT THEOREM: remote_has(p) and pull_enabled -> p in inventory_after_refresh
// PURITY: SHELL
// EFFECT: Effect<void, never, FileSystem | Path | CommandExecutor>
// INVARIANT: refresh failure cannot masquerade as an empty project list
// COMPLEXITY: O(git pull)
export const refreshProjectStateForInventory = () => autoPullState

export const readProjectItemsForInventory = () =>
  refreshProjectStateForInventory().pipe(
    Effect.zipRight(listProjectItems),
    Effect.mapError(toProjectInventoryReadError)
  )

const runtimeProjectDetails = (project: ProjectItem) =>
  Effect.gen(function*(_) {
    const runtimeByProject = yield* _(loadProjectRuntimeByProject([project]))
    const summary = yield* _(withProjectRuntime(project, runtimeForProject(runtimeByProject, project)))
    return toProjectDetails(project, summary)
  })

const recordProjectStartedFromDetails = (
  project: ProjectItem,
  details: ProjectDetails,
  action: RuntimeStartAction
) =>
  recordProjectRuntimeStarted(project.projectDir, {
    action,
    startedAtIso: details.startedAtIso,
    startedAtEpochMs: details.startedAtEpochMs
  }).pipe(Effect.asVoid)

const projectIdAliases = (
  path: Path.Path,
  projectId: string
): ReadonlySet<string> => {
  const projectsRoot = path.resolve(defaultProjectsRoot(process.cwd()))
  const normalized = projectId
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
  const rooted = normalized === ".docker-git"
    ? projectsRoot
    : normalized.startsWith(".docker-git/")
      ? path.join(projectsRoot, normalized.slice(".docker-git/".length))
      : projectId
  const absolute = path.isAbsolute(rooted) ? path.resolve(rooted) : path.resolve(process.cwd(), rooted)
  return new Set([projectId, rooted, absolute])
}

const findProjectById = (projectId: string) =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const aliases = projectIdAliases(path, projectId)
    const projects = yield* _(readProjectItemsForInventory())
    const project = projects.find((item) => item.projectDir === projectId)
      ?? projects.find((item) => aliases.has(item.projectDir) || aliases.has(path.resolve(item.projectDir)))
    if (project) {
      return project
    }
    return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project not found: ${projectId}` })))
  })

export const getProjectItemById = (projectId: string) => findProjectById(projectId)

const findProjectByKey = (projectKey: string) =>
  Effect.gen(function*(_) {
    const projects = yield* _(readProjectItemsForInventory())
    const matches = projects.filter((item) => projectShortKey(item.projectDir) === projectKey)
    if (matches.length === 0) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
    }
    if (matches.length > 1) {
      return yield* _(Effect.fail(new ApiConflictError({ message: `Project key is ambiguous: ${projectKey}` })))
    }
    const project = matches[0]
    return project === undefined
      ? yield* _(Effect.fail(new ApiNotFoundError({ message: `Project key not found: ${projectKey}` })))
      : project
  })

export const getProjectItemByKey = (projectKey: string) => findProjectByKey(projectKey)

const resolveCreatedProject = (
  containerName: string,
  repoUrl: string,
  repoRef: string
) =>
  listProjectItems.pipe(
    Effect.flatMap((items) => {
      const exact = items.find((item) =>
        item.containerName === containerName && item.repoUrl === repoUrl && item.repoRef === repoRef)
      if (exact) {
        return Effect.succeed(exact)
      }
      const fallback = items.find((item) => item.containerName === containerName)
      return fallback
        ? Effect.succeed(fallback)
        : Effect.fail(
          new ApiInternalError({ message: "Project was created but could not be reloaded from index." })
        )
    })
  )

const normalizeAuthorizedKeys = (value: string): ReadonlyArray<string> =>
  value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)

type ProjectApiError =
  | AppError
  | ApiAuthRequiredError
  | ApiBadRequestError
  | ApiConflictError
  | ApiInternalError
  | ApiNotFoundError

const toProjectApiError = (
  error: ProjectApiError
): ApiAuthRequiredError | ApiBadRequestError | ApiConflictError | ApiInternalError | ApiNotFoundError =>
  error instanceof ApiAuthRequiredError ||
  error instanceof ApiBadRequestError ||
  error instanceof ApiConflictError ||
  error instanceof ApiInternalError ||
  error instanceof ApiNotFoundError
    ? error
    : new ApiInternalError({
      message: renderError(error),
      cause: error
    })

const mergeAuthorizedKeys = (
  current: ReadonlyArray<string>,
  next: ReadonlyArray<string>
): string => {
  const merged = [...current]
  for (const line of next) {
    if (!merged.includes(line)) {
      merged.push(line)
    }
  }
  return merged.length === 0 ? "" : `${merged.join("\n")}\n`
}

const resolveRequestedAuthorizedKeysContents = (
  authorizedKeysContents: string | undefined,
  useManagedAuthorizedKeys: boolean
) =>
  Effect.gen(function*(_) {
    const managedAuthorizedKeysContents = useManagedAuthorizedKeys
      ? yield* _(resolveManagedAuthorizedKeysContents())
      : undefined
    const merged = mergeAuthorizedKeys(
      normalizeAuthorizedKeys(managedAuthorizedKeysContents ?? ""),
      normalizeAuthorizedKeys(authorizedKeysContents ?? "")
    )

    return merged.length === 0 ? undefined : merged
  })

const withManagedAuthorizedKeysForCreate = (
  command: LibCreateCommand,
  authorizedKeysContents: string | undefined
) =>
  authorizedKeysContents === undefined
    ? command
    : {
      ...command,
      config: {
        ...command.config,
        authorizedKeysPath: defaultTemplateConfig.authorizedKeysPath
      }
    }

export const seedAuthorizedKeysForCreate = (
  outDir: string,
  authorizedKeysContents: string | undefined
) =>
  Effect.gen(function*(_) {
    const normalized = normalizeAuthorizedKeys(authorizedKeysContents ?? "")
    if (normalized.length === 0) {
      return
    }

    const fs = yield* _(FileSystem.FileSystem)
    const path = yield* _(Path.Path)
    const defaultAuthorizedKeysPath = path.join(defaultProjectsRoot(process.cwd()), "authorized_keys")
    const resolvedOutDir = resolvePathFromCwd(path, process.cwd(), outDir)
    const projectAuthorizedKeysPath = path.join(resolvedOutDir, "authorized_keys")
    const targets = Array.from(new Set([defaultAuthorizedKeysPath, projectAuthorizedKeysPath]))

    for (const target of targets) {
      const exists = yield* _(fs.exists(target))
      const current = exists ? yield* _(fs.readFileString(target)) : ""
      const merged = mergeAuthorizedKeys(normalizeAuthorizedKeys(current), normalized)

      yield* _(fs.makeDirectory(path.dirname(target), { recursive: true }))
      yield* _(fs.writeFileString(target, merged))
    }
  })

type PreparedCreateProject = {
  readonly command: LibCreateCommand
  readonly projectId: string
}

const toCreateRawOptions = (request: CreateProjectRequest): RawOptions => ({
  ...(request.repoUrl === undefined ? {} : { repoUrl: request.repoUrl }),
  ...(request.repoRef === undefined ? {} : { repoRef: request.repoRef }),
  ...(request.targetDir === undefined ? {} : { targetDir: request.targetDir }),
  ...(request.sshPort === undefined ? {} : { sshPort: request.sshPort }),
  ...(request.sshUser === undefined ? {} : { sshUser: request.sshUser }),
  ...(request.containerName === undefined ? {} : { containerName: request.containerName }),
  ...(request.serviceName === undefined ? {} : { serviceName: request.serviceName }),
  ...(request.volumeName === undefined ? {} : { volumeName: request.volumeName }),
  ...(request.secretsRoot === undefined ? {} : { secretsRoot: request.secretsRoot }),
  ...(request.authorizedKeysPath === undefined ? {} : { authorizedKeysPath: request.authorizedKeysPath }),
  ...(request.envGlobalPath === undefined ? {} : { envGlobalPath: request.envGlobalPath }),
  ...(request.envProjectPath === undefined ? {} : { envProjectPath: request.envProjectPath }),
  ...(request.codexAuthPath === undefined ? {} : { codexAuthPath: request.codexAuthPath }),
  ...(request.codexHome === undefined ? {} : { codexHome: request.codexHome }),
  ...(request.cpuLimit === undefined ? {} : { cpuLimit: request.cpuLimit }),
  ...(request.ramLimit === undefined ? {} : { ramLimit: request.ramLimit }),
  ...(request.playwrightCpuLimit === undefined ? {} : { playwrightCpuLimit: request.playwrightCpuLimit }),
  ...(request.playwrightRamLimit === undefined ? {} : { playwrightRamLimit: request.playwrightRamLimit }),
  ...(request.gpu === undefined ? {} : { gpu: request.gpu }),
  ...(request.dockerNetworkMode === undefined ? {} : { dockerNetworkMode: request.dockerNetworkMode }),
  ...(request.dockerSharedNetworkName === undefined
    ? {}
    : { dockerSharedNetworkName: request.dockerSharedNetworkName }),
  ...(request.enableMcpPlaywright === undefined ? {} : { enableMcpPlaywright: request.enableMcpPlaywright }),
  ...(request.enableMcpAndroid === undefined ? {} : { enableMcpAndroid: request.enableMcpAndroid }),
  ...(request.outDir === undefined ? {} : { outDir: request.outDir }),
  ...(request.gitTokenLabel === undefined ? {} : { gitTokenLabel: request.gitTokenLabel }),
  ...(request.skipGithubAuth === undefined ? {} : { skipGithubAuth: request.skipGithubAuth }),
  ...(request.codexTokenLabel === undefined ? {} : { codexTokenLabel: request.codexTokenLabel }),
  ...(request.claudeTokenLabel === undefined ? {} : { claudeTokenLabel: request.claudeTokenLabel }),
  ...(request.geminiTokenLabel === undefined ? {} : { geminiTokenLabel: request.geminiTokenLabel }),
  ...(request.grokTokenLabel === undefined ? {} : { grokTokenLabel: request.grokTokenLabel }),
  ...(request.agentAutoMode === undefined ? {} : { agentAutoMode: request.agentAutoMode }),
  ...(request.up === undefined ? {} : { up: request.up }),
  ...(request.openSsh === undefined ? {} : { openSsh: request.openSsh }),
  ...(request.force === undefined ? {} : { force: request.force }),
  ...(request.forceEnv === undefined ? {} : { forceEnv: request.forceEnv }),
  ...(request.clonedOnHostname === undefined ? {} : { clonedOnHostname: request.clonedOnHostname })
})

const parseCreateCommandRequest = (
  request: CreateProjectRequest
): Effect.Effect<LibCreateCommand, ApiBadRequestError> => {
  const parsed = buildCreateCommand(toCreateRawOptions(request))
  if (Either.isLeft(parsed)) {
    return Effect.fail(
      new ApiBadRequestError({
        message: "Invalid create payload.",
        details: formatParseError(parsed.left)
      })
    )
  }

  return Effect.succeed({
    ...parsed.right,
    openSsh: false,
    waitForClone: request.waitForClone ?? parsed.right.waitForClone
  })
}

const prepareCreateProjectRequest = (
  request: CreateProjectRequest
) =>
  Effect.gen(function*(_) {
    const parsedCommand = yield* _(parseCreateCommandRequest(request))
    const requestAuthorizedKeysContents = request.authorizedKeysContents ?? (
      request.useManagedAuthorizedKeys === true
        ? yield* _(resolveCreateAuthorizedKeysContents(parsedCommand.outDir, parsedCommand.config.authorizedKeysPath))
        : undefined
    )
    const resolvedAuthorizedKeysContents = yield* _(
      resolveRequestedAuthorizedKeysContents(requestAuthorizedKeysContents, request.useManagedAuthorizedKeys === true)
    )

    const command = withManagedAuthorizedKeysForCreate(parsedCommand, resolvedAuthorizedKeysContents)

    yield* _(seedAuthorizedKeysForCreate(command.outDir, resolvedAuthorizedKeysContents))
    yield* _(ensureGithubAuthForCreate(command.config))
    yield* _(ensureGitlabAuthForCreate(command.config))

    return {
      command,
      projectId: command.outDir
    }
  })

const emitCreateStatus = (
  projectId: string,
  phase: string,
  message: string
) =>
  Effect.sync(() => {
    emitProjectEvent(projectId, "project.deployment.status", { phase, message })
  })

const emitProjectCreatedEvents = (
  projectId: string,
  project: ProjectItem,
  details: ProjectDetails
) =>
  Effect.sync(() => {
    const payload = {
      projectId: project.projectDir,
      containerName: project.containerName,
      project: details
    }
    emitProjectEvent(project.projectDir, "project.created", payload)
    if (project.projectDir !== projectId) {
      emitProjectEvent(projectId, "project.created", payload)
    }
  })

const toCreateFailureMessage = (error: ProjectApiError): string =>
  error instanceof ApiAuthRequiredError ||
  error instanceof ApiBadRequestError ||
  error instanceof ApiConflictError ||
  error instanceof ApiInternalError ||
  error instanceof ApiNotFoundError
    ? error.message
    : renderError(error)

const runPreparedCreateProject = (
  prepared: PreparedCreateProject
) =>
  Effect.gen(function*(_) {
    const { command, projectId } = prepared

    yield* _(
      runWithProjectEventLogs(
        projectId,
        createProject(command).pipe(
          Effect.catchTag("DockerIdentityConflictError", (error) =>
            Effect.fail(new ApiConflictError({ message: renderError(error) }))
          )
        )
      )
    )

    const project = yield* _(
      resolveCreatedProject(
        command.config.containerName,
        command.config.repoUrl,
        command.config.repoRef
      )
    )
    const details = command.runUp ? yield* _(runtimeProjectDetails(project)) : dbProjectDetails(project)
    if (command.runUp) {
      yield* _(recordProjectStartedFromDetails(project, details, "create"))
    }

    yield* _(emitProjectCreatedEvents(projectId, project, details))

    return details
  }).pipe(Effect.mapError(toProjectApiError))

const startCreateProjectJob = (
  prepared: PreparedCreateProject
) =>
  Effect.gen(function*(_) {
    clearProjectEvents(prepared.projectId)
    const cursor = latestProjectCursor(prepared.projectId)
    yield* _(emitCreateStatus(prepared.projectId, "create", "Project creation started"))
    yield* _(
      runPreparedCreateProject(prepared).pipe(
        Effect.matchEffect({
          onFailure: (error) =>
            emitCreateStatus(prepared.projectId, "failed", toCreateFailureMessage(error)),
          onSuccess: () => Effect.void
        }),
        Effect.forkDaemon
      )
    )
    return {
      accepted: true,
      projectId: prepared.projectId,
      cursor
    } satisfies CreateProjectAccepted
  })

export const listProjects = () =>
  readProjectItemsForInventory().pipe(
    Effect.map((projects) => projects.map((project) => dbProjectDetails(project)))
  )

export const applyAllProjects = (activeOnly: boolean) =>
  applyAllDockerGitProjects({
    _tag: "ApplyAll",
    activeOnly
  })

export const applyProjectById = (
  projectId: string,
  request: ApplyProjectRequest = {}
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    yield* _(markDeployment(projectId, "apply", "docker-git apply"))
    yield* _(
      runWithProjectEventLogs(
        projectId,
        applyProjectConfig({
          _tag: "Apply",
          projectDir: project.projectDir,
          ...(request.cpuLimit === undefined ? {} : { cpuLimit: request.cpuLimit }),
          ...(request.ramLimit === undefined ? {} : { ramLimit: request.ramLimit }),
          ...(request.playwrightCpuLimit === undefined ? {} : { playwrightCpuLimit: request.playwrightCpuLimit }),
          ...(request.playwrightRamLimit === undefined ? {} : { playwrightRamLimit: request.playwrightRamLimit }),
          ...(request.gpu === undefined ? {} : { gpu: request.gpu }),
          runUp: true
        })
      )
    )
    const details = yield* _(runtimeProjectDetails(project))
    yield* _(recordProjectStartedFromDetails(project, details, "up"))
    yield* _(markDeployment(projectId, "running", "Apply completed"))
    return details
  }).pipe(Effect.mapError(toProjectApiError))

export const downAllProjects = () => downAllDockerGitProjects

export const getProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    return dbProjectDetails(project)
  })

// CHANGE: create a docker-git project exclusively through typed API input.
// WHY: issue #84 requires end-to-end project lifecycle without CLI interaction.
// QUOTE(ТЗ): "Мне надо иметь возможность управлять полностью проектом с помощью API"
// REF: issue-84-project-create
// SOURCE: n/a
// FORMAT THEOREM: forall req: valid(req) -> exists(project(req))
// PURITY: SHELL
// EFFECT: Effect<ProjectDetails, ApiBadRequestError | ApiInternalError>
// INVARIANT: openSsh is always disabled in API mode
// COMPLEXITY: O(n) where n = number of projects in index scan
export const createProjectFromRequest = (
  request: CreateProjectRequest
) =>
  Effect.gen(function*(_) {
    yield* _(refreshProjectStateForInventory())
    const prepared = yield* _(prepareCreateProjectRequest(request).pipe(Effect.mapError(toProjectApiError)))
    if (request.async === true) {
      return yield* _(startCreateProjectJob(prepared))
    }

    clearProjectEvents(prepared.projectId)
    yield* _(emitCreateStatus(prepared.projectId, "create", "Project creation started"))
    return yield* _(runPreparedCreateProject(prepared).pipe(Effect.mapError(toProjectApiError)))
  }).pipe(Effect.mapError(toProjectApiError))

export const deleteProjectById = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    yield* _(deleteDockerGitProject(project))
    yield* _(
      Effect.sync(() => {
        emitProjectEvent(projectId, "project.deleted", { projectId })
      })
    )
  }).pipe(Effect.mapError(toProjectApiError))

const markDeployment = (projectId: string, phase: string, message: string) =>
  Effect.sync(() => {
    emitProjectEvent(projectId, "project.deployment.status", { phase, message })
  })

type UpProjectOptions = {
  readonly startupMode?: "default" | "resume" | "ssh-open"
}

const upProjectPhase = (startupMode: NonNullable<UpProjectOptions["startupMode"]>): string =>
  startupMode === "ssh-open" ? "ssh.compose-up" : startupMode === "resume" ? "resume" : "build"

const upProjectMessage = (startupMode: NonNullable<UpProjectOptions["startupMode"]>): string =>
  startupMode === "ssh-open"
    ? "docker compose up -d for SSH terminal"
    : startupMode === "resume"
      ? "docker compose up -d for resume"
      : "docker compose up -d --build"

const upProjectComposeOptions = (startupMode: NonNullable<UpProjectOptions["startupMode"]>) =>
  startupMode === "default"
    ? undefined
    : {
      buildMode: "reuse" as const,
      waitForPostStart: false
    }

const syncContainerAuthorizedKeys = (
  project: ProjectItem
) =>
  Effect.gen(function*(_) {
    const path = yield* _(Path.Path)
    const sourcePath = path.join(project.projectDir, "authorized_keys")

    yield* _(
      runCommandCapture(
        {
          cwd: project.projectDir,
          command: "docker",
          args: [
            "exec",
            project.containerName,
            "sh",
            "-c",
            [
              "set -eu",
              `mkdir -p /home/${project.sshUser}/.docker-git`,
              `mkdir -p /home/${project.sshUser}/.ssh`
            ].join("; ")
          ]
        },
        [0],
        (exitCode) => new CommandFailedError({ command: "docker exec prepare authorized_keys sync", exitCode })
      ).pipe(Effect.asVoid)
    )

    yield* _(
      runCommandCapture(
        {
          cwd: project.projectDir,
          command: "docker",
          args: [
            "cp",
            sourcePath,
            `${project.containerName}:/home/${project.sshUser}/.docker-git/authorized_keys`
          ]
        },
        [0],
        (exitCode) => new CommandFailedError({ command: "docker cp authorized_keys", exitCode })
      ).pipe(Effect.asVoid)
    )

    yield* _(
      runCommandCapture(
        {
          cwd: project.projectDir,
          command: "docker",
          args: [
            "exec",
            project.containerName,
            "sh",
            "-c",
            [
              "set -eu",
              `cp /home/${project.sshUser}/.docker-git/authorized_keys /home/${project.sshUser}/.ssh/authorized_keys`,
              `chown ${project.sshUser}:${project.sshUser} /home/${project.sshUser}/.docker-git/authorized_keys`,
              `chmod 600 /home/${project.sshUser}/.docker-git/authorized_keys`,
              `chown ${project.sshUser}:${project.sshUser} /home/${project.sshUser}/.ssh/authorized_keys`,
              `chmod 600 /home/${project.sshUser}/.ssh/authorized_keys`
            ].join("; ")
          ]
        },
        [0],
        (exitCode) => new CommandFailedError({ command: "docker exec sync authorized_keys", exitCode })
      ).pipe(Effect.asVoid)
    )
  })

export const upProject = (
  projectId: string,
  authorizedKeysContents?: string,
  useManagedAuthorizedKeys?: boolean,
  options: UpProjectOptions = {}
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    const startupMode = options.startupMode ?? "default"
    const resolvedAuthorizedKeysContents = yield* _(
      resolveRequestedAuthorizedKeysContents(authorizedKeysContents, useManagedAuthorizedKeys === true)
    )
    yield* _(seedAuthorizedKeysForCreate(project.projectDir, resolvedAuthorizedKeysContents))
    yield* _(markDeployment(projectId, upProjectPhase(startupMode), upProjectMessage(startupMode)))
    yield* _(runDockerComposeUpWithPortCheck(
      project.projectDir,
      upProjectComposeOptions(startupMode)
    ))
    if ((resolvedAuthorizedKeysContents ?? "").trim().length > 0) {
      yield* _(syncContainerAuthorizedKeys(project))
    }
    yield* _(markDeployment(projectId, "running", "Container running"))
    const details = yield* _(runtimeProjectDetails(project))
    yield* _(recordProjectStartedFromDetails(project, details, "up"))
    return details
  }).pipe(Effect.mapError(toProjectApiError))

export const resumeProject = (
  projectId: string
) =>
  upProject(projectId, undefined, true, { startupMode: "resume" })

export const suspendProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    yield* _(markDeployment(projectId, "suspend", "docker compose stop"))
    yield* _(suspendProjectRuntime(project, "manual"))
    yield* _(markDeployment(projectId, "idle", "Container suspended"))
    return yield* _(getProject(project.projectDir))
  }).pipe(Effect.mapError(toProjectApiError))

export const downProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    yield* _(markDeployment(projectId, "down", "docker compose down"))
    yield* _(runComposeCapture(projectId, project.projectDir, ["down"], [0, 1]))
    yield* _(stopProjectBrowserRuntime(project))
    yield* _(markDeployment(projectId, "idle", "Container stopped"))
    yield* _(recordProjectRuntimeStopped(project.projectDir, "down"))
  }).pipe(Effect.mapError(toProjectApiError))

export const recreateProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    const config = yield* _(readProjectConfig(project.projectDir))

    yield* _(markDeployment(projectId, "recreate", "Recreate started"))

    yield* _(
      createProject({
        _tag: "Create",
        config: config.template,
        outDir: project.projectDir,
        runUp: false,
        openSsh: false,
        force: true,
        forceEnv: false,
        waitForClone: false
      })
    )

    yield* _(runComposeCapture(projectId, project.projectDir, ["down"], [0, 1]))
    yield* _(stopProjectBrowserRuntime(project))
    yield* _(runDockerComposeUpWithPortCheck(project.projectDir))
    const details = yield* _(runtimeProjectDetails(project))
    yield* _(recordProjectStartedFromDetails(project, details, "recreate"))
    yield* _(markDeployment(projectId, "running", "Recreate completed"))
  }).pipe(Effect.mapError(toProjectApiError))

export const readProjectPs = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    return yield* _(runComposeCapture(projectId, project.projectDir, ["ps"], [0]))
  }).pipe(Effect.mapError(toProjectApiError))

export const readProjectLogs = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    return yield* _(runComposeCapture(projectId, project.projectDir, ["logs", "--tail", "200"], [0, 1]))
  }).pipe(Effect.mapError(toProjectApiError))

export const resolveProjectById = findProjectById
export const resolveProjectByKey = findProjectByKey

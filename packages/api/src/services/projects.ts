import {
  type AppError,
  buildCreateCommand,
  createProject,
  formatParseError,
  applyAllDockerGitProjects,
  downAllDockerGitProjects,
  listProjectItems,
  readProjectConfig,
  renderError,
  runDockerComposeUpWithPortCheck
} from "@effect-template/lib"
import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { defaultProjectsRoot, resolvePathFromCwd } from "@effect-template/lib/usecases/path-helpers"
import { deleteDockerGitProject } from "@effect-template/lib/usecases/projects"
import type { RawOptions } from "@effect-template/lib/core/command-options"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect, Either } from "effect"

import type { CreateProjectRequest, ProjectDetails, ProjectStatus, ProjectSummary } from "../api/contracts.js"
import { ApiAuthRequiredError, ApiConflictError, ApiInternalError, ApiNotFoundError, ApiBadRequestError } from "../api/errors.js"
import { ensureGithubAuthForCreate } from "./auth.js"
import { emitProjectEvent } from "./events.js"
import { resolveCreateAuthorizedKeysContents, resolveManagedAuthorizedKeysContents } from "./project-authorized-keys.js"
import { loadProjectRuntimeByProject, runtimeForProject } from "./project-runtime.js"

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
          const trimmed = line.trimEnd()
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
      displayName: project.displayName,
      repoUrl: project.repoUrl,
      repoRef: project.repoRef,
      status: toProjectStatus(rawStatus),
      statusLabel: statusLabelFromPs(rawStatus),
      sshSessions: runtime.sshSessions,
      startedAtIso: runtime.startedAtIso,
      startedAtEpochMs: runtime.startedAtEpochMs,
      clonedOnHostname: project.clonedOnHostname
    }))
  )

const toProjectDetails = (
  project: ProjectItem,
  summary: ProjectSummary
): ProjectDetails => ({
  ...summary,
  containerName: project.containerName,
  serviceName: project.serviceName,
  sshUser: project.sshUser,
  sshPort: project.sshPort,
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

const findProjectById = (projectId: string) =>
  listProjectItems.pipe(
    Effect.flatMap((projects) => {
      const project = projects.find((item) => item.projectDir === projectId)
      return project
        ? Effect.succeed(project)
        : Effect.fail(new ApiNotFoundError({ message: `Project not found: ${projectId}` }))
    })
  )

export const getProjectItemById = (projectId: string) => findProjectById(projectId)

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

export const listProjects = () =>
  listProjectItems.pipe(
    Effect.flatMap((projects) =>
      loadProjectRuntimeByProject(projects).pipe(
        Effect.flatMap((runtimeByProject) =>
          Effect.forEach(
            projects,
            (project) => withProjectRuntime(project, runtimeForProject(runtimeByProject, project)),
            { concurrency: "unbounded" }
          )
        )
      )
    ),
    Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<ProjectSummary>))
  )

export const applyAllProjects = (activeOnly: boolean) =>
  applyAllDockerGitProjects({
    _tag: "ApplyAll",
    activeOnly
  })

export const downAllProjects = () => downAllDockerGitProjects

export const getProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    const runtimeByProject = yield* _(loadProjectRuntimeByProject([project]))
    const summary = yield* _(withProjectRuntime(project, runtimeForProject(runtimeByProject, project)))
    return toProjectDetails(project, summary)
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
    const raw: RawOptions = {
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
      ...(request.dockerNetworkMode === undefined ? {} : { dockerNetworkMode: request.dockerNetworkMode }),
      ...(request.dockerSharedNetworkName === undefined ? {} : { dockerSharedNetworkName: request.dockerSharedNetworkName }),
      ...(request.enableMcpPlaywright === undefined ? {} : { enableMcpPlaywright: request.enableMcpPlaywright }),
      ...(request.outDir === undefined ? {} : { outDir: request.outDir }),
      ...(request.gitTokenLabel === undefined ? {} : { gitTokenLabel: request.gitTokenLabel }),
      ...(request.skipGithubAuth === undefined ? {} : { skipGithubAuth: request.skipGithubAuth }),
      ...(request.codexTokenLabel === undefined ? {} : { codexTokenLabel: request.codexTokenLabel }),
      ...(request.claudeTokenLabel === undefined ? {} : { claudeTokenLabel: request.claudeTokenLabel }),
      ...(request.agentAutoMode === undefined ? {} : { agentAutoMode: request.agentAutoMode }),
      ...(request.up === undefined ? {} : { up: request.up }),
      ...(request.openSsh === undefined ? {} : { openSsh: request.openSsh }),
      ...(request.force === undefined ? {} : { force: request.force }),
      ...(request.forceEnv === undefined ? {} : { forceEnv: request.forceEnv })
    }

    const parsed = buildCreateCommand(raw)
    if (Either.isLeft(parsed)) {
      return yield* _(
        Effect.fail(
          new ApiBadRequestError({
            message: "Invalid create payload.",
            details: formatParseError(parsed.left)
          })
        )
      )
    }

    const command = {
      ...parsed.right,
      openSsh: false,
      waitForClone: request.waitForClone ?? parsed.right.waitForClone
    }

    const resolvedAuthorizedKeysContents = request.authorizedKeysContents ?? (
      request.useManagedAuthorizedKeys === true
        ? yield* _(resolveCreateAuthorizedKeysContents(command.outDir, command.config.authorizedKeysPath))
        : undefined
    )

    yield* _(seedAuthorizedKeysForCreate(command.outDir, resolvedAuthorizedKeysContents))

    yield* _(ensureGithubAuthForCreate(command.config))

    yield* _(
      Effect.sync(() => {
        emitProjectEvent(command.outDir, "project.deployment.status", {
          phase: "create",
          message: "Project creation started"
        })
      })
    )

    yield* _(
      createProject(command).pipe(
        Effect.catchTag("DockerIdentityConflictError", (error) =>
          Effect.fail(new ApiConflictError({ message: renderError(error) }))
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
    const runtimeByProject = yield* _(loadProjectRuntimeByProject([project]))
    const summary = yield* _(withProjectRuntime(project, runtimeForProject(runtimeByProject, project)))

    yield* _(
      Effect.sync(() => {
        emitProjectEvent(project.projectDir, "project.created", {
          projectId: project.projectDir,
          containerName: project.containerName
        })
      })
    )

    return toProjectDetails(project, summary)
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
  useManagedAuthorizedKeys?: boolean
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    const resolvedAuthorizedKeysContents = authorizedKeysContents ?? (
      useManagedAuthorizedKeys === true
        ? yield* _(resolveManagedAuthorizedKeysContents())
        : undefined
    )
    yield* _(seedAuthorizedKeysForCreate(project.projectDir, resolvedAuthorizedKeysContents))
    yield* _(markDeployment(projectId, "build", "docker compose up -d --build"))
    yield* _(runDockerComposeUpWithPortCheck(project.projectDir))
    if ((resolvedAuthorizedKeysContents ?? "").trim().length > 0) {
      yield* _(syncContainerAuthorizedKeys(project))
    }
    yield* _(markDeployment(projectId, "running", "Container running"))
    const runtimeByProject = yield* _(loadProjectRuntimeByProject([project]))
    const summary = yield* _(withProjectRuntime(project, runtimeForProject(runtimeByProject, project)))
    return toProjectDetails(project, summary)
  }).pipe(Effect.mapError(toProjectApiError))

export const downProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    yield* _(markDeployment(projectId, "down", "docker compose down"))
    yield* _(runComposeCapture(projectId, project.projectDir, ["down"], [0, 1]))
    yield* _(markDeployment(projectId, "idle", "Container stopped"))
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
    yield* _(runDockerComposeUpWithPortCheck(project.projectDir))
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

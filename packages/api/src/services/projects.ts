import { buildCreateCommand, createProject, formatParseError, listProjectItems, readProjectConfig } from "@effect-template/lib"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import { deleteDockerGitProject } from "@effect-template/lib/usecases/projects"
import type { RawOptions } from "@effect-template/lib/core/command-options"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect, Either } from "effect"

import type { CreateProjectRequest, ProjectDetails, ProjectStatus, ProjectSummary } from "../api/contracts.js"
import { ApiInternalError, ApiNotFoundError, ApiBadRequestError } from "../api/errors.js"
import { emitProjectEvent } from "./events.js"

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

const withProjectRuntime = (project: ProjectItem) =>
  readComposePsFormatted(project.projectDir).pipe(
    Effect.catchAll(() => Effect.succeed("")),
    Effect.map((rawStatus) => ({
      id: project.projectDir,
      displayName: project.displayName,
      repoUrl: project.repoUrl,
      repoRef: project.repoRef,
      status: toProjectStatus(rawStatus),
      statusLabel: statusLabelFromPs(rawStatus)
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

export const listProjects = () =>
  listProjectItems.pipe(
    Effect.flatMap((projects) => Effect.forEach(projects, withProjectRuntime, { concurrency: "unbounded" })),
    Effect.catchAll(() => Effect.succeed([] as ReadonlyArray<ProjectSummary>))
  )

export const getProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    const summary = yield* _(withProjectRuntime(project))
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
      ...(request.dockerNetworkMode === undefined ? {} : { dockerNetworkMode: request.dockerNetworkMode }),
      ...(request.dockerSharedNetworkName === undefined ? {} : { dockerSharedNetworkName: request.dockerSharedNetworkName }),
      ...(request.enableMcpPlaywright === undefined ? {} : { enableMcpPlaywright: request.enableMcpPlaywright }),
      ...(request.outDir === undefined ? {} : { outDir: request.outDir }),
      ...(request.gitTokenLabel === undefined ? {} : { gitTokenLabel: request.gitTokenLabel }),
      ...(request.codexTokenLabel === undefined ? {} : { codexTokenLabel: request.codexTokenLabel }),
      ...(request.claudeTokenLabel === undefined ? {} : { claudeTokenLabel: request.claudeTokenLabel }),
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
      openSsh: false
    }

    yield* _(
      Effect.sync(() => {
        emitProjectEvent(command.outDir, "project.deployment.status", {
          phase: "create",
          message: "Project creation started"
        })
      })
    )

    yield* _(createProject(command))

    const project = yield* _(
      resolveCreatedProject(
        command.config.containerName,
        command.config.repoUrl,
        command.config.repoRef
      )
    )
    const summary = yield* _(withProjectRuntime(project))

    yield* _(
      Effect.sync(() => {
        emitProjectEvent(project.projectDir, "project.created", {
          projectId: project.projectDir,
          containerName: project.containerName
        })
      })
    )

    return toProjectDetails(project, summary)
  })

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
  })

const markDeployment = (projectId: string, phase: string, message: string) =>
  Effect.sync(() => {
    emitProjectEvent(projectId, "project.deployment.status", { phase, message })
  })

export const upProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    yield* _(markDeployment(projectId, "build", "docker compose up -d --build"))
    yield* _(runComposeCapture(projectId, project.projectDir, ["up", "-d", "--build"]))
    yield* _(markDeployment(projectId, "running", "Container running"))
  })

export const downProject = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    yield* _(markDeployment(projectId, "down", "docker compose down"))
    yield* _(runComposeCapture(projectId, project.projectDir, ["down"], [0, 1]))
    yield* _(markDeployment(projectId, "idle", "Container stopped"))
  })

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
    yield* _(runComposeCapture(projectId, project.projectDir, ["up", "-d", "--build"]))
    yield* _(markDeployment(projectId, "running", "Recreate completed"))
  })

export const readProjectPs = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    return yield* _(runComposeCapture(projectId, project.projectDir, ["ps"], [0]))
  })

export const readProjectLogs = (
  projectId: string
) =>
  Effect.gen(function*(_) {
    const project = yield* _(findProjectById(projectId))
    return yield* _(runComposeCapture(projectId, project.projectDir, ["logs", "--tail", "200"], [0, 1]))
  })

export const resolveProjectById = findProjectById

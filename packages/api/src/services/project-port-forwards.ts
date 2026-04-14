import { ExitCode } from "@effect/platform/CommandExecutor"
import type * as CommandExecutor from "@effect/platform/CommandExecutor"
import type { PlatformError } from "@effect/platform/Error"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { runDockerInspectContainerBridgeIp, runDockerNetworkConnectBridge, runDockerPsPublishedHostPorts } from "@effect-template/lib/shell/docker"
import { CommandFailedError, DockerCommandError } from "@effect-template/lib/shell/errors"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import type { ListProjectsContext } from "@effect-template/lib/usecases/projects-list"
import { Effect } from "effect"

import type { ProjectPortForward, ProjectPortForwardRequest } from "../api/contracts.js"
import { ApiBadRequestError, ApiConflictError, ApiInternalError, ApiNotFoundError } from "../api/errors.js"
import {
  bindHostFromEnv,
  buildForwardSshScript,
  buildPortForwardContainerName,
  parsePortForwardRows,
  portForwardBindHostLabel,
  portForwardHostPortLabel,
  portForwardKindLabel,
  portForwardKindValue,
  portForwardProjectLabel,
  portForwardPublicHostLabel,
  portForwardTargetContainerLabel,
  portForwardTargetPortLabel,
  projectsRootVolumeFromEnv,
  publicHostFromEnv,
  rowsToProjectPortForwards,
  selectHostPort,
  normalizePortForwardRequest
} from "./project-port-forward-core.js"
import { getProjectItemById } from "./projects.js"

type PortForwardApiError =
  | ApiBadRequestError
  | ApiConflictError
  | ApiInternalError
  | ApiNotFoundError

const dockerOkExit = [Number(ExitCode(0))]

const toInternalDockerError = (
  message: string,
  cause: unknown
): ApiInternalError =>
  new ApiInternalError({ message, cause })

const dockerCapture = (
  cwd: string,
  args: ReadonlyArray<string>,
  command: string,
  okExitCodes: ReadonlyArray<number> = dockerOkExit
) =>
  runCommandCapture(
    {
      args,
      command: "docker",
      cwd
    },
    okExitCodes,
    (exitCode) => new CommandFailedError({ command, exitCode })
  )

const inspectProjectContainer = (project: ProjectItem) =>
  dockerCapture(
    project.projectDir,
    ["inspect", "-f", "{{.State.Running}}\t{{.Config.Image}}", project.containerName],
    "docker inspect"
  ).pipe(
    Effect.map((output) => {
      const [running, image] = output.trim().split("\t")
      return { image: image ?? "", running: running === "true" }
    }),
    Effect.mapError((error) =>
      new ApiBadRequestError({
        message: `Project container is not available: ${project.containerName}.`,
        details: error
      })
    )
  )

const ensureProjectBridgeIp = (
  project: ProjectItem
): Effect.Effect<string, PortForwardApiError | DockerCommandError | PlatformError, CommandExecutor.CommandExecutor> =>
  runDockerInspectContainerBridgeIp(project.projectDir, project.containerName).pipe(
    Effect.flatMap((ip) => {
      if (ip.length > 0) {
        return Effect.succeed(ip)
      }
      return runDockerNetworkConnectBridge(project.projectDir, project.containerName).pipe(
        Effect.catchTag("DockerCommandError", () => Effect.void),
        Effect.zipRight(runDockerInspectContainerBridgeIp(project.projectDir, project.containerName))
      )
    }),
    Effect.flatMap((ip) =>
      ip.length > 0
        ? Effect.succeed(ip)
        : Effect.fail(new ApiInternalError({ message: `Container has no bridge IP: ${project.containerName}` }))
    )
  )

const listForwardRows = (projectId: string) =>
  dockerCapture(
    process.cwd(),
    [
      "ps",
      "-a",
      "--filter",
      `label=${portForwardKindLabel}=${portForwardKindValue}`,
      "--filter",
      `label=${portForwardProjectLabel}=${projectId}`,
      "--format",
      [
        "{{.ID}}",
        "{{.Names}}",
        "{{.State}}",
        "{{.CreatedAt}}",
        `{{.Label "${portForwardProjectLabel}"}}`,
        `{{.Label "${portForwardTargetPortLabel}"}}`,
        `{{.Label "${portForwardHostPortLabel}"}}`,
        `{{.Label "${portForwardBindHostLabel}"}}`,
        `{{.Label "${portForwardPublicHostLabel}"}}`,
        `{{.Label "${portForwardTargetContainerLabel}"}}`
      ].join("\\t")
    ],
    "docker ps"
  ).pipe(
    Effect.map(parsePortForwardRows),
    Effect.mapError((error) => toInternalDockerError("Failed to list project port forwards.", error))
  )

export const listProjectPortForwards = (
  projectId: string
): Effect.Effect<ReadonlyArray<ProjectPortForward>, PortForwardApiError | PlatformError, ListProjectsContext> =>
  getProjectItemById(projectId).pipe(
    Effect.zipRight(listForwardRows(projectId)),
    Effect.map(rowsToProjectPortForwards)
  )

const removeForwardContainer = (
  project: ProjectItem,
  containerName: string
) =>
  dockerCapture(
    project.projectDir,
    ["rm", "-f", containerName],
    "docker rm -f",
    [Number(ExitCode(0)), 1]
  ).pipe(
    Effect.asVoid,
    Effect.mapError((error) => toInternalDockerError(`Failed to remove forward container ${containerName}.`, error))
  )

const removeExistingTargetForward = (
  project: ProjectItem,
  forwards: ReadonlyArray<ProjectPortForward>,
  targetPort: number
): Effect.Effect<void, ApiConflictError | ApiInternalError, CommandExecutor.CommandExecutor> => {
  const existing = forwards.find((forward) => forward.targetPort === targetPort)
  if (existing === undefined) {
    return Effect.void
  }
  return existing.status === "running"
    ? Effect.fail(new ApiConflictError({ message: `Port ${targetPort} is already forwarded at ${existing.url}.` }))
    : removeForwardContainer(project, existing.containerName)
}

const chooseHostPort = (
  project: ProjectItem,
  targetPort: number,
  requestedHostPort: number | undefined
) =>
  runDockerPsPublishedHostPorts(project.projectDir).pipe(
    Effect.map((usedPorts) => selectHostPort(targetPort, requestedHostPort, new Set(usedPorts))),
    Effect.flatMap((hostPort) =>
      hostPort === null
        ? Effect.fail(new ApiConflictError({ message: `Host port ${requestedHostPort ?? targetPort} is not available.` }))
        : Effect.succeed(hostPort)
    ),
    Effect.mapError((error) =>
      error instanceof ApiConflictError
        ? error
        : toInternalDockerError("Failed to inspect published Docker ports.", error)
    )
  )

const runForwardContainer = (
  project: ProjectItem,
  image: string,
  targetIp: string,
  targetPort: number,
  hostPort: number,
  publicHostFallback: string | undefined
) => {
  const bindHost = bindHostFromEnv()
  const publicHost = publicHostFromEnv(publicHostFallback)
  const containerName = buildPortForwardContainerName(project.projectDir, targetPort)
  return dockerCapture(
    project.projectDir,
    [
      "run",
      "-d",
      "--name",
      containerName,
      "--label",
      `${portForwardKindLabel}=${portForwardKindValue}`,
      "--label",
      `${portForwardProjectLabel}=${project.projectDir}`,
      "--label",
      `${portForwardTargetPortLabel}=${targetPort}`,
      "--label",
      `${portForwardHostPortLabel}=${hostPort}`,
      "--label",
      `${portForwardBindHostLabel}=${bindHost}`,
      "--label",
      `${portForwardPublicHostLabel}=${publicHost}`,
      "--label",
      `${portForwardTargetContainerLabel}=${project.containerName}`,
      "--network",
      "bridge",
      "--user",
      "root",
      "--publish",
      `${bindHost}:${hostPort}:${targetPort}`,
      "--mount",
      `type=volume,source=${projectsRootVolumeFromEnv()},target=/docker-git-projects,readonly`,
      "--entrypoint",
      "bash",
      image,
      "-lc",
      buildForwardSshScript(targetIp, project.sshUser, targetPort)
    ],
    "docker run"
  ).pipe(
    Effect.asVoid,
    Effect.mapError((error) => toInternalDockerError("Failed to start port forward container.", error))
  )
}

export const createProjectPortForward = (
  projectId: string,
  request: ProjectPortForwardRequest,
  publicHostFallback?: string
): Effect.Effect<ProjectPortForward, PortForwardApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const normalized = normalizePortForwardRequest(request.targetPort, request.hostPort)
    if (!normalized.ok) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: normalized.message })))
    }

    const project = yield* _(getProjectItemById(projectId))
    const inspected = yield* _(inspectProjectContainer(project))
    if (!inspected.running) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: "Project container is not running." })))
    }
    if (inspected.image.length === 0) {
      return yield* _(Effect.fail(new ApiInternalError({ message: "Project container image is unknown." })))
    }

    const currentForwards = yield* _(listProjectPortForwards(projectId))
    const existingForward = currentForwards.find((forward) => forward.targetPort === normalized.ports.targetPort)
    if (existingForward?.status === "running") {
      return existingForward
    }
    yield* _(removeExistingTargetForward(project, currentForwards, normalized.ports.targetPort))
    const hostPort = yield* _(chooseHostPort(project, normalized.ports.targetPort, normalized.ports.hostPort))
    const bridgeIp = yield* _(ensureProjectBridgeIp(project).pipe(
      Effect.mapError((error) =>
        error instanceof ApiInternalError ? error : toInternalDockerError("Failed to resolve project bridge IP.", error)
      )
    ))
    yield* _(runForwardContainer(
      project,
      inspected.image,
      bridgeIp,
      normalized.ports.targetPort,
      hostPort,
      publicHostFallback
    ))

    const forwards = yield* _(listProjectPortForwards(projectId))
    const created = forwards.find((forward) => forward.targetPort === normalized.ports.targetPort)
    return yield* _(
      created === undefined
        ? Effect.fail(new ApiInternalError({ message: "Port forward container started but was not found." }))
        : Effect.succeed(created)
    )
  })

export const deleteProjectPortForward = (
  projectId: string,
  targetPort: number
): Effect.Effect<void, PortForwardApiError | PlatformError, ListProjectsContext> =>
  Effect.gen(function*(_) {
    const normalized = normalizePortForwardRequest(targetPort, undefined)
    if (!normalized.ok) {
      return yield* _(Effect.fail(new ApiBadRequestError({ message: normalized.message })))
    }
    const project = yield* _(getProjectItemById(projectId))
    const forwards = yield* _(listProjectPortForwards(projectId))
    const forward = forwards.find((item) => item.targetPort === normalized.ports.targetPort)
    if (forward === undefined) {
      return yield* _(Effect.fail(new ApiNotFoundError({ message: `Port forward not found: ${normalized.ports.targetPort}` })))
    }
    yield* _(removeForwardContainer(project, forward.containerName))
  })

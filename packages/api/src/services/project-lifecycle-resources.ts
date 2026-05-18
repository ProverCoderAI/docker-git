import {
  readProjectConfig,
  readProjectRuntimeState,
  recordProjectRuntimeResourceProfile,
  recordProjectRuntimeStopped,
  runDockerComposeStop,
  type ProjectRuntimeResourceProfile,
  type ProjectRuntimeStopReason
} from "@effect-template/lib"
import {
  resolveComposeResourceLimits,
  resolvePlaywrightComposeResourceLimits,
  withDefaultResourceLimitIntent
} from "@effect-template/lib/core/resource-limits"
import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { CommandFailedError } from "@effect-template/lib/shell/errors"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect } from "effect"
import os from "node:os"

const minimumThrottledCpu = 0.25

const hostResources = () => ({
  cpuCount: os.availableParallelism(),
  totalMemoryBytes: os.totalmem()
})

const normalizeCpu = (value: number): number => Math.max(minimumThrottledCpu, Math.round(value * 100) / 100)

const throttledCpu = (normalCpu: number, factor: number): number =>
  normalizeCpu(normalCpu * Math.max(0, Math.min(1, factor)))

const browserContainerName = (project: ProjectItem): string => `${project.containerName}-browser`

const updateContainerCpu = (
  project: ProjectItem,
  containerName: string,
  cpus: number
) =>
  runCommandCapture(
    {
      cwd: project.projectDir,
      command: "docker",
      args: ["update", "--cpus", String(cpus), containerName]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: "docker update --cpus", exitCode })
  ).pipe(Effect.asVoid)

const containerExists = (
  project: ProjectItem,
  containerName: string
) =>
  runCommandCapture(
    {
      cwd: project.projectDir,
      command: "docker",
      args: ["inspect", "-f", "{{.Id}}", containerName]
    },
    [0, 1],
    (exitCode) => new CommandFailedError({ command: "docker inspect", exitCode })
  ).pipe(
    Effect.map((output) => output.trim().length > 0),
    Effect.orElseSucceed(() => false)
  )

const stopContainer = (
  project: ProjectItem,
  containerName: string
) =>
  runCommandCapture(
    {
      cwd: project.projectDir,
      command: "docker",
      args: ["stop", containerName]
    },
    [0],
    (exitCode) => new CommandFailedError({ command: "docker stop", exitCode })
  ).pipe(Effect.asVoid)

const applyContainerCpuBestEffort = (
  project: ProjectItem,
  containerName: string,
  cpus: number
) =>
  Effect.gen(function*(_) {
    const exists = yield* _(containerExists(project, containerName))
    if (!exists) {
      return
    }
    yield* _(
      updateContainerCpu(project, containerName, cpus).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            `Failed to update CPU limit for ${containerName}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        )
      )
    )
  })

export const stopProjectBrowserRuntime = (
  project: ProjectItem
) =>
  Effect.gen(function*(_) {
    const containerName = browserContainerName(project)
    const exists = yield* _(containerExists(project, containerName))
    if (!exists) {
      return
    }
    yield* _(
      stopContainer(project, containerName).pipe(
        Effect.catchAll((error) =>
          Effect.logWarning(
            `Failed to stop ${containerName}: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        )
      )
    )
  })

export const suspendProjectRuntime = (
  project: ProjectItem,
  reason: ProjectRuntimeStopReason
) =>
  runDockerComposeStop(project.projectDir).pipe(
    Effect.zipRight(stopProjectBrowserRuntime(project)),
    Effect.zipRight(recordProjectRuntimeStopped(project.projectDir, reason)),
    Effect.asVoid
  )

export const applyProjectResourceProfile = (
  project: ProjectItem,
  profile: ProjectRuntimeResourceProfile,
  throttleFactor: number
) =>
  Effect.gen(function*(_) {
    const current = yield* _(readProjectRuntimeState(project.projectDir))
    if (current.resourceProfile === profile) {
      return
    }

    const config = yield* _(readProjectConfig(project.projectDir))
    const normalized = withDefaultResourceLimitIntent(config.template)
    const resources = hostResources()
    const mainLimits = resolveComposeResourceLimits(normalized, resources)
    const browserLimits = resolvePlaywrightComposeResourceLimits(normalized, resources)
    const mainCpu = profile === "normal"
      ? mainLimits.cpuLimit
      : throttledCpu(mainLimits.cpuLimit, throttleFactor)
    const browserCpu = profile === "normal"
      ? browserLimits.cpuLimit
      : throttledCpu(browserLimits.cpuLimit, throttleFactor)

    yield* _(updateContainerCpu(project, project.containerName, mainCpu))
    yield* _(applyContainerCpuBestEffort(project, browserContainerName(project), browserCpu))
    yield* _(recordProjectRuntimeResourceProfile(project.projectDir, profile))
  })

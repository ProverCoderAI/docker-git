import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { runDockerPsNames } from "@effect-template/lib/shell/docker"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect, pipe } from "effect"

import { CommandFailedError } from "@effect-template/lib/shell/errors"

type ProjectRuntime = {
  readonly running: boolean
  readonly sshSessions: number
  readonly startedAtIso: string | null
  readonly startedAtEpochMs: number | null
}

type LoadProjectRuntimeOptions = {
  readonly includeSshSessions?: boolean
  readonly includeStartedAt?: boolean
}

const emptyRuntimeByProject = (): Readonly<Record<string, ProjectRuntime>> => ({})

export const stoppedProjectRuntime = (): ProjectRuntime => ({
  running: false,
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null
})

const countSshSessionsScript = "who -u 2>/dev/null | wc -l | tr -d '[:space:]'"
const dockerZeroStartedAt = "0001-01-01T00:00:00Z"

type ContainerStartTime = {
  readonly startedAtIso: string
  readonly startedAtEpochMs: number
}

const parseSshSessionCount = (raw: string): number => {
  const parsed = Number.parseInt(raw.trim(), 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0
  }
  return parsed
}

const parseContainerStartedAt = (raw: string): ContainerStartTime | null => {
  const trimmed = raw.trim()
  if (trimmed.length === 0 || trimmed === dockerZeroStartedAt) {
    return null
  }
  const startedAtEpochMs = Date.parse(trimmed)
  if (Number.isNaN(startedAtEpochMs)) {
    return null
  }
  return {
    startedAtIso: trimmed,
    startedAtEpochMs
  }
}

const toRuntimeMap = (
  entries: ReadonlyArray<readonly [string, ProjectRuntime]>
): Readonly<Record<string, ProjectRuntime>> => {
  const runtimeByProject: Record<string, ProjectRuntime> = {}
  for (const [projectDir, runtime] of entries) {
    runtimeByProject[projectDir] = runtime
  }
  return runtimeByProject
}

const countContainerSshSessions = (
  containerName: string
) =>
  pipe(
    runCommandCapture(
      {
        cwd: process.cwd(),
        command: "docker",
        args: ["exec", containerName, "bash", "-lc", countSshSessionsScript]
      },
      [0],
      (exitCode) => new CommandFailedError({ command: "docker exec who -u", exitCode })
    ),
    Effect.match({
      onFailure: () => 0,
      onSuccess: (raw) => parseSshSessionCount(raw)
    })
  )

const inspectContainerStartedAt = (containerName: string) =>
  pipe(
    runCommandCapture(
      {
        cwd: process.cwd(),
        command: "docker",
        args: ["inspect", "--format", "{{.State.StartedAt}}", containerName]
      },
      [0],
      (exitCode) => new CommandFailedError({ command: "docker inspect .State.StartedAt", exitCode })
    ),
    Effect.match({
      onFailure: () => null,
      onSuccess: (raw) => parseContainerStartedAt(raw)
    })
  )

export const loadProjectRuntimeByProject = (
  items: ReadonlyArray<ProjectItem>,
  options: LoadProjectRuntimeOptions = {}
) =>
  pipe(
    runDockerPsNames(process.cwd()),
    Effect.flatMap((runningNames) =>
      Effect.forEach(
        items,
        (item) => {
          const running = runningNames.includes(item.containerName)
          const sshSessionsEffect = running && options.includeSshSessions !== false
            ? countContainerSshSessions(item.containerName)
            : Effect.succeed(0)
          const startedAtEffect = options.includeStartedAt === false
            ? Effect.succeed(null)
            : inspectContainerStartedAt(item.containerName)
          return pipe(
            Effect.all([sshSessionsEffect, startedAtEffect]),
            Effect.map(([sshSessions, startedAt]): ProjectRuntime => ({
              running,
              sshSessions,
              startedAtIso: startedAt?.startedAtIso ?? null,
              startedAtEpochMs: startedAt?.startedAtEpochMs ?? null
            })),
            Effect.map((runtime): readonly [string, ProjectRuntime] => [item.projectDir, runtime])
          )
        },
        { concurrency: 4 }
      )
    ),
    Effect.map((entries) => toRuntimeMap(entries)),
    Effect.match({
      onFailure: () => emptyRuntimeByProject(),
      onSuccess: (runtimeByProject) => runtimeByProject
    })
  )

export const runtimeForProject = (
  runtimeByProject: Readonly<Record<string, ProjectRuntime>>,
  project: ProjectItem
): ProjectRuntime => runtimeByProject[project.projectDir] ?? stoppedProjectRuntime()

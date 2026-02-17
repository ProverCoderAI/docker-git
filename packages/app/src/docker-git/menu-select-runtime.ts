import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { runDockerPsNames } from "@effect-template/lib/shell/docker"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect, pipe } from "effect"

import type { MenuEnv, SelectProjectRuntime, ViewState } from "./menu-types.js"

const emptyRuntimeByProject = (): Readonly<Record<string, SelectProjectRuntime>> => ({})

const stoppedRuntime = (): SelectProjectRuntime => ({
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
  entries: ReadonlyArray<readonly [string, SelectProjectRuntime]>
): Readonly<Record<string, SelectProjectRuntime>> => {
  const runtimeByProject: Record<string, SelectProjectRuntime> = {}
  for (const [projectDir, runtime] of entries) {
    runtimeByProject[projectDir] = runtime
  }
  return runtimeByProject
}

const countContainerSshSessions = (
  containerName: string
): Effect.Effect<number, never, MenuEnv> =>
  pipe(
    runCommandCapture(
      {
        cwd: process.cwd(),
        command: "docker",
        args: ["exec", containerName, "bash", "-lc", countSshSessionsScript]
      },
      [0],
      (exitCode) => ({ _tag: "CommandFailedError", command: "docker exec who -u", exitCode })
    ),
    Effect.match({
      onFailure: () => 0,
      onSuccess: (raw) => parseSshSessionCount(raw)
    })
  )

const inspectContainerStartedAt = (
  containerName: string
): Effect.Effect<ContainerStartTime | null, never, MenuEnv> =>
  pipe(
    runCommandCapture(
      {
        cwd: process.cwd(),
        command: "docker",
        args: ["inspect", "--format", "{{.State.StartedAt}}", containerName]
      },
      [0],
      (exitCode) => ({ _tag: "CommandFailedError", command: "docker inspect .State.StartedAt", exitCode })
    ),
    Effect.match({
      onFailure: () => null,
      onSuccess: (raw) => parseContainerStartedAt(raw)
    })
  )

// CHANGE: enrich select items with runtime state and SSH session counts
// WHY: prevent stopping/deleting containers that are currently used via SSH
// QUOTE(ТЗ): "писать скок SSH подключений к контейнеру сейчас"
// REF: issue-47
// SOURCE: n/a
// FORMAT THEOREM: forall p: runtime(p) -> {running(p), ssh_sessions(p), started_at(p)}
// PURITY: SHELL
// EFFECT: Effect<Record<string, SelectProjectRuntime>, never, MenuEnv>
// INVARIANT: projects without a known container start have startedAt = null
// COMPLEXITY: O(n + docker_ps + docker_exec + docker_inspect)
export const loadRuntimeByProject = (
  items: ReadonlyArray<ProjectItem>
): Effect.Effect<Readonly<Record<string, SelectProjectRuntime>>, never, MenuEnv> =>
  pipe(
    runDockerPsNames(process.cwd()),
    Effect.flatMap((runningNames) =>
      Effect.forEach(
        items,
        (item) => {
          const running = runningNames.includes(item.containerName)
          const sshSessionsEffect = running
            ? countContainerSshSessions(item.containerName)
            : Effect.succeed(0)
          return pipe(
            Effect.all([sshSessionsEffect, inspectContainerStartedAt(item.containerName)]),
            Effect.map(([sshSessions, startedAt]): SelectProjectRuntime => ({
              running,
              sshSessions,
              startedAtIso: startedAt?.startedAtIso ?? null,
              startedAtEpochMs: startedAt?.startedAtEpochMs ?? null
            })),
            Effect.map((runtime): readonly [string, SelectProjectRuntime] => [item.projectDir, runtime])
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

export const runtimeForSelection = (
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  selected: ProjectItem
): SelectProjectRuntime => view.runtimeByProject[selected.projectDir] ?? stoppedRuntime()

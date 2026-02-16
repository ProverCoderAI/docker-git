import { runCommandCapture } from "@effect-template/lib/shell/command-runner"
import { runDockerPsNames } from "@effect-template/lib/shell/docker"
import type { ProjectItem } from "@effect-template/lib/usecases/projects"
import { Effect, pipe } from "effect"

import type { MenuEnv, SelectProjectRuntime, ViewState } from "./menu-types.js"

const emptyRuntimeByProject = (): Readonly<Record<string, SelectProjectRuntime>> => ({})

const stoppedRuntime = (): SelectProjectRuntime => ({ running: false, sshSessions: 0 })

const countSshSessionsScript = "who -u 2>/dev/null | wc -l | tr -d '[:space:]'"

const parseSshSessionCount = (raw: string): number => {
  const parsed = Number.parseInt(raw.trim(), 10)
  if (Number.isNaN(parsed) || parsed < 0) {
    return 0
  }
  return parsed
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
    Effect.map((raw) => parseSshSessionCount(raw)),
    Effect.catchAll(() => Effect.succeed(0))
  )

// CHANGE: enrich select items with runtime state and SSH session counts
// WHY: prevent stopping/deleting containers that are currently used via SSH
// QUOTE(ТЗ): "писать скок SSH подключений к контейнеру сейчас"
// REF: issue-47
// SOURCE: n/a
// FORMAT THEOREM: forall p: runtime(p) -> {running(p), ssh_sessions(p)}
// PURITY: SHELL
// EFFECT: Effect<Record<string, SelectProjectRuntime>, never, MenuEnv>
// INVARIANT: stopped containers always have sshSessions = 0
// COMPLEXITY: O(n + docker_ps + docker_exec)
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
          if (!running) {
            const entry: readonly [string, SelectProjectRuntime] = [item.projectDir, stoppedRuntime()]
            return Effect.succeed(entry)
          }
          return pipe(
            countContainerSshSessions(item.containerName),
            Effect.map((sshSessions): SelectProjectRuntime => ({ running: true, sshSessions })),
            Effect.map((runtime): readonly [string, SelectProjectRuntime] => [item.projectDir, runtime])
          )
        },
        { concurrency: 4 }
      )
    ),
    Effect.map((entries) => toRuntimeMap(entries)),
    Effect.catchAll(() => Effect.succeed(emptyRuntimeByProject()))
  )

export const runtimeForSelection = (
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  selected: ProjectItem
): SelectProjectRuntime => view.runtimeByProject[selected.projectDir] ?? stoppedRuntime()

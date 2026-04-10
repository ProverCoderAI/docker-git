import { Effect } from "effect"

import type { MenuEnv, SelectProjectRuntime, ViewState } from "./menu-types.js"
import type { ProjectItem } from "./project-item.js"

const stoppedRuntime = (): SelectProjectRuntime => ({
  running: false,
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null
})

const toRuntimeMap = (
  entries: ReadonlyArray<readonly [string, SelectProjectRuntime]>
): Readonly<Record<string, SelectProjectRuntime>> => {
  const runtimeByProject: Record<string, SelectProjectRuntime> = {}
  for (const [projectDir, runtime] of entries) {
    runtimeByProject[projectDir] = runtime
  }
  return runtimeByProject
}

// CHANGE: enrich select items with runtime state and SSH session counts
// WHY: prevent stopping/deleting containers that are currently used via SSH
// QUOTE(ТЗ): "писать скок SSH подключений к контейнеру сейчас"
// REF: issue-47
// SOURCE: n/a
// FORMAT THEOREM: forall p: api_runtime(p) -> {running(p), ssh_sessions(p), started_at(p)}
// PURITY: CORE
// EFFECT: Effect<Record<string, SelectProjectRuntime>, never, MenuEnv>
// INVARIANT: runtime map is derived only from API payload already loaded for the view
// COMPLEXITY: O(n)
export const loadRuntimeByProject = (
  items: ReadonlyArray<ProjectItem>
): Effect.Effect<Readonly<Record<string, SelectProjectRuntime>>, never, MenuEnv> =>
  Effect.succeed(
    toRuntimeMap(
      items.map((item): readonly [string, SelectProjectRuntime] => [
        item.projectDir,
        {
          running: item.status === "running",
          sshSessions: item.sshSessions,
          startedAtIso: item.startedAtIso,
          startedAtEpochMs: item.startedAtEpochMs
        }
      ])
    )
  )

export const runtimeForSelection = (
  view: Extract<ViewState, { readonly _tag: "SelectProject" }>,
  selected: ProjectItem
): SelectProjectRuntime => view.runtimeByProject[selected.projectDir] ?? stoppedRuntime()

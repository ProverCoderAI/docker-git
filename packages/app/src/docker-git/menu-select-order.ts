import type { ProjectItem } from "./project-item.js"

import type { SelectProjectRuntime } from "./menu-types.js"

const defaultRuntime = (): SelectProjectRuntime => ({
  running: false,
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null
})

const startedAtEpochForSort = (runtime: SelectProjectRuntime): number => runtime.startedAtEpochMs ?? -Infinity

type SelectOrderAccessors<A> = {
  readonly displayName: (item: A) => string
  readonly projectKey: (item: A) => string
}

const runtimeForKey = (
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>,
  projectKey: string
): SelectProjectRuntime => runtimeByProject[projectKey] ?? defaultRuntime()

// CHANGE: make CLI and WEB select order share one pure comparator
// WHY: `/select/` must present projects in the same order as the TUI select view
// QUOTE(ТЗ): "мы можем иметь 1 в 1 логику что в CLI что на WEB?"
// REF: user-message-2026-04-21-unify-cli-web-select
// SOURCE: n/a
// FORMAT THEOREM: forall xs: sort_web(xs) = sort_cli(xs) when accessors identify the same project/runtime fields
// PURITY: CORE
// EFFECT: none
// INVARIANT: newer launch timestamps sort first; missing timestamps sort last
// COMPLEXITY: O(n log n)
export const sortSelectItemsByLaunchTime = <A>(
  items: ReadonlyArray<A>,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>,
  accessors: SelectOrderAccessors<A>
): ReadonlyArray<A> =>
  items.toSorted((left, right) => {
    const leftKey = accessors.projectKey(left)
    const rightKey = accessors.projectKey(right)
    const leftRuntime = runtimeForKey(runtimeByProject, leftKey)
    const rightRuntime = runtimeForKey(runtimeByProject, rightKey)
    const leftStartedAt = startedAtEpochForSort(leftRuntime)
    const rightStartedAt = startedAtEpochForSort(rightRuntime)

    if (leftStartedAt !== rightStartedAt) {
      return rightStartedAt - leftStartedAt
    }
    if (leftRuntime.running !== rightRuntime.running) {
      return leftRuntime.running ? -1 : 1
    }

    const displayNameOrder = accessors.displayName(left).localeCompare(accessors.displayName(right))
    return displayNameOrder === 0 ? leftKey.localeCompare(rightKey) : displayNameOrder
  })

export const sortItemsByLaunchTime = (
  items: ReadonlyArray<ProjectItem>,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
): ReadonlyArray<ProjectItem> =>
  sortSelectItemsByLaunchTime(items, runtimeByProject, {
    displayName: (item) => item.displayName,
    projectKey: (item) => item.projectDir
  })

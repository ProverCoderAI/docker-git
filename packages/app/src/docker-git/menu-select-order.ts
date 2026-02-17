import type { ProjectItem } from "@effect-template/lib/usecases/projects"

import type { SelectProjectRuntime } from "./menu-types.js"

const defaultRuntime = (): SelectProjectRuntime => ({
  running: false,
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null
})

const runtimeForSort = (
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>,
  item: ProjectItem
): SelectProjectRuntime => runtimeByProject[item.projectDir] ?? defaultRuntime()

const startedAtEpochForSort = (runtime: SelectProjectRuntime): number =>
  runtime.startedAtEpochMs ?? Number.NEGATIVE_INFINITY

export const sortItemsByLaunchTime = (
  items: ReadonlyArray<ProjectItem>,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>>
): ReadonlyArray<ProjectItem> =>
  items.toSorted((left, right) => {
    const leftRuntime = runtimeForSort(runtimeByProject, left)
    const rightRuntime = runtimeForSort(runtimeByProject, right)
    const leftStartedAt = startedAtEpochForSort(leftRuntime)
    const rightStartedAt = startedAtEpochForSort(rightRuntime)

    if (leftStartedAt !== rightStartedAt) {
      return rightStartedAt - leftStartedAt
    }
    if (leftRuntime.running !== rightRuntime.running) {
      return leftRuntime.running ? -1 : 1
    }
    return left.displayName.localeCompare(right.displayName)
  })

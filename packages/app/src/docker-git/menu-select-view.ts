import type { ProjectItem } from "@effect-template/lib/usecases/projects"

import { sortItemsByLaunchTime } from "./menu-select-order.js"
import type { MenuViewContext, SelectProjectRuntime } from "./menu-types.js"

const emptyRuntimeByProject = (): Readonly<Record<string, SelectProjectRuntime>> => ({})

export const startSelectView = (
  items: ReadonlyArray<ProjectItem>,
  purpose: "Connect" | "Down" | "Info" | "Delete" | "Auth",
  context: Pick<MenuViewContext, "setView" | "setMessage">,
  runtimeByProject: Readonly<Record<string, SelectProjectRuntime>> = emptyRuntimeByProject()
) => {
  const sortedItems = sortItemsByLaunchTime(items, runtimeByProject)
  context.setMessage(null)
  context.setView({
    _tag: "SelectProject",
    purpose,
    items: sortedItems,
    runtimeByProject,
    selected: 0,
    confirmDelete: false,
    connectEnableMcpPlaywright: false
  })
}

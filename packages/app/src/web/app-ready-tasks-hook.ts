import { useEffect, useState } from "react"

import { loadSelectedProjectTasks } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { ContainerTaskSnapshot } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

type TasksPanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
}

export const useProjectTasksState = () => {
  const [projectTasks, setProjectTasks] = useState<ContainerTaskSnapshot | null>(null)
  const [projectTaskLogs, setProjectTaskLogs] = useState("")
  const [isProjectTasksIncludeDefault, setProjectTasksIncludeDefault] = useState(false)

  return {
    projectTaskLogs,
    projectTasks,
    projectTasksIncludeDefault: isProjectTasksIncludeDefault,
    setProjectTaskLogs,
    setProjectTasks,
    setProjectTasksIncludeDefault
  }
}

export const useProjectTasksReset = (
  selectedProjectId: string | null,
  setProjectTaskLogs: (value: string) => void,
  setProjectTasks: (value: ContainerTaskSnapshot | null) => void,
  setProjectTasksIncludeDefault: (shouldIncludeDefault: boolean) => void
) => {
  useEffect(() => {
    setProjectTaskLogs("")
    setProjectTasks(null)
    setProjectTasksIncludeDefault(false)
  }, [selectedProjectId, setProjectTaskLogs, setProjectTasks, setProjectTasksIncludeDefault])
}

export const maybeLoadProjectTasks = (
  { activeScreen, context, currentMenu, selectedProjectId }: TasksPanelAutoloadArgs
): void => {
  if (activeScreen.tag === "ProjectPicker" && currentMenu === "Tasks" && selectedProjectId !== null) {
    loadSelectedProjectTasks(context, { silent: true })
  }
}

import {
  loadSelectedProjectTaskLogs,
  loadSelectedProjectTasks,
  setSelectedProjectTasksIncludeDefault,
  stopSelectedProjectTask
} from "./actions.js"
import type { createActionContext } from "./app-ready-actions.js"

export const bindTaskActions = (
  actionContext: ReturnType<typeof createActionContext>
) => ({
  onLoadProjectTaskLogs: (pid: number) => {
    loadSelectedProjectTaskLogs(actionContext, pid)
  },
  onRefreshProjectTasks: () => {
    loadSelectedProjectTasks(actionContext)
  },
  onProjectTasksIncludeDefaultChange: (includeDefault: boolean) => {
    setSelectedProjectTasksIncludeDefault(actionContext, includeDefault)
  },
  onStopProjectTask: (pid: number) => {
    stopSelectedProjectTask(actionContext, pid)
  }
})

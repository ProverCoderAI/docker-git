import { loadSelectedProjectTaskLogs, loadSelectedProjectTasks, stopSelectedProjectTask } from "./actions.js"
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
  onStopProjectTask: (pid: number) => {
    stopSelectedProjectTask(actionContext, pid)
  }
})

import { type BrowserActionContext, requireSelectedProjectId, withBusy } from "./actions-shared.js"
import { loadProjectTaskLogs, loadProjectTasks, stopProjectTask } from "./api.js"

const requireProjectIdForTasks = (context: BrowserActionContext): string | null => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setProjectTasks(null)
    context.setProjectTaskLogs("")
  }
  return projectId
}

export const loadSelectedProjectTasks = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  const projectId = requireProjectIdForTasks(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: loadProjectTasks(projectId),
    label: "Loading container tasks",
    onSuccess: (snapshot) => {
      context.setProjectTasks(snapshot)
      if (options?.silent !== true) {
        context.setMessage(`Loaded ${snapshot.tasks.length} container task(s).`)
      }
    }
  })
}

export const stopSelectedProjectTask = (
  context: BrowserActionContext,
  pid: number
) => {
  const projectId = requireProjectIdForTasks(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: stopProjectTask(projectId, pid),
    label: "Stopping container task",
    onSuccess: () => {
      context.setProjectTasks((snapshot) =>
        snapshot === null
          ? null
          : {
            ...snapshot,
            tasks: snapshot.tasks.filter((task) => task.pid !== pid)
          }
      )
      context.setMessage(`Sent SIGTERM to PID ${pid}.`)
    }
  })
}

export const loadSelectedProjectTaskLogs = (
  context: BrowserActionContext,
  pid: number
) => {
  const projectId = requireProjectIdForTasks(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: loadProjectTaskLogs(projectId, pid, 200),
    label: "Loading task logs",
    onSuccess: (output) => {
      context.setProjectTaskLogs(output)
      context.setMessage(`Loaded logs for PID ${pid}.`)
    }
  })
}

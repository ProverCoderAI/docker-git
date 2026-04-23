import type { Effect } from "effect"

import { type BrowserActionContext, requireSelectedProjectId, withBusy } from "./actions-shared.js"
import { loadProjectTaskLogs, loadProjectTasks, stopProjectTask } from "./api.js"
import type { ContainerTaskSnapshot } from "./api.js"

const requireProjectIdForTasks = (context: BrowserActionContext): string | null => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setProjectTasks(null)
    context.setProjectTaskLogs("")
  }
  return projectId
}

type SelectedProjectTaskAction = {
  readonly context: BrowserActionContext
  readonly pid: number
  readonly projectId: string
}

type SelectedProjectTaskBusyAction<A> = {
  readonly context: BrowserActionContext
  readonly effect: (selected: SelectedProjectTaskAction) => Effect.Effect<A, string>
  readonly label: string
  readonly onSuccess: (selected: SelectedProjectTaskAction, value: A) => void
  readonly pid: number
}

const withSelectedProjectTask = (
  context: BrowserActionContext,
  pid: number,
  action: (selected: SelectedProjectTaskAction) => void
): void => {
  const projectId = requireProjectIdForTasks(context)
  if (projectId !== null) {
    action({ context, pid, projectId })
  }
}

const withSelectedProjectTaskBusy = <A>(
  { context, effect, label, onSuccess, pid }: SelectedProjectTaskBusyAction<A>
): void => {
  withSelectedProjectTask(context, pid, (selected) => {
    withBusy({
      context: selected.context,
      effect: effect(selected),
      label,
      onSuccess: (value) => {
        onSuccess(selected, value)
      }
    })
  })
}

const removeTaskFromSnapshot = (
  snapshot: ContainerTaskSnapshot | null,
  pid: number
): ContainerTaskSnapshot | null =>
  snapshot === null
    ? null
    : {
      ...snapshot,
      tasks: snapshot.tasks.filter((task) => task.pid !== pid)
    }

const stopSelectedProjectTaskEffect = (
  selected: SelectedProjectTaskAction
): Effect.Effect<void, string> => stopProjectTask(selected.projectId, selected.pid)

const loadSelectedProjectTaskLogsEffect = (
  selected: SelectedProjectTaskAction
): Effect.Effect<string, string> => loadProjectTaskLogs(selected.projectId, selected.pid, 200)

const applyStoppedProjectTask = (
  selected: SelectedProjectTaskAction
): void => {
  selected.context.setProjectTasks((snapshot) => removeTaskFromSnapshot(snapshot, selected.pid))
  selected.context.setMessage(`Sent SIGTERM to PID ${selected.pid}.`)
}

const applyLoadedProjectTaskLogs = (
  selected: SelectedProjectTaskAction,
  output: string
): void => {
  selected.context.setProjectTaskLogs(output)
  selected.context.setMessage(`Loaded logs for PID ${selected.pid}.`)
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
  withSelectedProjectTaskBusy({
    context,
    effect: stopSelectedProjectTaskEffect,
    label: "Stopping container task",
    onSuccess: applyStoppedProjectTask,
    pid
  })
}

export const loadSelectedProjectTaskLogs = (
  context: BrowserActionContext,
  pid: number
) => {
  withSelectedProjectTaskBusy({
    context,
    effect: loadSelectedProjectTaskLogsEffect,
    label: "Loading task logs",
    onSuccess: applyLoadedProjectTaskLogs,
    pid
  })
}

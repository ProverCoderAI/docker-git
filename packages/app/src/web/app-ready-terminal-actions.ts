import { withBusy } from "./actions-shared.js"
import {
  applyProjectById,
  applySelectedProject,
  attachProjectTerminalById,
  connectProjectById,
  loadProjectTasksById,
  runApplyAllProjects
} from "./actions.js"
import { deleteProjectTerminalSession } from "./api.js"
import type { createActionContext } from "./app-ready-actions.js"
import type { ReadyState } from "./app-ready-hooks.js"
import { browserMenuIndex } from "./menu.js"

type TerminalTaskManagerState = Pick<
  ReadyState,
  | "setProjectTaskLogs"
  | "setProjectTasks"
  | "setProjectTasksIncludeDefault"
  | "setSelectedMenuIndex"
  | "setSelectedProjectId"
>

export const openTerminalTaskManager = (
  actionContext: ReturnType<typeof createActionContext>,
  state: TerminalTaskManagerState,
  projectId: string
): void => {
  state.setSelectedProjectId(projectId)
  state.setSelectedMenuIndex(browserMenuIndex("Tasks"))
  state.setProjectTasks(null)
  state.setProjectTaskLogs("")
  state.setProjectTasksIncludeDefault(false)
  loadProjectTasksById(actionContext, projectId, { includeDefault: false })
}

export const bindTerminalActions = (
  actionContext: ReturnType<typeof createActionContext>,
  state: ReadyState
) => ({
  onApplyProjectById: (projectId: string, gpu?: "none" | "all") => {
    applyProjectById(projectId, actionContext, gpu)
  },
  onApplySelectedProject: (gpu?: "none" | "all") => {
    applySelectedProject(actionContext, gpu)
  },
  onApplyAllProjects: () => {
    runApplyAllProjects(actionContext)
  },
  onOpenProjectTerminalById: (projectId: string, projectKey?: string) => {
    connectProjectById(projectId, actionContext, projectKey)
  },
  onOpenProjectTaskManagerById: (projectId: string) => {
    openTerminalTaskManager(actionContext, state, projectId)
  },
  onAttachProjectTerminalSession: (
    projectId: string,
    projectKey: string,
    projectDisplayName: string,
    sessionId: string
  ) => {
    attachProjectTerminalById(projectId, projectKey, projectDisplayName, sessionId, actionContext)
  },
  onKillProjectTerminalSession: (_projectId: string, projectKey: string, sessionId: string) => {
    withBusy({
      context: actionContext,
      effect: deleteProjectTerminalSession(projectKey, sessionId),
      label: "Killing SSH terminal",
      onSuccess: () => {
        state.closeTerminalSession(sessionId)
        actionContext.reloadDashboard()
        actionContext.setMessage(`Killed SSH terminal: ${sessionId}.`)
      }
    })
  }
})

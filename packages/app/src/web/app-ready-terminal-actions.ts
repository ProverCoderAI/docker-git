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
import { projectPickerScreen } from "./screen.js"

export const bindTerminalActions = (
  actionContext: ReturnType<typeof createActionContext>,
  state: ReadyState
) => ({
  onApplyProjectById: (projectId: string) => {
    applyProjectById(projectId, actionContext)
  },
  onApplySelectedProject: () => {
    applySelectedProject(actionContext)
  },
  onApplyAllProjects: () => {
    runApplyAllProjects(actionContext)
  },
  onOpenProjectTerminalById: (projectId: string, projectKey?: string) => {
    connectProjectById(projectId, actionContext, projectKey)
  },
  onOpenProjectTaskManagerById: (projectId: string) => {
    state.setSelectedProjectId(projectId)
    state.setSelectedMenuIndex(browserMenuIndex("Tasks"))
    state.setProjectNavigationArmed(true)
    state.setActiveScreen(projectPickerScreen())
    state.deactivateTerminalWorkspace()
    state.setProjectTasks(null)
    state.setProjectTaskLogs("")
    state.setProjectTasksIncludeDefault(false)
    loadProjectTasksById(actionContext, projectId, { includeDefault: false })
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

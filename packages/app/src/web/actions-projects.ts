import { createProjectDraftFromInputs } from "../docker-git/menu-create-shared.js"
import type { CreateInputs } from "../docker-git/menu-types.js"
import {
  type BrowserActionContext,
  confirmAction,
  projectActionLabel,
  requireSelectedProjectId,
  withBusy
} from "./actions-shared.js"
import {
  createProject,
  createProjectTerminalSession,
  deleteProject,
  downAllProjects,
  downProject,
  loadProjectDetails,
  loadProjectLogs,
  loadProjectPs
} from "./api.js"
import type { BrowserMenuTag } from "./menu.js"

export const loadSelectedProjectInfo = (
  context: BrowserActionContext,
  options?: {
    readonly silent?: boolean
  }
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setSelectedProject(null)
    return
  }
  withBusy({
    context,
    effect: loadProjectDetails(projectId),
    label: "Loading project info",
    onSuccess: (project) => {
      context.setSelectedProject(project)
      if (options?.silent !== true) {
        context.setMessage(`Loaded ${project.displayName}.`)
      }
    }
  })
}

export const submitCreateInputs = (
  inputs: CreateInputs,
  context: BrowserActionContext
) => {
  withBusy({
    context,
    effect: createProject(createProjectDraftFromInputs(inputs)),
    label: "Creating project",
    onSuccess: (project) => {
      context.reloadDashboard()
      context.setOutput("")
      context.setProjectAuthSnapshot(null)
      context.setSelectedMenuIndex(1)
      context.setSelectedProject(project)
      context.setSelectedProjectId(project.id)
      context.setMessage(`Created ${project.displayName}.`)
    }
  })
}

export const connectSelectedProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: createProjectTerminalSession(projectId),
    label: "Opening SSH terminal",
    onSuccess: ({ project, session }) => {
      context.reloadDashboard()
      context.setSelectedProject(project)
      context.setOutput(session.sshCommand)
      const encodedProjectId = encodeURIComponent(project.id)
      const encodedSessionId = encodeURIComponent(session.id)
      context.setTerminalSession({
        closePath: `/projects/${encodedProjectId}/terminal-sessions/${encodedSessionId}`,
        exitMessage: "SSH session ended.",
        header: `SSH terminal: ${project.displayName}`,
        onExit: context.reloadDashboard,
        onReady: context.reloadDashboard,
        pendingDeleteMessage: `Terminal session was closed before attach: ${project.displayName}.`,
        readyMessage: `SSH connected: ${project.displayName}.`,
        session,
        subtitle: session.sshCommand,
        websocketPath: `/projects/${encodedProjectId}/terminal-sessions/${encodedSessionId}/ws`
      })
      context.setMessage(`Project is ready. SSH terminal is connecting for ${project.displayName}.`)
    }
  })
}

const runProjectOutputAction = (
  context: BrowserActionContext,
  effect: (projectId: string) => ReturnType<typeof loadProjectPs>,
  label: string,
  successMessage: string
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  withBusy({
    context,
    effect: effect(projectId),
    label,
    onSuccess: (output) => {
      context.setOutput(output)
      context.setMessage(successMessage)
    }
  })
}

const runDownProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null || !confirmAction(`Stop ${projectActionLabel(context)}?`)) {
    return
  }
  withBusy({
    context,
    effect: downProject(projectId),
    label: "Stopping project",
    onSuccess: () => {
      context.reloadDashboard()
      context.setMessage("Project stopped.")
    }
  })
}

const runDeleteProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null || !confirmAction(`Delete ${projectActionLabel(context)}?`)) {
    return
  }
  withBusy({
    context,
    effect: deleteProject(projectId),
    label: "Deleting project",
    onSuccess: () => {
      context.reloadDashboard()
      context.setOutput("")
      context.setProjectAuthSnapshot(null)
      context.setSelectedProject(null)
      context.setSelectedProjectId(null)
      context.setMessage("Project deleted.")
    }
  })
}

const runDownAllProjects = (context: BrowserActionContext) => {
  if (!confirmAction("Stop all docker-git projects?")) {
    return
  }
  withBusy({
    context,
    effect: downAllProjects(),
    label: "Stopping all projects",
    onSuccess: () => {
      context.reloadDashboard()
      context.setMessage("All projects were asked to stop.")
    }
  })
}

export const runProjectMenuAction = (
  currentMenu: Exclude<BrowserMenuTag, "Auth" | "ProjectAuth">,
  context: BrowserActionContext
) => {
  if (currentMenu === "Create") {
    context.setMessage("Create mode is active. Paste URL, Enter = quick create, Shift+Enter = advanced.")
    return
  }
  if (currentMenu === "Select") {
    connectSelectedProject(context)
    return
  }
  if (currentMenu === "Info") {
    loadSelectedProjectInfo(context)
    return
  }
  runProjectMenuCommand(currentMenu, context)
}

const runProjectMenuCommand = (
  currentMenu: Exclude<BrowserMenuTag, "Auth" | "ProjectAuth" | "Create" | "Select" | "Info">,
  context: BrowserActionContext
) => {
  if (currentMenu === "Status") {
    runProjectOutputAction(context, loadProjectPs, "Loading docker compose ps", "docker compose ps loaded.")
    return
  }
  if (currentMenu === "Logs") {
    runProjectOutputAction(context, loadProjectLogs, "Loading logs", "Logs loaded.")
    return
  }
  if (currentMenu === "Down") {
    runDownProject(context)
    return
  }
  if (currentMenu === "DownAll") {
    runDownAllProjects(context)
    return
  }
  if (currentMenu === "Delete") {
    runDeleteProject(context)
    return
  }
  globalThis.close()
  context.setMessage("Quit requested. If the browser blocked window.close(), close the tab manually.")
}

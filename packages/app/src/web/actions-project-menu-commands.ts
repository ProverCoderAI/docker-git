import {
  type BrowserActionContext,
  confirmAction,
  projectActionLabel,
  requireSelectedProjectId,
  withBusy
} from "./actions-shared.js"
import { applyAllProjects, deleteProject, downAllProjects, downProject, loadProjectLogs, loadProjectPs } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import { outputScreen } from "./screen.js"

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
      context.setActiveScreen(outputScreen())
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

export const runApplyAllProjects = (context: BrowserActionContext) => {
  if (!confirmAction("Apply docker-git config to all projects?")) {
    return
  }
  withBusy({
    context,
    effect: applyAllProjects(false),
    label: "Applying all projects",
    onSuccess: () => {
      context.reloadDashboard()
      context.setMessage("Applied docker-git config to all projects.")
    }
  })
}

export const runProjectMenuCommand = (
  currentMenu: Exclude<
    BrowserMenuTag,
    | "Auth"
    | "ProjectAuth"
    | "Browser"
    | "Create"
    | "Databases"
    | "Select"
    | "Info"
    | "Ports"
    | "Prompts"
    | "Share"
    | "Skills"
    | "Tasks"
  >,
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

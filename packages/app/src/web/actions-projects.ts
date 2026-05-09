import { openSelectedProjectBrowser } from "./actions-browser.js"
import { openSelectedProjectDatabaseEditor } from "./actions-databases.js"
import { appendOutputLine, appendOutputLineHandler, notifyProjectEventRateLimit } from "./actions-output.js"
import { openSelectedProjectPort } from "./actions-port-forwards.js"
import { loadSelectedProjectPrompts } from "./actions-prompts.js"
import {
  type BrowserActionContext,
  confirmAction,
  projectActionLabel,
  requireSelectedProjectId,
  requireSelectedProjectKey,
  withBusy,
  withSelectedProjectBusy
} from "./actions-shared.js"
import { loadSelectedProjectSkills } from "./actions-skills.js"
import { loadSelectedProjectTasks } from "./actions-tasks.js"
import {
  applyAllProjects,
  applyProject,
  createProjectTerminalSession,
  deleteProject,
  downAllProjects,
  downProject,
  loadProjectDetails,
  loadProjectLogs,
  loadProjectPs,
  loadProjectTerminalSession
} from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import { openProjectEventStream } from "./project-events.js"
import { outputScreen } from "./screen.js"
import { buildProjectActiveTerminalSession } from "./terminal.js"

export { submitCreateInputs } from "./actions-project-create.js"

export const loadSelectedProjectInfo = (
  context: BrowserActionContext,
  options?: {
    readonly silent?: boolean
  }
) => {
  withSelectedProjectBusy({
    context,
    effect: loadProjectDetails,
    label: "Loading project info",
    onMissing: () => {
      context.setSelectedProject(null)
    },
    onSuccess: (project) => {
      context.setSelectedProject(project)
      if (options?.silent !== true) {
        context.setMessage(`Loaded ${project.displayName}.`)
      }
    }
  })
}

export const connectSelectedProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  const projectKey = requireSelectedProjectKey(context)
  if (projectId === null || projectKey === null) {
    return
  }
  connectProjectById(projectId, context, projectKey)
}

const resolveProjectTerminalKey = (
  projectId: string,
  context: BrowserActionContext,
  projectKey?: string
): string | null => {
  if (projectKey !== undefined && projectKey.trim().length > 0) {
    return projectKey
  }
  if (context.selectedProjectId === projectId && context.selectedProjectKey !== null) {
    return context.selectedProjectKey
  }
  context.setMessage(`Project key is missing for ${projectId}.`)
  return null
}

export const connectProjectById = (
  projectId: string,
  context: BrowserActionContext,
  projectKey?: string
) => {
  const resolvedProjectKey = resolveProjectTerminalKey(projectId, context, projectKey)
  if (resolvedProjectKey === null) {
    return
  }
  context.setSelectedProjectId(projectId)
  context.setOutput("")
  appendOutputLine(context, "[ssh.prepare] Preparing SSH session")
  const stream = openProjectEventStream(projectId, {
    onLine: appendOutputLineHandler(context),
    onRateLimit: () => {
      notifyProjectEventRateLimit(context)
    }
  })
  withBusy({
    context,
    effect: createProjectTerminalSession(resolvedProjectKey),
    label: "Opening SSH terminal",
    onFailure: (error) => {
      appendOutputLine(context, `[error] ${error}`)
    },
    onFinally: () => {
      stream.close()
    },
    onSuccess: ({ project, session }) => {
      context.reloadDashboard()
      context.setSelectedProject(project)
      appendOutputLine(context, `SSH command: ${session.sshCommand}`)
      context.addTerminalSession(buildProjectActiveTerminalSession({
        onExit: context.reloadDashboard,
        onReady: context.reloadDashboard,
        projectDisplayName: project.displayName,
        projectId: project.id,
        projectKey: project.projectKey,
        session
      }))
      context.setMessage(`Project is ready. SSH terminal is connecting for ${project.displayName}.`)
    }
  })
}

export const applyProjectById = (
  projectId: string,
  context: BrowserActionContext
) => {
  context.setSelectedProjectId(projectId)
  withBusy({
    context,
    effect: applyProject(projectId),
    label: "Applying project",
    onSuccess: (project) => {
      context.reloadDashboard()
      context.setSelectedProject(project)
      context.setMessage(`Applied ${project.displayName}.`)
    }
  })
}

export const applySelectedProject = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  applyProjectById(projectId, context)
}

export const attachProjectTerminalById = (
  projectId: string,
  projectKey: string,
  projectDisplayName: string,
  sessionId: string,
  context: BrowserActionContext
) => {
  const resolvedProjectKey = resolveProjectTerminalKey(projectId, context, projectKey)
  if (resolvedProjectKey === null) {
    return
  }
  context.setSelectedProjectId(projectId)
  withBusy({
    context,
    effect: loadProjectTerminalSession(resolvedProjectKey, sessionId),
    label: "Attaching SSH terminal",
    onSuccess: (session) => {
      context.addTerminalSession(buildProjectActiveTerminalSession({
        onExit: context.reloadDashboard,
        onReady: context.reloadDashboard,
        projectDisplayName,
        projectId,
        projectKey: resolvedProjectKey,
        session
      }))
      context.setMessage(`Attached SSH terminal for ${projectDisplayName}.`)
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

export const runProjectMenuAction = (
  currentMenu: Exclude<BrowserMenuTag, "Auth" | "ProjectAuth">,
  context: BrowserActionContext
) => {
  if (currentMenu === "Create") {
    context.setMessage("Create mode is active. Paste URL or URL + flags, Enter = next, Shift+Enter = quick create.")
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
  if (currentMenu === "Ports") {
    openSelectedProjectPort(context)
    return
  }
  if (currentMenu === "Databases") {
    openSelectedProjectDatabaseEditor(context)
    return
  }
  if (currentMenu === "Browser") {
    openSelectedProjectBrowser(context)
    return
  }
  if (currentMenu === "Tasks") {
    loadSelectedProjectTasks(context)
    return
  }
  if (currentMenu === "Prompts") {
    loadSelectedProjectPrompts(context)
    return
  }
  if (currentMenu === "Skills") {
    loadSelectedProjectSkills(context)
    return
  }
  runProjectMenuCommand(currentMenu, context)
}

const runProjectMenuCommand = (
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

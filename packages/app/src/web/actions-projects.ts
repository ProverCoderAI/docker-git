import { openSelectedProjectBrowser } from "./actions-browser.js"
import { openSelectedProjectDatabaseEditor } from "./actions-databases.js"
import { openSelectedProjectPort } from "./actions-port-forwards.js"
import { runProjectMenuCommand } from "./actions-project-menu-commands.js"
import { connectProjectById } from "./actions-project-terminal.js"
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
import { applyProject, loadProjectDetails } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"

export { submitCreateInputs } from "./actions-project-create.js"
export { runApplyAllProjects } from "./actions-project-menu-commands.js"
export { attachProjectTerminalById, connectProjectById } from "./actions-project-terminal.js"

type ProjectMenuActionTag = Exclude<BrowserMenuTag, "Auth" | "ProjectAuth">
type ProjectMenuCommandTag = Parameters<typeof runProjectMenuCommand>[0]
type ProjectMenuAction = (context: BrowserActionContext) => void

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

const applyProjectConfirmMessage = (
  label: string,
  gpu?: "none" | "all"
): string =>
  gpu === undefined
    ? `Apply docker-git config to ${label}? This restarts the container and ends active SSH sessions and in-container browsers.`
    : `Apply docker-git config to ${label} with GPU ${gpu}? This restarts the container and ends active SSH sessions and in-container browsers.`

export const applyProjectById = (
  projectId: string,
  context: BrowserActionContext,
  gpu?: "none" | "all"
) => {
  const label = context.selectedProjectId === projectId
    ? projectActionLabel(context)
    : projectId
  if (!confirmAction(applyProjectConfirmMessage(label, gpu))) {
    return
  }
  context.setSelectedProjectId(projectId)
  withBusy({
    context,
    effect: applyProject(projectId, gpu === undefined ? undefined : { gpu }),
    label: "Applying project",
    onSuccess: (project) => {
      context.reloadDashboard()
      context.setSelectedProject(project)
      context.setMessage(`Applied ${project.displayName} (GPU ${project.gpu}).`)
    }
  })
}

export const applySelectedProject = (
  context: BrowserActionContext,
  gpu?: "none" | "all"
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  applyProjectById(projectId, context, gpu)
}

const setCreateModeMessage = (context: BrowserActionContext): void => {
  context.setMessage("Create mode is active. Paste URL or URL + flags, then choose Quick Create or Settings.")
}

const setShareModeMessage = (context: BrowserActionContext): void => {
  context.setMessage("Share screen is active.")
}

const runProjectMenuCommandAction = (currentMenu: ProjectMenuCommandTag): ProjectMenuAction => (context) => {
  runProjectMenuCommand(currentMenu, context)
}

const projectMenuActions: Record<ProjectMenuActionTag, ProjectMenuAction> = {
  Browser: openSelectedProjectBrowser,
  Create: setCreateModeMessage,
  Databases: openSelectedProjectDatabaseEditor,
  Delete: runProjectMenuCommandAction("Delete"),
  Down: runProjectMenuCommandAction("Down"),
  DownAll: runProjectMenuCommandAction("DownAll"),
  Info: loadSelectedProjectInfo,
  Logs: runProjectMenuCommandAction("Logs"),
  Ports: openSelectedProjectPort,
  Prompts: loadSelectedProjectPrompts,
  Quit: runProjectMenuCommandAction("Quit"),
  Select: connectSelectedProject,
  Share: setShareModeMessage,
  Skills: loadSelectedProjectSkills,
  Status: runProjectMenuCommandAction("Status"),
  Tasks: loadSelectedProjectTasks
}

export const runProjectMenuAction = (
  currentMenu: Exclude<BrowserMenuTag, "Auth" | "ProjectAuth">,
  context: BrowserActionContext
) => {
  projectMenuActions[currentMenu](context)
}

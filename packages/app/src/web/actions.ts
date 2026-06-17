import { refreshAuthPanel, refreshProjectAuthPanel } from "./actions-auth.js"
import { runProjectMenuAction } from "./actions-projects.js"
import { startPanelShareTunnel } from "./actions-share.js"
import { type BrowserActionContext, isGithubAuthConfigured } from "./actions-shared.js"
import { shouldBlockMenuForGithubAuth } from "./github-auth-gate.js"
import type { BrowserMenuTag } from "./menu.js"

export type { BrowserActionContext } from "./actions-shared.js"

export {
  cancelBrowserActionPrompt,
  refreshAuthPanel,
  refreshProjectAuthPanel,
  runBrowserAuthAction,
  runBrowserProjectAuthAction,
  submitBrowserActionPrompt
} from "./actions-auth.js"
export {
  loadProjectBrowserById,
  loadSelectedProjectBrowser,
  openProjectBrowserById,
  openSelectedProjectBrowser
} from "./actions-browser.js"
export {
  closeSelectedDatabaseForward,
  deleteSelectedDatabaseProfile,
  exposeSelectedDatabaseProfile,
  loadSelectedProjectDatabases,
  openSelectedProjectDatabaseEditor,
  restartSelectedProjectDatabaseEditor,
  saveSelectedDatabaseProfile
} from "./actions-databases.js"
export { closeSelectedProjectPort, loadSelectedProjectPorts, openSelectedProjectPort } from "./actions-port-forwards.js"
export {
  applyProjectById,
  applySelectedProject,
  attachProjectTerminalById,
  connectProjectById,
  loadSelectedProjectInfo,
  runApplyAllProjects
} from "./actions-projects.js"
export {
  deleteSelectedProjectPrompt,
  loadSelectedProjectPrompts,
  saveSelectedProjectPrompt
} from "./actions-prompts.js"
export {
  copyPanelShareTunnelUrl,
  refreshPanelCloudflareTunnel,
  startPanelShareTunnel,
  stopPanelShareTunnel
} from "./actions-share.js"
export { openSkillerApp } from "./actions-skiller.js"
export { deleteSelectedProjectSkill, loadSelectedProjectSkills, saveSelectedProjectSkill } from "./actions-skills.js"
export {
  loadProjectTasksById,
  loadSelectedProjectTaskLogs,
  loadSelectedProjectTasks,
  setSelectedProjectTasksIncludeDefault,
  stopSelectedProjectTask
} from "./actions-tasks.js"

export const runBrowserMenuAction = (
  currentMenu: BrowserMenuTag,
  context: BrowserActionContext
) => {
  if (shouldBlockMenuForGithubAuth(context.githubStatus, currentMenu) && !isGithubAuthConfigured(context)) {
    return
  }
  if (currentMenu === "Auth") {
    refreshAuthPanel(context)
    return
  }
  if (currentMenu === "ProjectAuth") {
    refreshProjectAuthPanel(context)
    return
  }
  if (currentMenu === "Share") {
    startPanelShareTunnel(context)
    return
  }
  runProjectMenuAction(currentMenu, context)
}

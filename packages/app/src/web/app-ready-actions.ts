import { authMenuActionByIndex } from "../docker-git/menu-auth-shared.js"
import { projectAuthMenuActionByIndex } from "../docker-git/menu-project-auth-shared.js"
import { runBrowserAuthAction, runBrowserProjectAuthAction } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { BrowserMenuTag } from "./menu.js"
import { browserMenuItems } from "./menu.js"

type ActionContextArgs = {
  readonly refreshDashboard: () => void
  readonly selectedProjectId: string | null
  readonly selectedProjectName: string | null
  readonly setActionPrompt: BrowserActionContext["setActionPrompt"]
  readonly setAuthSnapshot: BrowserActionContext["setAuthSnapshot"]
  readonly setBusyLabel: BrowserActionContext["setBusyLabel"]
  readonly setGithubStatus: BrowserActionContext["setGithubStatus"]
  readonly setMessage: BrowserActionContext["setMessage"]
  readonly setOutput: BrowserActionContext["setOutput"]
  readonly setProjectAuthSnapshot: BrowserActionContext["setProjectAuthSnapshot"]
  readonly setSelectedMenuIndex: BrowserActionContext["setSelectedMenuIndex"]
  readonly setSelectedProject: BrowserActionContext["setSelectedProject"]
  readonly setSelectedProjectId: BrowserActionContext["setSelectedProjectId"]
  readonly setTerminalSession: BrowserActionContext["setTerminalSession"]
}

export const resolveCurrentMenu = (selectedMenuIndex: number): BrowserMenuTag =>
  browserMenuItems[selectedMenuIndex]?.tag ?? "Select"

export const createActionContext = (args: ActionContextArgs): BrowserActionContext => ({
  reloadDashboard: args.refreshDashboard,
  selectedProjectId: args.selectedProjectId,
  selectedProjectName: args.selectedProjectName,
  setActionPrompt: args.setActionPrompt,
  setAuthSnapshot: args.setAuthSnapshot,
  setBusyLabel: args.setBusyLabel,
  setGithubStatus: args.setGithubStatus,
  setMessage: args.setMessage,
  setOutput: args.setOutput,
  setProjectAuthSnapshot: args.setProjectAuthSnapshot,
  setSelectedMenuIndex: args.setSelectedMenuIndex,
  setSelectedProject: args.setSelectedProject,
  setSelectedProjectId: args.setSelectedProjectId,
  setTerminalSession: args.setTerminalSession
})

export const runAuthActionByIndex = (index: number, context: BrowserActionContext) => {
  const action = authMenuActionByIndex(index)
  if (action !== null) {
    runBrowserAuthAction(action, context)
  }
}

export const runProjectAuthActionByIndex = (
  index: number,
  context: BrowserActionContext
) => {
  const action = projectAuthMenuActionByIndex(index)
  if (action !== null) {
    runBrowserProjectAuthAction(action, context)
  }
}

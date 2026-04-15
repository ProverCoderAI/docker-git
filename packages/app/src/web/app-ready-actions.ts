import { authMenuActionByIndex } from "../docker-git/menu-auth-shared.js"
import { projectAuthMenuActionByIndex } from "../docker-git/menu-project-auth-shared.js"
import { runBrowserAuthAction, runBrowserProjectAuthAction } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { BrowserMenuTag } from "./menu.js"
import { browserMenuItems } from "./menu.js"

type ActionContextArgs = {
  readonly databaseConnectionInput: BrowserActionContext["databaseConnectionInput"]
  readonly databaseLabelInput: BrowserActionContext["databaseLabelInput"]
  readonly githubStatus: BrowserActionContext["githubStatus"]
  readonly portForwardInput: BrowserActionContext["portForwardInput"]
  readonly refreshDashboard: () => void
  readonly selectedProjectId: string | null
  readonly selectedProjectName: string | null
  readonly setActionPrompt: BrowserActionContext["setActionPrompt"]
  readonly setActiveScreen: BrowserActionContext["setActiveScreen"]
  readonly setAuthSnapshot: BrowserActionContext["setAuthSnapshot"]
  readonly setBusyLabel: BrowserActionContext["setBusyLabel"]
  readonly setDatabaseConnectionInput: BrowserActionContext["setDatabaseConnectionInput"]
  readonly setDatabaseForwards: BrowserActionContext["setDatabaseForwards"]
  readonly setDatabaseLabelInput: BrowserActionContext["setDatabaseLabelInput"]
  readonly setDatabaseProfiles: BrowserActionContext["setDatabaseProfiles"]
  readonly setDatabaseSession: BrowserActionContext["setDatabaseSession"]
  readonly setGithubStatus: BrowserActionContext["setGithubStatus"]
  readonly setMessage: BrowserActionContext["setMessage"]
  readonly setOutput: BrowserActionContext["setOutput"]
  readonly setPortForwardInput: BrowserActionContext["setPortForwardInput"]
  readonly setPortForwards: BrowserActionContext["setPortForwards"]
  readonly setProjectAuthSnapshot: BrowserActionContext["setProjectAuthSnapshot"]
  readonly setProjectBrowser: BrowserActionContext["setProjectBrowser"]
  readonly setSelectedMenuIndex: BrowserActionContext["setSelectedMenuIndex"]
  readonly setSelectedProject: BrowserActionContext["setSelectedProject"]
  readonly setSelectedProjectId: BrowserActionContext["setSelectedProjectId"]
  readonly setTerminalSession: BrowserActionContext["setTerminalSession"]
}

export const resolveCurrentMenu = (selectedMenuIndex: number): BrowserMenuTag =>
  browserMenuItems[selectedMenuIndex]?.tag ?? "Select"

export const createActionContext = (args: ActionContextArgs): BrowserActionContext => ({
  databaseConnectionInput: args.databaseConnectionInput,
  databaseLabelInput: args.databaseLabelInput,
  githubStatus: args.githubStatus,
  portForwardInput: args.portForwardInput,
  reloadDashboard: args.refreshDashboard,
  selectedProjectId: args.selectedProjectId,
  selectedProjectName: args.selectedProjectName,
  setActionPrompt: args.setActionPrompt,
  setActiveScreen: args.setActiveScreen,
  setAuthSnapshot: args.setAuthSnapshot,
  setBusyLabel: args.setBusyLabel,
  setDatabaseConnectionInput: args.setDatabaseConnectionInput,
  setDatabaseForwards: args.setDatabaseForwards,
  setDatabaseLabelInput: args.setDatabaseLabelInput,
  setDatabaseProfiles: args.setDatabaseProfiles,
  setDatabaseSession: args.setDatabaseSession,
  setGithubStatus: args.setGithubStatus,
  setMessage: args.setMessage,
  setOutput: args.setOutput,
  setPortForwardInput: args.setPortForwardInput,
  setPortForwards: args.setPortForwards,
  setProjectAuthSnapshot: args.setProjectAuthSnapshot,
  setProjectBrowser: args.setProjectBrowser,
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

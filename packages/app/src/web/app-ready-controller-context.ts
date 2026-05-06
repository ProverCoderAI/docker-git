import type { DashboardData } from "./api.js"
import { createActionContext } from "./app-ready-actions.js"
import type { ReadyState } from "./app-ready-hooks.js"

type ReadyActionContextArgs = {
  readonly refreshDashboard: () => void
  readonly selectedProjectSummary: DashboardData["projects"][number] | undefined
  readonly state: ReadyState
}

export const createReadyActionContext = (
  { refreshDashboard, selectedProjectSummary, state }: ReadyActionContextArgs
): ReturnType<typeof createActionContext> =>
  createActionContext({
    addTerminalSession: state.addTerminalSession,
    closeTerminalSession: state.closeTerminalSession,
    databaseConnectionInput: state.databaseConnectionInput,
    databaseLabelInput: state.databaseLabelInput,
    githubStatus: state.githubStatus,
    portForwardInput: state.portForwardInput,
    projectTasksIncludeDefault: state.projectTasksIncludeDefault,
    refreshDashboard,
    selectedProjectId: state.selectedProjectId,
    selectedProjectKey: selectedProjectSummary?.projectKey ?? null,
    selectedProjectName: selectedProjectSummary?.displayName ?? null,
    setActionPrompt: state.setActionPrompt,
    setActiveScreen: state.setActiveScreen,
    setAuthSnapshot: state.setAuthSnapshot,
    setBusyLabel: state.setBusyLabel,
    setDatabaseConnectionInput: state.setDatabaseConnectionInput,
    setDatabaseForwards: state.setDatabaseForwards,
    setDatabaseLabelInput: state.setDatabaseLabelInput,
    setDatabaseProfiles: state.setDatabaseProfiles,
    setDatabaseSession: state.setDatabaseSession,
    setGithubStatus: state.setGithubStatus,
    setMessage: state.setMessage,
    setOutput: state.setOutput,
    setPortForwardInput: state.setPortForwardInput,
    setPortForwards: state.setPortForwards,
    setProjectAuthSnapshot: state.setProjectAuthSnapshot,
    setProjectBrowser: state.setProjectBrowser,
    setProjectTaskLogs: state.setProjectTaskLogs,
    setProjectTasks: state.setProjectTasks,
    setProjectTasksIncludeDefault: state.setProjectTasksIncludeDefault,
    setSelectedMenuIndex: state.setSelectedMenuIndex,
    setSelectedProject: state.setSelectedProject,
    setSelectedProjectId: state.setSelectedProjectId
  })

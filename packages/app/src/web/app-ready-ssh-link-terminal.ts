import type { BrowserActionContext } from "./actions-shared.js"
import type { TerminalSession } from "./api-types.js"
import type { DashboardProject } from "./app-ready-ssh-link-core.js"
import { browserMenuIndex } from "./menu.js"
import { projectPickerScreen } from "./screen.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession } from "./terminal.js"

type ProjectTerminalAttachArgs = {
  readonly actionContext: Pick<
    BrowserActionContext,
    "reloadDashboard" | "setActiveScreen" | "setSelectedMenuIndex" | "setSelectedProjectId"
  >
  readonly addTerminalSession: (session: ActiveTerminalSession) => void
  readonly selectTerminalSession: (sessionId: string) => void
}

export const showProjectTerminalScreen = (
  actionContext: ProjectTerminalAttachArgs["actionContext"],
  projectId: string
): void => {
  actionContext.setSelectedMenuIndex(browserMenuIndex("Select"))
  actionContext.setActiveScreen(projectPickerScreen())
  actionContext.setSelectedProjectId(projectId)
}

const buildProjectTerminalSession = (
  args: ProjectTerminalAttachArgs,
  project: DashboardProject,
  session: TerminalSession
): ActiveTerminalSession =>
  buildProjectActiveTerminalSession({
    onExit: args.actionContext.reloadDashboard,
    onReady: args.actionContext.reloadDashboard,
    projectDisplayName: project.displayName,
    projectId: project.id,
    projectKey: project.projectKey,
    session
  })

export const attachProjectWorkspaceSessions = (
  args: ProjectTerminalAttachArgs,
  project: DashboardProject,
  sessions: ReadonlyArray<TerminalSession>,
  selectedSession: TerminalSession
): void => {
  const orderedSessions = sessions.toSorted((left, right) => left.createdAt.localeCompare(right.createdAt))
  for (const session of orderedSessions) {
    if (session.id !== selectedSession.id) {
      args.addTerminalSession(buildProjectTerminalSession(args, project, session))
    }
  }
  args.addTerminalSession(buildProjectTerminalSession(args, project, selectedSession))
  args.selectTerminalSession(selectedSession.id)
}

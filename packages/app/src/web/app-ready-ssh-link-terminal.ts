import { projectTerminalLabel } from "@prover-coder-ai/docker-git-terminal/core"

import type { BrowserActionContext } from "./actions-shared.js"
import type { TerminalSession } from "./api-types.js"
import type { DashboardProject } from "./app-ready-ssh-link-core.js"
import { browserMenuIndex } from "./menu.js"
import { projectPickerScreen } from "./screen.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession, projectSshRoutePath } from "./terminal.js"

type ProjectTerminalAttachArgs = {
  readonly actionContext: Pick<
    BrowserActionContext,
    "reloadDashboard" | "setActiveScreen" | "setSelectedMenuIndex" | "setSelectedProjectId"
  >
  readonly addTerminalSession: (session: ActiveTerminalSession) => void
  readonly selectTerminalSession: (sessionId: string) => void
}

export type LoadedSshSessionLink = {
  readonly projectDisplayName: string
  readonly projectKey: string
  readonly session: TerminalSession
}

type LoadedSshSessionAttachArgs = {
  readonly actionContext: Pick<
    BrowserActionContext,
    "reloadDashboard" | "setActiveScreen" | "setMessage" | "setSelectedMenuIndex" | "setSelectedProjectId"
  >
  readonly addTerminalSession: (session: ActiveTerminalSession) => void
}

/**
 * Opens the project terminal screen for a selected project.
 *
 * @param actionContext - Browser screen/menu setters.
 * @param projectId - Project id to select.
 * @returns Nothing; state is written through actionContext.
 * @pure false
 * @effect BrowserActionContext screen/menu selection setters.
 * @invariant selected menu is Select and selected project id equals projectId.
 * @precondition actionContext is live and projectId is non-empty.
 * @postcondition project picker screen is active for projectId.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: keep SSH link screen selection in a focused shell helper
// WHY: async link handlers need one shared mutation path for project terminal focus
// QUOTE(ТЗ): n/a
// REF: PR #342 CodeRabbit review
// SOURCE: n/a
// FORMAT THEOREM: focus(projectId) -> selectedProjectId = projectId
// PURITY: SHELL
// EFFECT: BrowserActionContext -> setSelectedMenuIndex, setActiveScreen, setSelectedProjectId
// INVARIANT: menu Select and project picker screen are selected together
// COMPLEXITY: O(1)
export const showProjectTerminalScreen = (
  actionContext: ProjectTerminalAttachArgs["actionContext"],
  projectId: string
): void => {
  actionContext.setSelectedMenuIndex(browserMenuIndex("Select"))
  actionContext.setActiveScreen(projectPickerScreen())
  actionContext.setSelectedProjectId(projectId)
}

/**
 * Attaches a loaded legacy SSH session link to browser terminal state.
 *
 * @param args - Browser action sinks used for route, terminal, and message updates.
 * @param link - Loaded terminal session plus project display metadata.
 * @returns Nothing; route and terminal state are written through shell dependencies.
 * @pure false
 * @effect globalThis.history plus BrowserActionContext setters and addTerminalSession.
 * @invariant The browser route points to the attached session id.
 * @precondition link.session belongs to link.projectKey.
 * @postcondition The project terminal screen is focused and the loaded session is added.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: isolate loaded legacy session attach side effects
// WHY: stale-link guards in the hook should precede one compact shell transition
// QUOTE(ТЗ): n/a
// REF: PR #342 CodeRabbit review
// SOURCE: n/a
// FORMAT THEOREM: attach(link) -> route = projectSshRoutePath(link.projectKey, link.session.id)
// PURITY: SHELL
// EFFECT: History, BrowserActionContext, addTerminalSession
// INVARIANT: added terminal session is built from the loaded backend session
// COMPLEXITY: O(1)
export const attachLoadedSshSessionLink = (
  args: LoadedSshSessionAttachArgs,
  { projectDisplayName, projectKey, session }: LoadedSshSessionLink
): void => {
  globalThis.history.replaceState(globalThis.history.state, "", projectSshRoutePath(projectKey, session.id))
  showProjectTerminalScreen(args.actionContext, session.projectId)
  args.addTerminalSession(buildProjectActiveTerminalSession({
    onExit: args.actionContext.reloadDashboard,
    onReady: args.actionContext.reloadDashboard,
    projectDisplayName,
    projectId: session.projectId,
    projectKey,
    session
  }))
  args.actionContext.setMessage(`Attached SSH terminal for ${projectDisplayName}.`)
}

/**
 * Builds an active terminal session from a backend terminal session.
 *
 * @param args - Browser callbacks used by the terminal session lifecycle.
 * @param project - Dashboard project owning the session.
 * @param session - Backend terminal session to wrap.
 * @returns Active terminal session ready for the browser tab list.
 * @pure true
 * @effect n/a
 * @invariant session.projectId is preserved in the ActiveTerminalSession.
 * @precondition project and session describe the same project.
 * @postcondition onExit and onReady both reload the dashboard.
 * @complexity O(1)
 * @throws Never
 */
// CHANGE: isolate ActiveTerminalSession construction for SSH-link workspace attach
// WHY: route attach and workspace attach must use identical terminal metadata
// QUOTE(ТЗ): n/a
// REF: PR #342 CodeRabbit review
// SOURCE: n/a
// FORMAT THEOREM: build(project, session).session = session
// PURITY: CORE
// EFFECT: n/a
// INVARIANT: project display/key/id are copied without mutation
// COMPLEXITY: O(1)
const buildProjectTerminalSession = (
  args: ProjectTerminalAttachArgs,
  project: DashboardProject,
  session: TerminalSession
): ActiveTerminalSession =>
  buildProjectActiveTerminalSession({
    onExit: args.actionContext.reloadDashboard,
    onReady: args.actionContext.reloadDashboard,
    projectDisplayName: projectTerminalLabel(project),
    projectId: project.id,
    projectKey: project.projectKey,
    session
  })

/**
 * Adds workspace terminal sessions in created-at order and selects the requested one.
 *
 * @param args - Browser terminal-session sinks.
 * @param project - Dashboard project owning the sessions.
 * @param sessions - Workspace terminal sessions returned by the backend.
 * @param selectedSession - Session that must become active after attach.
 * @returns Nothing; terminal tabs and selection are written through args.
 * @pure false
 * @effect args.addTerminalSession and args.selectTerminalSession.
 * @invariant selectedSession is added after all other sessions.
 * @precondition selectedSession belongs to sessions.
 * @postcondition args.selectTerminalSession is called with selectedSession.id.
 * @complexity O(n log n) time and O(n) space where n = sessions.length.
 * @throws Never
 */
// CHANGE: preserve deterministic workspace session attach ordering
// WHY: opening selected session last keeps browser tab ordering stable while selecting the intended terminal
// QUOTE(ТЗ): n/a
// REF: PR #342 CodeRabbit review
// SOURCE: n/a
// FORMAT THEOREM: attach(sessions, selected) -> selectedSession.id is selected
// PURITY: SHELL
// EFFECT: ProjectTerminalAttachArgs -> addTerminalSession*, selectTerminalSession
// INVARIANT: non-selected sessions are added by ascending createdAt before selectedSession
// COMPLEXITY: O(n log n) time and O(n) space
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

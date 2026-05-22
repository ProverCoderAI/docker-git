import { Effect } from "effect"
import { useEffect, useRef } from "react"

import { connectProjectById } from "./actions-projects.js"
import type { BrowserActionContext } from "./actions-shared.js"
import type { TerminalSession } from "./api-types.js"
import { loadProjectTerminalWorkspace, loadTerminalSessionById } from "./api.js"
import type { DashboardData } from "./api.js"
import {
  type DashboardProject,
  findLocalTerminalSession,
  findProjectBySshToken,
  type ProjectLookupResult,
  readSshLinkRequestFromHref,
  resolveMissingSshSessionFallbackPath,
  selectLocalProjectTerminal,
  selectWorkspaceTerminalSession,
  type SshLinkRequest,
  sshLinkRequestKey
} from "./app-ready-ssh-link-core.js"
import { browserMenuIndex } from "./menu.js"
import { projectPickerScreen } from "./screen.js"
import { terminalSessionId } from "./terminal-state.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession, projectSshRoutePath } from "./terminal.js"

export {
  readSshLinkRequestFromHref,
  resolveMissingSshSessionFallbackPath,
  selectWorkspaceTerminalSession
} from "./app-ready-ssh-link-core.js"

type SshLinkArgs = {
  readonly actionContext: BrowserActionContext
  readonly activeTerminalSessionId: string | null
  readonly addTerminalSession: (session: ActiveTerminalSession) => void
  readonly busyLabel: string | null
  readonly dashboard: DashboardData
  readonly deactivateTerminalWorkspace: () => void
  readonly selectTerminalSession: (sessionId: string) => void
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

type ConnectTimerRef = { current: ReturnType<typeof globalThis.setTimeout> | null }
type SshTokenRef = { current: string | null }
type SshLinkEffectArgs = Omit<SshLinkArgs, "dashboard"> & {
  readonly connectTimerRef: ConnectTimerRef
  readonly handledTokenRef: SshTokenRef
  readonly projects: DashboardData["projects"]
}

const clearConnectTimer = (connectTimerRef: ConnectTimerRef): void => {
  if (connectTimerRef.current !== null) {
    globalThis.clearTimeout(connectTimerRef.current)
    connectTimerRef.current = null
  }
}

const readSshLinkRequest = (): SshLinkRequest | null => readSshLinkRequestFromHref(globalThis.location.href)

const showProjectTerminalScreen = (actionContext: BrowserActionContext, projectId: string): void => {
  actionContext.setSelectedMenuIndex(browserMenuIndex("Select"))
  actionContext.setActiveScreen(projectPickerScreen())
  actionContext.setSelectedProjectId(projectId)
}

const buildProjectTerminalSession = (
  args: SshLinkEffectArgs,
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

const attachProjectWorkspaceSessions = (
  args: SshLinkEffectArgs,
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

const scheduleTerminalSessionAttach = (args: SshLinkEffectArgs, sessionId: string): void => {
  clearConnectTimer(args.connectTimerRef)
  args.connectTimerRef.current = globalThis.setTimeout(() => {
    args.connectTimerRef.current = null
    void Effect.runPromise(
      loadTerminalSessionById(sessionId).pipe(
        Effect.match({
          onFailure: (error) => {
            const fallbackPath = resolveMissingSshSessionFallbackPath(globalThis.location.href, sessionId, error)
            if (fallbackPath !== null) {
              args.handledTokenRef.current = null
              args.deactivateTerminalWorkspace()
              args.actionContext.setSelectedMenuIndex(browserMenuIndex("Select"))
              args.actionContext.setActiveScreen(projectPickerScreen())
              globalThis.history.replaceState(globalThis.history.state, "", fallbackPath)
              args.actionContext.setMessage(`SSH terminal is no longer available: ${sessionId}.`)
              return
            }
            args.actionContext.setMessage(error)
          },
          onSuccess: ({ projectDisplayName, projectKey, session }) => {
            globalThis.history.replaceState(
              globalThis.history.state,
              "",
              projectSshRoutePath(projectKey, session.id)
            )
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
        })
      )
    )
  }, 0)
}

const attachExistingProjectLink = (
  args: SshLinkEffectArgs,
  project: DashboardProject,
  request: { readonly terminalId?: string | undefined }
): boolean => {
  const localSession = selectLocalProjectTerminal(
    args.terminalSessions,
    args.activeTerminalSessionId,
    project.id,
    request.terminalId
  )
  if (localSession === null) {
    return false
  }
  clearConnectTimer(args.connectTimerRef)
  showProjectTerminalScreen(args.actionContext, project.id)
  args.selectTerminalSession(terminalSessionId(localSession))
  args.actionContext.setMessage(`Opened SSH terminal for ${project.displayName}.`)
  return true
}

const scheduleProjectTerminalAttach = (
  args: SshLinkEffectArgs,
  project: DashboardProject,
  request: { readonly terminalId?: string | undefined }
): void => {
  clearConnectTimer(args.connectTimerRef)
  showProjectTerminalScreen(args.actionContext, project.id)
  args.connectTimerRef.current = globalThis.setTimeout(() => {
    args.connectTimerRef.current = null
    void Effect.runPromise(
      loadProjectTerminalWorkspace(project.projectKey).pipe(
        Effect.match({
          onFailure: (error) => {
            args.actionContext.setMessage(error)
          },
          onSuccess: ({ activeSessionId, sessions }) => {
            const selectedSession = selectWorkspaceTerminalSession(sessions, activeSessionId, request.terminalId)
            if (selectedSession === null) {
              if (request.terminalId !== undefined) {
                args.actionContext.setMessage(`SSH terminal link was not found: ${request.terminalId}.`)
                return
              }
              connectProjectById(project.id, args.actionContext, project.projectKey)
              return
            }
            attachProjectWorkspaceSessions(args, project, sessions, selectedSession)
            args.actionContext.setMessage(`Attached SSH terminal for ${project.displayName}.`)
          }
        })
      )
    )
  }, 0)
}

const handleProjectSshLink = (args: SshLinkEffectArgs, request: ProjectLookupResult): void => {
  const project = findProjectBySshToken(args.projects, request.token)
  if (project === undefined) {
    args.actionContext.setMessage(`Project link was not found: ${request.token}.`)
    return
  }
  if (attachExistingProjectLink(args, project, request)) {
    return
  }
  scheduleProjectTerminalAttach(args, project, request)
}

const handleSessionSshLink = (args: SshLinkEffectArgs, request: { readonly sessionId: string }): void => {
  const localSession = findLocalTerminalSession(args.terminalSessions, request.sessionId)
  if (localSession === undefined) {
    scheduleTerminalSessionAttach(args, request.sessionId)
    return
  }
  clearConnectTimer(args.connectTimerRef)
  if (localSession.browserProjectId !== undefined) {
    showProjectTerminalScreen(args.actionContext, localSession.browserProjectId)
  }
  args.selectTerminalSession(request.sessionId)
  args.actionContext.setMessage(`Opened existing SSH terminal: ${request.sessionId}.`)
}

const handleSshLinkEffect = (args: SshLinkEffectArgs): void => {
  const request = readSshLinkRequest()
  if (request === null) {
    clearConnectTimer(args.connectTimerRef)
    args.handledTokenRef.current = null
    return
  }
  const requestKey = sshLinkRequestKey(request)
  if (args.busyLabel !== null || args.handledTokenRef.current === requestKey) {
    return
  }

  args.handledTokenRef.current = requestKey
  if (request.kind === "project") {
    handleProjectSshLink(args, request)
    return
  }
  handleSessionSshLink(args, request)
}

export const useSshLink = ({
  actionContext,
  activeTerminalSessionId,
  addTerminalSession,
  busyLabel,
  dashboard,
  deactivateTerminalWorkspace,
  selectTerminalSession,
  terminalSessions
}: SshLinkArgs) => {
  const connectTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const handledTokenRef = useRef<string | null>(null)
  const locationSignature = `${globalThis.location.pathname}${globalThis.location.search}`

  useEffect(() => () => {
    clearConnectTimer(connectTimerRef)
  }, [])

  useEffect(() => {
    handleSshLinkEffect({
      actionContext,
      activeTerminalSessionId,
      addTerminalSession,
      busyLabel,
      connectTimerRef,
      deactivateTerminalWorkspace,
      handledTokenRef,
      projects: dashboard.projects,
      selectTerminalSession,
      terminalSessions
    })
  }, [
    actionContext,
    activeTerminalSessionId,
    addTerminalSession,
    busyLabel,
    dashboard.projects,
    deactivateTerminalWorkspace,
    locationSignature,
    selectTerminalSession,
    terminalSessions
  ])
}

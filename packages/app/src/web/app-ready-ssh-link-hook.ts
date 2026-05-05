import { Effect } from "effect"
import { useEffect, useRef } from "react"

import type { BrowserActionContext } from "./actions-shared.js"
import { loadTerminalSessionById } from "./api.js"
import type { DashboardData } from "./api.js"
import { browserMenuIndex } from "./menu.js"
import { projectPickerScreen } from "./screen.js"
import { terminalSessionId } from "./terminal-state.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession } from "./terminal.js"

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

const sshPathPrefix = "/ssh/"
type ConnectTimerRef = { current: ReturnType<typeof globalThis.setTimeout> | null }
type SshTokenRef = { current: string | null }
type DashboardProject = DashboardData["projects"][number]
type SessionLookupResult = { readonly sessionId: string }
type ProjectLookupResult = { readonly token: string }
type SshLinkRequest =
  | ({ readonly kind: "project" } & ProjectLookupResult)
  | ({ readonly kind: "session" } & SessionLookupResult)
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

const decodePathTail = (value: string): string =>
  value
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => decodeURIComponent(segment))
    .join("/")
    .trim()

const readSshLinkRequest = (): SshLinkRequest | null => {
  const url = new URL(globalThis.location.href)
  if (url.pathname.startsWith(sshPathPrefix)) {
    const tail = url.pathname.slice(sshPathPrefix.length)
    if (tail.startsWith("session/")) {
      const sessionId = decodeURIComponent(tail.slice("session/".length).split("/")[0] ?? "").trim()
      return sessionId.length === 0 ? null : { kind: "session", sessionId }
    }
    const decoded = decodePathTail(tail)
    return decoded.length === 0 ? null : { kind: "project", token: decoded }
  }
  const queryToken = url.searchParams.get("ssh")?.trim() ?? ""
  return queryToken.length === 0 ? null : { kind: "project", token: queryToken }
}

const findProjectBySshToken = (
  projects: DashboardData["projects"],
  token: string
): DashboardProject | undefined =>
  projects.find((candidate) => candidate.projectKey === token || candidate.id === token)

const showProjectTerminalScreen = (actionContext: BrowserActionContext, projectId: string): void => {
  actionContext.setSelectedMenuIndex(browserMenuIndex("Select"))
  actionContext.setActiveScreen(projectPickerScreen())
  actionContext.setSelectedProjectId(projectId)
}

const findLocalTerminalSession = (
  sessions: ReadonlyArray<ActiveTerminalSession>,
  sessionId: string
): ActiveTerminalSession | undefined => sessions.find((session) => terminalSessionId(session) === sessionId)

const scheduleTerminalSessionAttach = (args: SshLinkEffectArgs, sessionId: string): void => {
  clearConnectTimer(args.connectTimerRef)
  args.connectTimerRef.current = globalThis.setTimeout(() => {
    args.connectTimerRef.current = null
    void Effect.runPromise(
      loadTerminalSessionById(sessionId).pipe(
        Effect.match({
          onFailure: (error) => {
            args.actionContext.setMessage(error)
          },
          onSuccess: ({ projectDisplayName, projectKey, session }) => {
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

const handleSshLinkEffect = (args: SshLinkEffectArgs): void => {
  const request = readSshLinkRequest()
  if (request === null) {
    clearConnectTimer(args.connectTimerRef)
    args.handledTokenRef.current = null
    return
  }
  const requestKey = request.kind === "session" ? `session:${request.sessionId}` : `project:${request.token}`
  if (args.busyLabel !== null || args.handledTokenRef.current === requestKey) {
    return
  }

  args.handledTokenRef.current = requestKey
  if (request.kind === "project") {
    const project = findProjectBySshToken(args.projects, request.token)
    if (project === undefined) {
      args.actionContext.setMessage(`Project link was not found: ${request.token}.`)
      return
    }
    clearConnectTimer(args.connectTimerRef)
    showProjectTerminalScreen(args.actionContext, project.id)
    args.deactivateTerminalWorkspace()
    return
  }

  const localSession = findLocalTerminalSession(args.terminalSessions, request.sessionId)
  if (localSession !== undefined) {
    clearConnectTimer(args.connectTimerRef)
    if (localSession.browserProjectId !== undefined) {
      showProjectTerminalScreen(args.actionContext, localSession.browserProjectId)
    }
    args.selectTerminalSession(request.sessionId)
    args.actionContext.setMessage(`Opened existing SSH terminal: ${request.sessionId}.`)
    return
  }
  scheduleTerminalSessionAttach(args, request.sessionId)
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

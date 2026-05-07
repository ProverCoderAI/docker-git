import { Effect } from "effect"
import { useEffect, useRef } from "react"

import type { BrowserActionContext } from "./actions-shared.js"
import { loadTerminalSessionById } from "./api.js"
import type { DashboardData } from "./api.js"
import { browserMenuIndex } from "./menu.js"
import { projectPickerScreen } from "./screen.js"
import { terminalSessionId } from "./terminal-state.js"
import { type ActiveTerminalSession, buildProjectActiveTerminalSession, terminalSessionRoutePath } from "./terminal.js"

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

const readSessionPathRequest = (tail: string): SshLinkRequest | null => {
  const sessionId = decodeURIComponent(tail.slice("session/".length).split("/")[0] ?? "").trim()
  return sessionId.length === 0 ? null : { kind: "session", sessionId }
}

const readSshPathRequest = (url: URL): SshLinkRequest | null => {
  if (!url.pathname.startsWith(sshPathPrefix)) {
    return null
  }
  const tail = url.pathname.slice(sshPathPrefix.length)
  if (tail.startsWith("session/")) {
    return readSessionPathRequest(tail)
  }
  const decoded = decodePathTail(tail)
  return decoded.length === 0 ? null : { kind: "project", token: decoded }
}

const readSshQueryRequest = (url: URL): SshLinkRequest | null => {
  const queryToken = url.searchParams.get("ssh")?.trim() ?? ""
  return queryToken.length === 0 ? null : { kind: "project", token: queryToken }
}

const readSshLinkRequest = (): SshLinkRequest | null => {
  const url = new URL(globalThis.location.href)
  return readSshPathRequest(url) ?? readSshQueryRequest(url)
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

const sshLinkRequestKey = (request: SshLinkRequest): string =>
  request.kind === "session" ? `session:${request.sessionId}` : `project:${request.token}`

export const resolveMissingSshSessionFallbackPath = (
  href: string,
  sessionId: string,
  error: string
): string | null => {
  if (!error.includes("HTTP 404")) {
    return null
  }
  const url = new URL(href, "http://localhost")
  return url.pathname === terminalSessionRoutePath(sessionId) ? "/menu/select" : null
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

const handleProjectSshLink = (args: SshLinkEffectArgs, request: { readonly token: string }): void => {
  const project = findProjectBySshToken(args.projects, request.token)
  if (project === undefined) {
    args.actionContext.setMessage(`Project link was not found: ${request.token}.`)
    return
  }
  clearConnectTimer(args.connectTimerRef)
  showProjectTerminalScreen(args.actionContext, project.id)
  args.deactivateTerminalWorkspace()
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

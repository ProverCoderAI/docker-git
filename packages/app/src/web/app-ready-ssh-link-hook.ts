import { useEffect, useRef } from "react"

import { connectProjectById } from "./actions-projects.js"
import type { BrowserActionContext } from "./actions-shared.js"
import type { DashboardData } from "./api.js"
import { browserMenuIndex } from "./menu.js"
import { projectPickerScreen } from "./screen.js"
import { reusableProjectTerminalSessionId } from "./terminal-state.js"
import type { ActiveTerminalSession } from "./terminal.js"

type SshLinkArgs = {
  readonly actionContext: BrowserActionContext
  readonly activeTerminalSessionId: string | null
  readonly busyLabel: string | null
  readonly dashboard: DashboardData
  readonly selectTerminalSession: (sessionId: string) => void
  readonly terminalSessions: ReadonlyArray<ActiveTerminalSession>
}

const sshPathPrefix = "/ssh/"
type ConnectTimerRef = { current: ReturnType<typeof globalThis.setTimeout> | null }
type SshTokenRef = { current: string | null }
type DashboardProject = DashboardData["projects"][number]
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

const readSshLinkToken = (): string | null => {
  const url = new URL(globalThis.location.href)
  if (url.pathname.startsWith(sshPathPrefix)) {
    const token = url.pathname.slice(sshPathPrefix.length).split("/")[0] ?? ""
    const decoded = decodeURIComponent(token).trim()
    return decoded.length === 0 ? null : decoded
  }
  const queryToken = url.searchParams.get("ssh")?.trim() ?? ""
  return queryToken.length === 0 ? null : queryToken
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

const selectReusableProjectTerminal = (args: SshLinkEffectArgs, project: DashboardProject): boolean => {
  const reusableSessionId = reusableProjectTerminalSessionId(
    args.terminalSessions,
    args.activeTerminalSessionId,
    project.id
  )
  if (reusableSessionId === null) {
    return false
  }
  clearConnectTimer(args.connectTimerRef)
  args.selectTerminalSession(reusableSessionId)
  args.actionContext.setMessage(`Opened existing SSH terminal for ${project.displayName}.`)
  return true
}

const scheduleProjectTerminalConnect = (args: SshLinkEffectArgs, projectId: string): void => {
  clearConnectTimer(args.connectTimerRef)
  args.connectTimerRef.current = globalThis.setTimeout(() => {
    args.connectTimerRef.current = null
    connectProjectById(projectId, args.actionContext)
  }, 0)
}

const handleSshLinkEffect = (args: SshLinkEffectArgs): void => {
  const token = readSshLinkToken()
  if (token === null) {
    clearConnectTimer(args.connectTimerRef)
    args.handledTokenRef.current = null
    return
  }
  if (args.busyLabel !== null || args.handledTokenRef.current === token) {
    return
  }

  const project = findProjectBySshToken(args.projects, token)
  if (project === undefined) {
    args.actionContext.setMessage(`Project link was not found: ${token}.`)
    return
  }

  args.handledTokenRef.current = token
  showProjectTerminalScreen(args.actionContext, project.id)
  if (!selectReusableProjectTerminal(args, project)) {
    scheduleProjectTerminalConnect(args, project.id)
  }
}

export const useSshLink = ({
  actionContext,
  activeTerminalSessionId,
  busyLabel,
  dashboard,
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
      busyLabel,
      connectTimerRef,
      handledTokenRef,
      projects: dashboard.projects,
      selectTerminalSession,
      terminalSessions
    })
  }, [
    actionContext,
    activeTerminalSessionId,
    busyLabel,
    dashboard.projects,
    locationSignature,
    selectTerminalSession,
    terminalSessions
  ])
}

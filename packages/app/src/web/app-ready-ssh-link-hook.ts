import { useEffect, useRef } from "react"

import { connectProjectById } from "./actions-projects.js"
import type { BrowserActionContext } from "./actions-shared.js"
import type { DashboardData } from "./api.js"
import { browserMenuIndex } from "./menu.js"
import { projectPickerScreen } from "./screen.js"

type SshLinkArgs = {
  readonly actionContext: BrowserActionContext
  readonly busyLabel: string | null
  readonly dashboard: DashboardData
}

const sshPathPrefix = "/ssh/"

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

export const useSshLink = ({ actionContext, busyLabel, dashboard }: SshLinkArgs) => {
  const connectTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null)
  const handledTokenRef = useRef<string | null>(null)
  const locationSignature = `${globalThis.location.pathname}${globalThis.location.search}`

  useEffect(() => () => {
    if (connectTimerRef.current !== null) {
      globalThis.clearTimeout(connectTimerRef.current)
      connectTimerRef.current = null
    }
  }, [])

  useEffect(() => {
    const token = readSshLinkToken()
    if (token === null) {
      if (connectTimerRef.current !== null) {
        globalThis.clearTimeout(connectTimerRef.current)
        connectTimerRef.current = null
      }
      handledTokenRef.current = null
      return
    }
    if (busyLabel !== null || handledTokenRef.current === token) {
      return
    }

    const project = dashboard.projects.find((candidate) => candidate.projectKey === token || candidate.id === token)
    if (project === undefined) {
      actionContext.setMessage(`Project link was not found: ${token}.`)
      return
    }

    handledTokenRef.current = token
    actionContext.setSelectedMenuIndex(browserMenuIndex("Select"))
    actionContext.setActiveScreen(projectPickerScreen())
    actionContext.setSelectedProjectId(project.id)
    if (connectTimerRef.current !== null) {
      globalThis.clearTimeout(connectTimerRef.current)
    }
    connectTimerRef.current = globalThis.setTimeout(() => {
      connectTimerRef.current = null
      connectProjectById(project.id, actionContext)
    }, 0)
  }, [actionContext, busyLabel, dashboard.projects, locationSignature])
}

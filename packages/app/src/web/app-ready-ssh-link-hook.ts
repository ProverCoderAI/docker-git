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
  const handledRef = useRef(false)

  useEffect(() => {
    if (handledRef.current || busyLabel !== null) {
      return
    }
    const token = readSshLinkToken()
    if (token === null) {
      return
    }
    handledRef.current = true

    const project = dashboard.projects.find((candidate) => candidate.projectKey === token || candidate.id === token)
    if (project === undefined) {
      actionContext.setMessage(`Project link was not found: ${token}.`)
      return
    }

    actionContext.setSelectedMenuIndex(browserMenuIndex("Select"))
    actionContext.setActiveScreen(projectPickerScreen())
    connectProjectById(project.id, actionContext)
  }, [actionContext, busyLabel, dashboard.projects])
}

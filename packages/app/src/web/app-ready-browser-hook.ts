import { useEffect, useRef } from "react"

import { loadProjectBrowserById, loadSelectedProjectBrowser } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { ProjectBrowserSession } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"
import type { ActiveTerminalSession } from "./terminal.js"

type BrowserPanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
}

type TerminalBrowserAutoloadArgs = {
  readonly activeTerminalSession: ActiveTerminalSession | null
  readonly context: BrowserActionContext
  readonly dashboardRefreshTick: number
}

export const useProjectBrowserReset = (
  selectedProjectId: string | null,
  setProjectBrowser: (value: ProjectBrowserSession | null) => void
) => {
  useEffect(() => {
    setProjectBrowser(null)
  }, [selectedProjectId, setProjectBrowser])
}

export const maybeLoadProjectBrowser = (
  { activeScreen, context, currentMenu, selectedProjectId }: BrowserPanelAutoloadArgs
): void => {
  if (activeScreen.tag === "ProjectPicker" && currentMenu === "Browser" && selectedProjectId !== null) {
    loadSelectedProjectBrowser(context, { silent: true })
  }
}

export const useTerminalBrowserAutoload = (
  { activeTerminalSession, context, dashboardRefreshTick }: TerminalBrowserAutoloadArgs
) => {
  const contextRef = useRef(context)
  contextRef.current = context

  useEffect(() => {
    const projectId = activeTerminalSession?.browserProjectId
    if (projectId === undefined) {
      return
    }
    loadProjectBrowserById(projectId, contextRef.current, { silent: true })
  }, [dashboardRefreshTick, activeTerminalSession?.browserProjectId])
}

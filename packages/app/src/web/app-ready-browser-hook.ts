import { useEffect } from "react"

import { loadSelectedProjectBrowser } from "./actions.js"
import type { BrowserActionContext } from "./actions.js"
import type { ProjectBrowserSession } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"
import type { BrowserScreen } from "./screen.js"

type BrowserPanelAutoloadArgs = {
  readonly activeScreen: BrowserScreen
  readonly context: BrowserActionContext
  readonly currentMenu: BrowserMenuTag
  readonly selectedProjectId: string | null
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

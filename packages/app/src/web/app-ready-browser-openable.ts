import type { ProjectBrowserSession } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"

export const browserSidecarUnavailableMessage = "Select a project before opening the browser."

export const canOpenProjectBrowser = (
  _projectBrowser: ProjectBrowserSession | null,
  projectId: string | null | undefined
): boolean => projectId !== null && projectId !== undefined

export const canRunProjectBrowserAction = (
  menu: BrowserMenuTag,
  projectBrowser: ProjectBrowserSession | null,
  projectId: string | null | undefined
): boolean => menu !== "Browser" || canOpenProjectBrowser(projectBrowser, projectId)

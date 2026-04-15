import type { ProjectBrowserSession } from "./api.js"
import type { BrowserMenuTag } from "./menu.js"

export const browserSidecarUnavailableMessage =
  "Browser sidecar is not running. Enable Playwright MCP and start the project first."

export const canOpenProjectBrowser = (
  projectBrowser: ProjectBrowserSession | null,
  projectId: string | null | undefined
): boolean =>
  projectId !== null &&
  projectId !== undefined &&
  projectBrowser?.projectId === projectId &&
  projectBrowser.status === "running"

export const canRunProjectBrowserAction = (
  menu: BrowserMenuTag,
  projectBrowser: ProjectBrowserSession | null,
  projectId: string | null | undefined
): boolean => menu !== "Browser" || canOpenProjectBrowser(projectBrowser, projectId)

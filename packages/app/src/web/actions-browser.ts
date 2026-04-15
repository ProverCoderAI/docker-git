import {
  type BrowserActionContext,
  requireSelectedProjectId,
  withBusy,
  withSelectedProjectBusy
} from "./actions-shared.js"
import { loadProjectBrowser, projectBrowserCdpUrl, projectBrowserNoVncUrl } from "./api.js"

const openUrl = (url: string): boolean => {
  if (typeof globalThis.open === "function") {
    const openedWindow = globalThis.open(url, "_blank", "noopener")
    return openedWindow !== null
  }
  return false
}

export const loadSelectedProjectBrowser = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  withSelectedProjectBusy({
    context,
    effect: loadProjectBrowser,
    label: "Loading project browser",
    onMissing: () => {
      context.setProjectBrowser(null)
    },
    onSuccess: (browser) => {
      context.setProjectBrowser(browser)
      if (options?.silent !== true) {
        context.setMessage(
          browser.status === "running"
            ? `Browser is available at ${projectBrowserNoVncUrl(browser)}.`
            : `Browser sidecar is ${browser.status} for ${context.selectedProjectName ?? browser.projectId}.`
        )
      }
    }
  })
}

export const openSelectedProjectBrowser = (context: BrowserActionContext) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    return
  }
  openProjectBrowserById(projectId, context)
}

export const openProjectBrowserById = (projectId: string, context: BrowserActionContext) => {
  withBusy({
    context,
    effect: loadProjectBrowser(projectId),
    label: "Opening project browser",
    onSuccess: (browser) => {
      context.setProjectBrowser(browser)
      if (browser.status !== "running") {
        context.setMessage(`Browser sidecar is ${browser.status}. Enable Playwright MCP and start the project first.`)
        return
      }
      const noVncUrl = projectBrowserNoVncUrl(browser)
      context.setMessage(
        openUrl(noVncUrl)
          ? `Browser opened. CDP endpoint: ${projectBrowserCdpUrl(browser)}.`
          : `Browser popup was blocked. Open ${noVncUrl} manually. CDP endpoint: ${projectBrowserCdpUrl(browser)}.`
      )
    }
  })
}

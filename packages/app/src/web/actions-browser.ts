import { type BrowserActionContext, requireSelectedProjectId, withBusy } from "./actions-shared.js"
import { loadProjectBrowser, projectBrowserCdpUrl, projectBrowserNoVncUrl, type ProjectBrowserSession } from "./api.js"

const openUrl = (url: string): boolean => {
  if (typeof globalThis.open === "function") {
    const openedWindow = globalThis.open(url, "_blank", "noopener")
    return openedWindow !== null
  }
  return false
}

const browserStatusMessage = (browser: ProjectBrowserSession): string =>
  browser.status === "running"
    ? `Browser is available at ${projectBrowserNoVncUrl(browser)}.`
    : `Browser sidecar is ${browser.status} for ${browser.projectKey}.`

export const loadProjectBrowserById = (
  projectId: string,
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  withBusy({
    context,
    effect: loadProjectBrowser(projectId),
    label: "Loading project browser",
    onSuccess: (browser) => {
      context.setProjectBrowser(browser)
      if (options?.silent !== true) {
        context.setMessage(browserStatusMessage(browser))
      }
    }
  })
}

export const loadSelectedProjectBrowser = (
  context: BrowserActionContext,
  options?: { readonly silent?: boolean }
) => {
  const projectId = requireSelectedProjectId(context)
  if (projectId === null) {
    context.setProjectBrowser(null)
    return
  }
  loadProjectBrowserById(projectId, context, options)
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

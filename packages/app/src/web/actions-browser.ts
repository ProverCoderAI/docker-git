import {
  type BrowserActionContext,
  requireSelectedProjectId,
  withBusy,
  withSelectedProjectBusy
} from "./actions-shared.js"
import { loadProjectBrowser, projectBrowserCdpUrl, projectBrowserNoVncUrl } from "./api.js"

const openUrl = (url: string): void => {
  if (typeof globalThis.open === "function") {
    globalThis.open(url, "_blank", "noopener")
  }
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
      openUrl(projectBrowserNoVncUrl(browser))
      context.setMessage(`Browser opened. CDP endpoint: ${projectBrowserCdpUrl(browser)}.`)
    }
  })
}

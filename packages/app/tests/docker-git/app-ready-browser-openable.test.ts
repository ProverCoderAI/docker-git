import { describe, expect, it } from "vitest"

import type { ProjectBrowserSession } from "../../src/web/api.js"
import {
  browserSidecarUnavailableMessage,
  canOpenProjectBrowser,
  canRunProjectBrowserAction
} from "../../src/web/app-ready-browser-openable.js"

const browser: ProjectBrowserSession = {
  cdpPath: "/api/projects/project-1/browser/cdp",
  cdpUrl: "ws://browser",
  containerName: "project-1-browser",
  noVncPath: "/api/projects/project-1/browser/novnc",
  noVncUrl: "https://browser/vnc.html",
  projectId: "project-1",
  projectKey: "org/repo",
  status: "running"
}

describe("browser open availability", () => {
  it("enables browser actions only for the running sidecar on the same project", () => {
    expect(canOpenProjectBrowser(browser, "project-1")).toBe(true)
    expect(canOpenProjectBrowser({ ...browser, status: "missing" }, "project-1")).toBe(false)
    expect(canOpenProjectBrowser(browser, "project-2")).toBe(false)
    expect(canOpenProjectBrowser(null, "project-1")).toBe(false)
  })

  it("gates only the browser menu action by sidecar availability", () => {
    expect(canRunProjectBrowserAction("Browser", browser, "project-1")).toBe(true)
    expect(canRunProjectBrowserAction("Browser", null, "project-1")).toBe(false)
    expect(canRunProjectBrowserAction("Info", null, "project-1")).toBe(true)
    expect(browserSidecarUnavailableMessage).toContain("Enable Playwright MCP")
  })
})

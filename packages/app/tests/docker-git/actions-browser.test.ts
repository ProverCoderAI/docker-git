import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import { openProjectBrowserById, openSelectedProjectBrowser } from "../../src/web/actions-browser.js"
import type { ProjectBrowserSession } from "../../src/web/api.js"
import { makeBrowserActionContext, waitForAssertion } from "./browser-action-context-fixture.js"
import { type BrowserOpenMockWindow, makeBrowserOpenMockWindow, stubBrowserOpen } from "./browser-open-fixture.js"

const loadProjectBrowserMock = vi.hoisted(() => vi.fn())
const startProjectBrowserMock = vi.hoisted(() => vi.fn())

vi.mock("../../src/web/api.js", () => ({
  loadProjectBrowser: loadProjectBrowserMock,
  projectBrowserCdpUrl: (browser: { readonly cdpPath: string }) => browser.cdpPath,
  projectBrowserNoVncUrl: (browser: { readonly noVncPath: string }) => browser.noVncPath,
  startProjectBrowser: startProjectBrowserMock
}))

const runningBrowser: ProjectBrowserSession = {
  cdpPath: "/api/projects/project-1/browser/cdp",
  cdpUrl: "ws://172.17.0.2:9222/devtools/browser/session",
  containerName: "dg-browser-project-1",
  noVncPath: "/api/projects/project-1/browser/novnc",
  noVncUrl: "https://172.17.0.2:6080/vnc.html",
  projectId: "project-1",
  projectKey: "octocat/hello-world",
  status: "running"
}

const missingBrowser: ProjectBrowserSession = {
  ...runningBrowser,
  cdpPath: "",
  cdpUrl: "",
  noVncPath: "",
  noVncUrl: "",
  status: "missing"
}

describe("web browser actions", () => {
  let openedWindow: BrowserOpenMockWindow = makeBrowserOpenMockWindow()

  beforeEach(() => {
    loadProjectBrowserMock.mockReset()
    startProjectBrowserMock.mockReset()
    openedWindow = makeBrowserOpenMockWindow()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it.effect("opens a running project browser by id", () =>
    Effect.gen(function*(_) {
      const openMock = stubBrowserOpen(openedWindow)
      startProjectBrowserMock.mockImplementation((projectId: string) =>
        Effect.succeed({ ...runningBrowser, projectId })
      )

      const { context, setMessage, setProjectBrowser } = makeBrowserActionContext({
        selectedProjectName: "octocat/hello-world"
      })

      openProjectBrowserById("project-1", context)

      yield* _(waitForAssertion(() => {
        expect(setProjectBrowser).toHaveBeenCalledWith(runningBrowser)
      }))

      expect(openMock).toHaveBeenCalledWith("about:blank", "_blank", "noopener")
      expect(openedWindow.location.href).toBe("/api/projects/project-1/browser/novnc")
      expect(setMessage).toHaveBeenLastCalledWith("Browser opened. CDP endpoint: /api/projects/project-1/browser/cdp.")
    }))

  it.effect("starts the project browser before reporting a non-running status", () =>
    Effect.gen(function*(_) {
      const openMock = stubBrowserOpen(openedWindow)
      startProjectBrowserMock.mockImplementation(() => Effect.succeed(missingBrowser))

      const { context, setMessage, setProjectBrowser } = makeBrowserActionContext({
        selectedProjectId: "project-1",
        selectedProjectName: "octocat/hello-world"
      })

      openSelectedProjectBrowser(context)

      yield* _(waitForAssertion(() => {
        expect(setProjectBrowser).toHaveBeenCalledWith(missingBrowser)
      }))

      expect(startProjectBrowserMock).toHaveBeenCalledWith("project-1")
      expect(openMock).toHaveBeenCalledWith("about:blank", "_blank", "noopener")
      expect(openedWindow.close).toHaveBeenCalledOnce()
      expect(setMessage).toHaveBeenLastCalledWith(
        "Browser runtime is missing. Enable Playwright MCP and start the project first."
      )
    }))

  it("does not call the browser endpoint when no project is selected", () => {
    const { context, setMessage } = makeBrowserActionContext()

    openSelectedProjectBrowser(context)

    expect(startProjectBrowserMock).not.toHaveBeenCalled()
    expect(setMessage).toHaveBeenLastCalledWith("No project selected.")
  })
})

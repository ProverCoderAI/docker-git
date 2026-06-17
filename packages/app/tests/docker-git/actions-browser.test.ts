/* jscpd:ignore-start */
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import * as fc from "fast-check"
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

const globalsCleanup = Effect.sync(() => {
  vi.unstubAllGlobals()
})

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

const pathSegmentChars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
const pathSegmentCharArbitrary = fc
  .integer({ max: pathSegmentChars.length - 1, min: 0 })
  .map((index) => pathSegmentChars.charAt(index))
const projectBrowserPathArbitrary = (suffix: string) =>
  fc
    .array(pathSegmentCharArbitrary, { minLength: 1, maxLength: 24 })
    .map((chars) => `/api/projects/${chars.join("")}/browser/${suffix}`)

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

      expect(openMock).toHaveBeenCalledWith("about:blank", "_blank")
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
      expect(openMock).toHaveBeenCalledWith("about:blank", "_blank")
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

  it.effect("keeps popup and browser state messages consistent for generated browser URLs", () =>
    Effect.tryPromise({
      catch: (error) => error,
      try: () =>
        fc.assert(
          fc.asyncProperty(
            projectBrowserPathArbitrary("novnc"),
            projectBrowserPathArbitrary("cdp"),
            fc.boolean(),
            fc.boolean(),
            (noVncPath, cdpPath, popupAllowed, useSelectedProject) =>
              Effect.runPromise(
                Effect.gen(function*(_) {
                  vi.unstubAllGlobals()
                  startProjectBrowserMock.mockReset()
                  loadProjectBrowserMock.mockReset()
                  openedWindow = makeBrowserOpenMockWindow()

                  if (popupAllowed) {
                    stubBrowserOpen(openedWindow)
                  } else {
                    vi.stubGlobal("open", null)
                  }

                  const browser = {
                    ...runningBrowser,
                    cdpPath,
                    noVncPath,
                    projectId: "project-1"
                  }
                  startProjectBrowserMock.mockImplementation(() => Effect.succeed(browser))
                  const { context, setMessage, setProjectBrowser } = makeBrowserActionContext({
                    selectedProjectId: "project-1",
                    selectedProjectName: "octocat/hello-world"
                  })

                  if (useSelectedProject) {
                    openSelectedProjectBrowser(context)
                  } else {
                    openProjectBrowserById("project-1", context)
                  }

                  yield* _(waitForAssertion(() => {
                    expect(setProjectBrowser).toHaveBeenCalledWith(browser)
                  }))

                  expect(startProjectBrowserMock).toHaveBeenCalledWith("project-1")
                  expect(setMessage).toHaveBeenLastCalledWith(
                    popupAllowed
                      ? `Browser opened. CDP endpoint: ${cdpPath}.`
                      : `Browser popup was blocked. Open ${noVncPath} manually. CDP endpoint: ${cdpPath}.`
                  )

                  if (popupAllowed) {
                    expect(openedWindow.location.href).toBe(noVncPath)
                    expect(openedWindow.focus).toHaveBeenCalledOnce()
                  }
                }).pipe(
                  Effect.ensuring(globalsCleanup)
                )
              )
          ),
          { numRuns: 20 }
        )
    }))
})
/* jscpd:ignore-end */

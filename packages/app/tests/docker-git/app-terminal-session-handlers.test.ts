import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { afterEach, beforeEach, vi } from "vitest"

import type { ProjectBrowserSession } from "../../src/web/api.js"
import {
  newProjectTerminalUrl,
  type ProjectHandlers,
  useProjectActionHandlers
} from "../../src/web/app-terminal-session-handlers.js"
import { waitForAssertion } from "./browser-action-context-fixture.js"
import { type BrowserOpenMockWindow, makeBrowserOpenMockWindow, stubBrowserOpen } from "./browser-open-fixture.js"

const terminalApiMocks = vi.hoisted(() => ({
  openSkiller: vi.fn(),
  projectBrowserCdpUrl: vi.fn(),
  projectBrowserNoVncUrl: vi.fn(),
  startProjectBrowser: vi.fn()
}))

vi.mock("../../src/web/api.js", () => ({
  applyProject: vi.fn(),
  createProjectTerminalSession: vi.fn(),
  loadProjectBrowser: vi.fn(),
  loadProjectTaskLogs: vi.fn(),
  loadProjectTasks: vi.fn(),
  openSkiller: terminalApiMocks.openSkiller,
  projectBrowserCdpUrl: terminalApiMocks.projectBrowserCdpUrl,
  projectBrowserNoVncUrl: terminalApiMocks.projectBrowserNoVncUrl,
  startProjectBrowser: terminalApiMocks.startProjectBrowser,
  stopProjectTask: vi.fn()
}))

const noopMessage = (_message: string | null): void => {}
const noopOpenTaskManager = (): void => {}

const buildHandlers = (
  overrides: Partial<Parameters<typeof useProjectActionHandlers>[0]> = {}
): ProjectHandlers =>
  useProjectActionHandlers({
    onOpenTaskManagerRequest: noopOpenTaskManager,
    projectId: "project-1",
    projectKey: "octocat/hello-world",
    projectLabel: "octocat/hello-world",
    setMessage: noopMessage,
    terminalSessionId: "session-1",
    ...overrides
  })

const skillerLaunch = () => ({
  alreadyRunning: false,
  appPath: "/api/ssh/session/session-1/skiller/app/",
  logPath: "/home/dev/.docker-git/logs/skiller.log",
  ok: true,
  pid: 1234,
  scope: {
    containerName: "dg-project",
    containerProjectPath: "/home/dev/app"
  },
  startedAtIso: "2026-05-09T17:30:00.000Z",
  trpcBasePath: "/api/ssh/session/session-1/skiller",
  trpcPort: 17_888
})

const runningBrowser: ProjectBrowserSession = {
  cdpPath: "/b/repo-issue-7/cdp/json/version",
  cdpUrl: "ws://browser",
  containerName: "dg-repo-issue-7-browser",
  noVncPath: "/b/repo-issue-7/vnc.html",
  noVncUrl: "https://browser/vnc.html",
  projectId: "project-1",
  projectKey: "repo-issue-7",
  status: "running"
}

type ExpectedProjectHandlers = {
  readonly apply: boolean
  readonly browser: boolean
  readonly skiller: boolean
  readonly taskManager: boolean
  readonly terminal: boolean
}

const expectOptionalHandler = (handler: (() => void) | undefined, isEnabled: boolean): void => {
  if (isEnabled) {
    expect(typeof handler).toBe("function")
    return
  }
  expect(handler).toBeUndefined()
}

const expectProjectHandlers = (handlers: ProjectHandlers, expected: ExpectedProjectHandlers): void => {
  expectOptionalHandler(handlers.onApplyProject, expected.apply)
  expectOptionalHandler(handlers.onOpenBrowser, expected.browser)
  expectOptionalHandler(handlers.onOpenSkiller, expected.skiller)
  expectOptionalHandler(handlers.onOpenTaskManager, expected.taskManager)
  expectOptionalHandler(handlers.onOpenTerminal, expected.terminal)
}

describe("useProjectActionHandlers", () => {
  let openedWindow: BrowserOpenMockWindow = makeBrowserOpenMockWindow()

  beforeEach(() => {
    vi.clearAllMocks()
    openedWindow = makeBrowserOpenMockWindow()
    stubBrowserOpen(openedWindow)
    terminalApiMocks.projectBrowserCdpUrl.mockImplementation((browser: ProjectBrowserSession) => browser.cdpPath)
    terminalApiMocks.projectBrowserNoVncUrl.mockImplementation((browser: ProjectBrowserSession) => browser.noVncPath)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("builds new terminal popups as project SSH links with a terminal selector", () => {
    expect(
      newProjectTerminalUrl("https://docker-git.local", "octocat/hello-world", "session-1")
    ).toBe("https://docker-git.local/ssh/octocat/hello-world?t=session-1")
  })

  it("returns all project action handlers when project context is present", () => {
    expectProjectHandlers(buildHandlers(), {
      apply: true,
      browser: true,
      skiller: true,
      taskManager: true,
      terminal: true
    })
  })

  it("hides all handlers when projectId is missing", () => {
    expectProjectHandlers(buildHandlers({ projectId: undefined }), {
      apply: false,
      browser: false,
      skiller: false,
      taskManager: false,
      terminal: false
    })
  })

  it("hides project-key dependent handlers when projectKey is missing", () => {
    expectProjectHandlers(buildHandlers({ projectKey: undefined }), {
      apply: true,
      browser: true,
      skiller: false,
      taskManager: true,
      terminal: false
    })
  })

  it("hides only onOpenSkiller when terminalSessionId is missing", () => {
    expectProjectHandlers(buildHandlers({ terminalSessionId: undefined }), {
      apply: true,
      browser: true,
      skiller: false,
      taskManager: true,
      terminal: true
    })
  })

  it("wires onOpenTaskManager to the supplied request callback", () => {
    let opened = 0
    const handlers = buildHandlers({
      onOpenTaskManagerRequest: () => {
        opened += 1
      }
    })
    handlers.onOpenTaskManager?.()
    expect(opened).toBe(1)
  })

  it.effect("opens Skiller for the current terminal session", () =>
    Effect.gen(function*(_) {
      const setMessage = vi.fn()
      terminalApiMocks.openSkiller.mockImplementation(() => Effect.succeed(skillerLaunch()))
      const handlers = buildHandlers({ setMessage })

      expect(typeof handlers.onOpenSkiller).toBe("function")
      handlers.onOpenSkiller?.()

      expect(openedWindow.opener).toBeNull()
      expect(setMessage).toHaveBeenCalledWith("Opening Skiller...")
      yield* _(waitForAssertion(() => {
        expect(terminalApiMocks.openSkiller).toHaveBeenCalledWith("octocat/hello-world", "session-1")
        expect(openedWindow.location.href).toBe("/api/ssh/session/session-1/skiller/app/")
        expect(setMessage).toHaveBeenCalledWith(
          "Skiller launch started (pid 1234). Log: /home/dev/.docker-git/logs/skiller.log. Container FS: dg-project:/home/dev/app. Opened /api/ssh/session/session-1/skiller/app/."
        )
      }))
    }))

  it.effect("starts and opens the browser from a terminal action", () =>
    Effect.gen(function*(_) {
      const setMessage = vi.fn()
      terminalApiMocks.startProjectBrowser.mockImplementation(() => Effect.succeed(runningBrowser))
      const handlers = buildHandlers({ setMessage })

      expect(typeof handlers.onOpenBrowser).toBe("function")
      handlers.onOpenBrowser?.()

      expect(openedWindow.opener).toBeNull()
      yield* _(waitForAssertion(() => {
        expect(terminalApiMocks.startProjectBrowser).toHaveBeenCalledWith("project-1")
        expect(openedWindow.location.href).toBe("/b/repo-issue-7/vnc.html")
        expect(setMessage).toHaveBeenCalledWith(
          "Browser opened. CDP endpoint: /b/repo-issue-7/cdp/json/version."
        )
      }))
    }))
})

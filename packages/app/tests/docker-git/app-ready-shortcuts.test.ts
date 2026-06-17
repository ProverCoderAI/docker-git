import { describe, expect, it, vi } from "vitest"

import { createInitialFlowView } from "../../src/docker-git/menu-create-shared.js"
import type { DashboardData } from "../../src/web/api.js"
import { type BrowserShortcutArgs, dispatchBrowserShortcut } from "../../src/web/app-ready-shortcut-runtime.js"
import {
  handleMenuNavigationKey,
  handleProjectNavigationKey,
  shortcutHintText,
  type ShortcutKeyboardEvent,
  shouldRefreshProjectDetails,
  usesProjectPrimaryNavigation
} from "../../src/web/app-ready-shortcuts.js"
import { makeBrowserActionContext } from "./browser-action-context-fixture.js"

const makeEvent = (key: string): ShortcutKeyboardEvent => {
  const event: ShortcutKeyboardEvent = {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key,
    metaKey: false,
    shiftKey: false,
    target: null,
    preventDefault: () => {
      event.defaultPrevented = true
    }
  }
  return event
}

const runProjectNavigation = (projectNavigationArmed: boolean) => {
  const event = makeEvent("ArrowDown")
  const setSelectedProjectId = vi.fn()
  const isHandled = handleProjectNavigationKey(event, {
    currentMenu: "Select",
    dashboard,
    projectNavigationArmed,
    selectedProjectId: "project-a",
    setSelectedProjectId
  })

  return { handled: isHandled, setSelectedProjectId }
}

const storedTerminalSession: BrowserShortcutArgs["terminalSessions"][number] = {
  closePath: "/projects/by-key/project-a-key/terminal-sessions/session-1",
  exitMessage: "ended",
  header: "SSH terminal: org/repo-a",
  pendingDeleteMessage: "closed",
  readyMessage: "ready",
  session: {
    createdAt: "2026-05-05T00:00:00.000Z",
    id: "session-1",
    projectId: "project-a",
    sshCommand: "ssh dev@127.0.0.1",
    status: "ready"
  },
  subtitle: "ssh dev@127.0.0.1",
  websocketPath: "/projects/by-key/project-a-key/terminal-sessions/session-1/ws"
}

const makeShortcutArgs = (
  activeTerminalSessionId: string | null,
  setSelectedProjectId: BrowserShortcutArgs["setSelectedProjectId"]
): BrowserShortcutArgs => {
  const { context } = makeBrowserActionContext({ selectedProjectId: "project-a" })
  return {
    activeScreen: { tag: "ProjectPicker" },
    activeTerminalSessionId,
    actionPrompt: null,
    context,
    controllerCwd: "/repo",
    createView: createInitialFlowView(""),
    currentMenu: "Tasks",
    dashboard,
    projectBrowser: null,
    projectsRoot: "/home/dev/.docker-git",
    selectedProjectId: "project-a",
    setActiveScreen: vi.fn(),
    setCreateView: vi.fn(),
    setProjectNavigationArmed: vi.fn(),
    setSelectedMenuIndex: vi.fn(),
    setSelectedProjectId,
    terminalSessions: [storedTerminalSession]
  }
}

const dashboard: DashboardData = {
  apiBaseUrl: "/api",
  health: {
    cwd: process.cwd(),
    ok: true,
    projectsRoot: "/home/dev/.docker-git",
    revision: null
  },
  projects: [
    {
      clonedOnHostname: "host",
      displayName: "org/repo-a",
      id: "project-a",
      projectKey: "project-a-key",
      repoUrl: "https://github.com/org/repo-a.git",
      repoRef: "main",
      sshSessions: 0,
      startedAtEpochMs: null,
      startedAtIso: null,
      status: "stopped",
      statusLabel: "Stopped"
    },
    {
      clonedOnHostname: "host",
      displayName: "org/repo-b",
      id: "project-b",
      projectKey: "project-b-key",
      repoUrl: "https://github.com/org/repo-b.git",
      repoRef: "main",
      sshSessions: 1,
      startedAtEpochMs: null,
      startedAtIso: null,
      status: "running",
      statusLabel: "Up"
    }
  ]
}

describe("app-ready-shortcuts", () => {
  it("uses project-first arrows in Select-like screens", () => {
    expect(usesProjectPrimaryNavigation("Select")).toBe(true)
    expect(usesProjectPrimaryNavigation("Info")).toBe(true)
    expect(usesProjectPrimaryNavigation("Ports")).toBe(true)
    expect(usesProjectPrimaryNavigation("Databases")).toBe(true)
    expect(usesProjectPrimaryNavigation("Browser")).toBe(true)
    expect(usesProjectPrimaryNavigation("Tasks")).toBe(true)
    expect(usesProjectPrimaryNavigation("ProjectAuth")).toBe(true)
    expect(usesProjectPrimaryNavigation("Logs")).toBe(true)
    expect(usesProjectPrimaryNavigation("Create")).toBe(false)
    expect(usesProjectPrimaryNavigation("Share")).toBe(false)
  })

  it("does not move projects in Select until project mode is armed", () => {
    const { handled: isHandled, setSelectedProjectId } = runProjectNavigation(false)

    expect(isHandled).toBe(false)
    expect(setSelectedProjectId).not.toHaveBeenCalled()
  })

  it("moves projects with up/down in armed Select", () => {
    const { handled: isHandled, setSelectedProjectId } = runProjectNavigation(true)

    expect(isHandled).toBe(true)
    expect(setSelectedProjectId).toHaveBeenCalledWith("project-b")
  })

  it("moves menu with left/right in Select", () => {
    const event = makeEvent("ArrowDown")
    const setSelectedMenuIndex = vi.fn()

    const isHandled = handleMenuNavigationKey(event, "Select", false, setSelectedMenuIndex)

    expect(isHandled).toBe(true)
    expect(setSelectedMenuIndex).toHaveBeenCalledTimes(1)
  })

  it("stops menu movement in armed Select", () => {
    const event = makeEvent("ArrowDown")
    const setSelectedMenuIndex = vi.fn()

    const isHandled = handleMenuNavigationKey(event, "Select", true, setSelectedMenuIndex)

    expect(isHandled).toBe(false)
    expect(setSelectedMenuIndex).not.toHaveBeenCalled()
  })

  it("keeps only menu arrows outside Select", () => {
    const menuEvent = makeEvent("ArrowDown")
    const projectEvent = makeEvent("ArrowRight")
    const setSelectedMenuIndex = vi.fn()
    const setSelectedProjectId = vi.fn()

    expect(handleMenuNavigationKey(menuEvent, "Create", false, setSelectedMenuIndex)).toBe(true)
    expect(handleProjectNavigationKey(projectEvent, {
      currentMenu: "Create",
      dashboard,
      projectNavigationArmed: false,
      selectedProjectId: "project-a",
      setSelectedProjectId
    })).toBe(false)
  })

  it("renders dynamic shortcut hint", () => {
    expect(shortcutHintText("Select", false)).toBe("↑/↓ menu, Enter/→ choose project")
    expect(shortcutHintText("Select", true)).toBe("↑/↓ project, Enter run, Esc/← back")
    expect(shortcutHintText("Create", false)).toBe("↑/↓ menu")
  })

  it("autoloads selected project details on project tabs after dashboard refresh", () => {
    expect(shouldRefreshProjectDetails("Info", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("ProjectAuth", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Select", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Ports", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Databases", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Browser", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Select", true, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Status", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Logs", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Tasks", false, "project-a", null)).toBe(true)
    expect(shouldRefreshProjectDetails("Share", false, "project-a", null)).toBe(false)
    expect(shouldRefreshProjectDetails("Info", false, null, null)).toBe(false)
  })

  it("allows shortcuts when terminal sessions are stored but inactive", () => {
    const event = makeEvent("ArrowDown")
    const setSelectedProjectId = vi.fn()
    const args = makeShortcutArgs(null, setSelectedProjectId)

    dispatchBrowserShortcut(event, args)

    expect(setSelectedProjectId).toHaveBeenCalledWith("project-b")
  })

  it("blocks global shortcuts while a terminal workspace is active", () => {
    const event = makeEvent("ArrowDown")
    const setSelectedProjectId = vi.fn()
    const args = makeShortcutArgs("session-1", setSelectedProjectId)

    dispatchBrowserShortcut(event, args)

    expect(setSelectedProjectId).not.toHaveBeenCalled()
  })

  it("skips selected project details when the same project is already loaded", () => {
    expect(shouldRefreshProjectDetails("Select", false, "project-a", { id: "project-a" })).toBe(false)
    expect(shouldRefreshProjectDetails("Info", false, "project-a", { id: "project-b" })).toBe(true)
    expect(shouldRefreshProjectDetails("Info", false, null, { id: "project-a" })).toBe(false)
  })
})

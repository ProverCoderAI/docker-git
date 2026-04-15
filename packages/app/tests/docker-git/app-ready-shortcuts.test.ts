import { describe, expect, it, vi } from "vitest"

import type { DashboardData } from "../../src/web/api.js"
import {
  handleMenuNavigationKey,
  handleProjectNavigationKey,
  shortcutHintText,
  type ShortcutKeyboardEvent,
  shouldRefreshProjectDetails,
  usesProjectPrimaryNavigation
} from "../../src/web/app-ready-shortcuts.js"

const makeEvent = (key: string): ShortcutKeyboardEvent => {
  const event: ShortcutKeyboardEvent = {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key,
    metaKey: false,
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
  const handled = handleProjectNavigationKey(event, {
    currentMenu: "Select",
    dashboard,
    projectNavigationArmed,
    selectedProjectId: "project-a",
    setSelectedProjectId
  })

  return { handled, setSelectedProjectId }
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
    expect(usesProjectPrimaryNavigation("Browser")).toBe(true)
    expect(usesProjectPrimaryNavigation("ProjectAuth")).toBe(true)
    expect(usesProjectPrimaryNavigation("Logs")).toBe(true)
    expect(usesProjectPrimaryNavigation("Create")).toBe(false)
  })

  it("does not move projects in Select until project mode is armed", () => {
    const { handled, setSelectedProjectId } = runProjectNavigation(false)

    expect(handled).toBe(false)
    expect(setSelectedProjectId).not.toHaveBeenCalled()
  })

  it("moves projects with up/down in armed Select", () => {
    const { handled, setSelectedProjectId } = runProjectNavigation(true)

    expect(handled).toBe(true)
    expect(setSelectedProjectId).toHaveBeenCalledWith("project-b")
  })

  it("moves menu with left/right in Select", () => {
    const event = makeEvent("ArrowDown")
    const setSelectedMenuIndex = vi.fn()

    const handled = handleMenuNavigationKey(event, "Select", false, setSelectedMenuIndex)

    expect(handled).toBe(true)
    expect(setSelectedMenuIndex).toHaveBeenCalledTimes(1)
  })

  it("stops menu movement in armed Select", () => {
    const event = makeEvent("ArrowDown")
    const setSelectedMenuIndex = vi.fn()

    const handled = handleMenuNavigationKey(event, "Select", true, setSelectedMenuIndex)

    expect(handled).toBe(false)
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
    expect(shouldRefreshProjectDetails("Info", false, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("ProjectAuth", false, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("Select", false, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("Ports", false, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("Browser", false, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("Select", true, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("Status", false, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("Logs", false, "project-a")).toBe(true)
    expect(shouldRefreshProjectDetails("Info", false, null)).toBe(false)
  })
})

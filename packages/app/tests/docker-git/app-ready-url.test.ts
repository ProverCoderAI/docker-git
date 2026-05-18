import { describe, expect, it } from "vitest"

import type { DashboardData } from "../../src/web/api.js"
import { parseReadyUrlNavigation, readyUrlPath } from "../../src/web/app-ready-url.js"

const dashboard: DashboardData = {
  apiBaseUrl: "/api",
  health: {
    cwd: "/repo",
    ok: true,
    projectsRoot: "/home/dev/.docker-git",
    revision: null
  },
  projects: [
    {
      clonedOnHostname: "host",
      displayName: "octocat/hello-world",
      id: "project-1",
      projectKey: "octocat/hello-world",
      repoRef: "main",
      repoUrl: "https://github.com/octocat/Hello-World.git",
      sshSessions: 0,
      startedAtEpochMs: null,
      startedAtIso: null,
      status: "running",
      statusLabel: "Up"
    }
  ]
}

const selectedProjectSummary = dashboard.projects[0]

describe("app ready URL state", () => {
  it("renders menu tab highlights as copyable URLs", () => {
    expect(readyUrlPath({
      activeScreen: { tag: "Menu" },
      activeTerminalSession: null,
      currentMenu: "Browser",
      selectedProjectId: null,
      selectedProjectSummary: undefined
    })).toBe("/menu/browser")
  })

  it("renders selected project tabs as readable deep links", () => {
    expect(readyUrlPath({
      activeScreen: { tag: "ProjectPicker" },
      activeTerminalSession: null,
      currentMenu: "Browser",
      selectedProjectId: "project-1",
      selectedProjectSummary
    })).toBe("/browser/octocat/hello-world")
  })

  it("renders database project tabs as readable deep links", () => {
    expect(readyUrlPath({
      activeScreen: { tag: "ProjectPicker" },
      activeTerminalSession: null,
      currentMenu: "Databases",
      selectedProjectId: "project-1",
      selectedProjectSummary
    })).toBe("/databases/octocat/hello-world")
  })

  it("renders active SSH project terminals as stable project SSH links", () => {
    expect(readyUrlPath({
      activeScreen: { tag: "ProjectPicker" },
      activeTerminalSession: {
        browserProjectId: "project-1",
        browserProjectKey: "octocat/hello-world",
        closePath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1",
        exitMessage: "done",
        header: "SSH terminal: octocat/hello-world",
        pendingDeleteMessage: "closed",
        readyMessage: "ready",
        sessionPath: "/ssh/session/session-1",
        session: {
          createdAt: "2026-04-15T00:00:00.000Z",
          id: "session-1",
          projectId: "project-1",
          sshCommand: "ssh dev@127.0.0.1",
          status: "attached"
        },
        subtitle: "ssh dev@127.0.0.1",
        websocketPath: "/projects/by-key/octocat%2Fhello-world/terminal-sessions/session-1/ws"
      },
      currentMenu: "Select",
      selectedProjectId: "project-1",
      selectedProjectSummary
    })).toBe("/ssh/octocat/hello-world?t=session-1")
  })

  it("renders SSH project selection as a project terminal list deep link", () => {
    expect(readyUrlPath({
      activeScreen: { tag: "ProjectPicker" },
      activeTerminalSession: null,
      currentMenu: "Select",
      selectedProjectId: "project-1",
      selectedProjectSummary
    })).toBe("/ssh/octocat/hello-world")
  })

  it("parses project tab URLs back into app navigation state", () => {
    expect(parseReadyUrlNavigation("https://docker-git.local/browser/octocat/hello-world", dashboard.projects)).toEqual(
      {
        activeScreen: { tag: "ProjectPicker" },
        menu: "Browser",
        projectNavigationArmed: false,
        selectedProjectId: "project-1"
      }
    )
  })

  it("keeps /ssh links owned by SSH auto-connect flow", () => {
    expect(parseReadyUrlNavigation("https://docker-git.local/ssh/octocat/hello-world", dashboard.projects)).toBeNull()
    expect(parseReadyUrlNavigation("https://docker-git.local/?ssh=octocat/hello-world", dashboard.projects)).toBeNull()
  })

  it("keeps database proxy links owned by the DbGate proxy", () => {
    expect(parseReadyUrlNavigation("https://docker-git.local/d/abc123abc123/", dashboard.projects)).toBeNull()
  })
})

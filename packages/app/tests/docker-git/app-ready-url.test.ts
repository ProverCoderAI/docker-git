import * as fc from "fast-check"
import { describe, expect, it } from "vitest"

import type { DashboardData } from "../../src/web/api.js"
import { activeScreenFromMenu, parseReadyUrlNavigation, readyUrlPath } from "../../src/web/app-ready-url.js"
import { browserMenuOrder, type BrowserMenuTag } from "../../src/web/menu.js"
import { browserProjectMenuTags, isProjectMenu, menuScreen, outputScreen } from "../../src/web/screen.js"

type ReadyUrlPathInput = Parameters<typeof readyUrlPath>[0]
type ParsedReadyNavigation = NonNullable<ReturnType<typeof parseReadyUrlNavigation>>

type ProjectSelection = Pick<ReadyUrlPathInput, "selectedProjectId" | "selectedProjectSummary"> & {
  readonly expectedSelectedProjectId: string | null
}

type ReadyUrlRoundTripCase = {
  readonly expected: ParsedReadyNavigation
  readonly state: ReadyUrlPathInput
}

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

const projectActionMenuTags = browserProjectMenuTags.filter((menu) => menu !== "Select")
const nonProjectMenuTags = browserMenuOrder.filter((menu) => !isProjectMenu(menu))

const emptyProjectSelection: ProjectSelection = {
  expectedSelectedProjectId: null,
  selectedProjectId: null,
  selectedProjectSummary: undefined
}

const selectedProjectSelection: ProjectSelection = {
  expectedSelectedProjectId: "project-1",
  selectedProjectId: "project-1",
  selectedProjectSummary
}

const projectSelectionArbitrary: fc.Arbitrary<ProjectSelection> = fc.constantFrom(
  emptyProjectSelection,
  selectedProjectSelection
)

const projectActionCaseArbitrary = fc.oneof(
  fc.tuple(fc.constantFrom(...projectActionMenuTags), projectSelectionArbitrary),
  fc.tuple(fc.constant<BrowserMenuTag>("Select"), fc.constant(selectedProjectSelection))
)

const readyUrlMenuRoundTripArbitrary: fc.Arbitrary<ReadyUrlRoundTripCase> = fc.constantFrom(...browserMenuOrder)
  .map((menu) => ({
    expected: {
      activeScreen: menuScreen(),
      menu,
      projectNavigationArmed: false,
      selectedProjectId: null
    },
    state: {
      activeScreen: menuScreen(),
      activeTerminalSession: null,
      currentMenu: menu,
      selectedProjectId: null,
      selectedProjectSummary: undefined
    }
  }))

const readyUrlActionRoundTripArbitrary: fc.Arbitrary<ReadyUrlRoundTripCase> = fc.oneof(
  fc.constantFrom(...nonProjectMenuTags).map((menu) => ({
    expected: {
      activeScreen: activeScreenFromMenu(menu, false),
      menu,
      projectNavigationArmed: false,
      selectedProjectId: null
    },
    state: {
      activeScreen: activeScreenFromMenu(menu, false),
      activeTerminalSession: null,
      currentMenu: menu,
      selectedProjectId: null,
      selectedProjectSummary: undefined
    }
  })),
  projectActionCaseArbitrary.map(([menu, selection]) => ({
    expected: {
      activeScreen: activeScreenFromMenu(menu, false),
      menu,
      projectNavigationArmed: false,
      selectedProjectId: selection.expectedSelectedProjectId
    },
    state: {
      activeScreen: activeScreenFromMenu(menu, false),
      activeTerminalSession: null,
      currentMenu: menu,
      selectedProjectId: selection.selectedProjectId,
      selectedProjectSummary: selection.selectedProjectSummary
    }
  })),
  fc.tuple(fc.constantFrom<BrowserMenuTag>("Logs", "Status"), projectSelectionArbitrary).map(([menu, selection]) => ({
    expected: {
      activeScreen: outputScreen(),
      menu,
      projectNavigationArmed: false,
      selectedProjectId: selection.expectedSelectedProjectId
    },
    state: {
      activeScreen: outputScreen(),
      activeTerminalSession: null,
      currentMenu: menu,
      selectedProjectId: selection.selectedProjectId,
      selectedProjectSummary: selection.selectedProjectSummary
    }
  }))
)

const readyUrlRoundTripArbitrary: fc.Arbitrary<ReadyUrlRoundTripCase> = fc.oneof(
  readyUrlMenuRoundTripArbitrary,
  readyUrlActionRoundTripArbitrary
)

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

  it("renders share panel URLs without project selection", () => {
    expect(readyUrlPath({
      activeScreen: { tag: "Share" },
      activeTerminalSession: null,
      currentMenu: "Share",
      selectedProjectId: null,
      selectedProjectSummary: undefined
    })).toBe("/share")
    expect(parseReadyUrlNavigation("https://docker-git.local/share", dashboard.projects)).toEqual({
      activeScreen: { tag: "Share" },
      menu: "Share",
      projectNavigationArmed: false,
      selectedProjectId: null
    })
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

  it("renders Select project deep link for non-terminal sessions", () => {
    expect(readyUrlPath({
      activeScreen: { tag: "ProjectPicker" },
      activeTerminalSession: null,
      currentMenu: "Select",
      selectedProjectId: "project-1",
      selectedProjectSummary
    })).toBe("/select/octocat/hello-world")
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

  it("parses Select project URLs back into app navigation state", () => {
    expect(parseReadyUrlNavigation("https://docker-git.local/select/octocat/hello-world", dashboard.projects)).toEqual(
      {
        activeScreen: { tag: "ProjectPicker" },
        menu: "Select",
        projectNavigationArmed: false,
        selectedProjectId: "project-1"
      }
    )
  })

  /**
   * THEOREM (ready URL round-trip):
   * For all generated ValidNavigationState values, parsing readyUrlPath(state)
   * returns normalize(state), where activeTerminalSession and
   * selectedProjectSummary are URL construction inputs, not persisted fields.
   */
  it("preserves ready URL round-trip invariants for valid navigation states", () => {
    fc.assert(
      fc.property(readyUrlRoundTripArbitrary, ({ expected, state }) => {
        const path = readyUrlPath(state)

        if (path === null) {
          throw new Error("readyUrlPath returned null for a generated valid navigation state")
        }
        expect(parseReadyUrlNavigation(`https://docker-git.local${path}`, dashboard.projects)).toEqual(expected)
      }),
      { numRuns: 75 }
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

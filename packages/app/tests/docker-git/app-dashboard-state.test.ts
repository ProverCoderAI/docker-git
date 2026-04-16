import { describe, expect, it } from "@effect/vitest"

import type { DashboardData } from "../../src/web/api.js"
import { type DashboardState, mergeDashboardRefreshState } from "../../src/web/app-dashboard-state.js"

const dashboard: DashboardData = {
  apiBaseUrl: "/api",
  health: {
    cwd: "/home/dev",
    ok: true,
    projectsRoot: "/home/dev/workspaces",
    revision: "rev"
  },
  projects: []
}

describe("web dashboard state", () => {
  it("keeps the ready screen mounted when a background refresh fails", () => {
    const ready: DashboardState = {
      _tag: "Ready",
      dashboard,
      refreshedAtMs: 10
    }
    const error: DashboardState = {
      _tag: "Error",
      apiBaseUrl: "/api",
      message: "temporary tunnel failure"
    }

    expect(mergeDashboardRefreshState(ready, error)).toBe(ready)
  })

  it("still surfaces initial loading failures", () => {
    const loading: DashboardState = {
      _tag: "Loading",
      apiBaseUrl: "/api"
    }
    const error: DashboardState = {
      _tag: "Error",
      apiBaseUrl: "/api",
      message: "api unavailable"
    }

    expect(mergeDashboardRefreshState(loading, error)).toBe(error)
  })
})

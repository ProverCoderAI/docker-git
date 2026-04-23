import { describe, expect, it } from "vitest"

import { buildSelectLabels, buildSelectListWindow } from "../../src/docker-git/menu-render-select.js"
import { filterProjectItemsByQuery } from "../../src/docker-git/menu-select-filter.js"
import { sortItemsByLaunchTime, sortSelectItemsByLaunchTime } from "../../src/docker-git/menu-select-order.js"
import type { SelectProjectRuntime } from "../../src/docker-git/menu-types.js"
import type { ProjectSummary } from "../../src/web/api-schema.js"
import { sortDashboardProjects } from "../../src/web/api.js"
import { filterProjectSummariesByQuery } from "../../src/web/project-search.js"
import { makeProjectItem } from "./fixtures/project-item.js"

const makeRuntime = (
  overrides: Partial<SelectProjectRuntime> = {}
): SelectProjectRuntime => ({
  running: false,
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null,
  ...overrides
})

const emitProof = (message: string): void => {
  process.stdout.write(`[issue-57-proof] ${message}\n`)
}

const makeProjectSummary = (
  overrides: Partial<ProjectSummary> = {}
): ProjectSummary => ({
  id: "/home/dev/.docker-git/org-repo",
  projectKey: "org-repo",
  displayName: "org/repo",
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  containerName: "dg-org-repo",
  status: "stopped",
  statusLabel: "last known: stopped",
  sshSessions: 0,
  startedAtIso: null,
  startedAtEpochMs: null,
  ...overrides
})

describe("menu-select order", () => {
  it("sorts projects by last container start time (newest first)", () => {
    const newest = makeProjectItem({ projectDir: "/home/dev/.docker-git/newest", displayName: "org/newest" })
    const older = makeProjectItem({ projectDir: "/home/dev/.docker-git/older", displayName: "org/older" })
    const neverStarted = makeProjectItem({ projectDir: "/home/dev/.docker-git/never", displayName: "org/never" })
    const startedNewest = "2026-02-17T11:30:00Z"
    const startedOlder = "2026-02-16T07:15:00Z"
    const runtimeByProject: Readonly<Record<string, SelectProjectRuntime>> = {
      [newest.projectDir]: makeRuntime({
        running: true,
        sshSessions: 1,
        startedAtIso: startedNewest,
        startedAtEpochMs: Date.parse(startedNewest)
      }),
      [older.projectDir]: makeRuntime({
        running: true,
        sshSessions: 0,
        startedAtIso: startedOlder,
        startedAtEpochMs: Date.parse(startedOlder)
      }),
      [neverStarted.projectDir]: makeRuntime()
    }

    const sorted = sortItemsByLaunchTime([neverStarted, older, newest], runtimeByProject)
    expect(sorted.map((item) => item.projectDir)).toEqual([
      newest.projectDir,
      older.projectDir,
      neverStarted.projectDir
    ])
    emitProof("sorting by launch time works: newest container is selected first")
  })

  it("uses the same launch-time comparator for non-CLI project shapes", () => {
    const newest = { key: "newest", name: "org/newest" }
    const runningTie = { key: "running-tie", name: "org/running" }
    const stoppedTie = { key: "stopped-tie", name: "org/stopped" }
    const alpha = { key: "alpha", name: "org/alpha" }
    const sameNameA = { key: "a-key", name: "org/same" }
    const sameNameZ = { key: "z-key", name: "org/same" }
    const runtimeByProject: Readonly<Record<string, SelectProjectRuntime>> = {
      [newest.key]: makeRuntime({ startedAtEpochMs: 200 }),
      [runningTie.key]: makeRuntime({ running: true, startedAtEpochMs: 100 }),
      [stoppedTie.key]: makeRuntime({ running: false, startedAtEpochMs: 100 })
    }

    const sorted = sortSelectItemsByLaunchTime(
      [sameNameZ, stoppedTie, alpha, sameNameA, runningTie, newest],
      runtimeByProject,
      {
        displayName: (item) => item.name,
        projectKey: (item) => item.key
      }
    )

    expect(sorted.map((item) => item.key)).toEqual([
      newest.key,
      runningTie.key,
      stoppedTie.key,
      alpha.key,
      sameNameA.key,
      sameNameZ.key
    ])
  })

  it("orders WEB dashboard projects with the shared Select comparator", () => {
    const newest = makeProjectSummary({
      id: "/home/dev/.docker-git/newest",
      projectKey: "newest",
      displayName: "org/newest",
      status: "running",
      statusLabel: "last known: running",
      startedAtIso: "2026-04-21T11:30:00.000Z",
      startedAtEpochMs: Date.parse("2026-04-21T11:30:00.000Z")
    })
    const older = makeProjectSummary({
      id: "/home/dev/.docker-git/older",
      projectKey: "older",
      displayName: "org/older",
      startedAtIso: "2026-04-20T08:00:00.000Z",
      startedAtEpochMs: Date.parse("2026-04-20T08:00:00.000Z")
    })
    const neverStarted = makeProjectSummary({
      id: "/home/dev/.docker-git/never",
      projectKey: "never",
      displayName: "org/never"
    })

    const sorted = sortDashboardProjects([neverStarted, older, newest])

    expect(sorted.map((project) => project.id)).toEqual([
      newest.id,
      older.id,
      neverStarted.id
    ])
  })

  it("filters CLI Select projects by container name", () => {
    const api = makeProjectItem({
      projectDir: "/home/dev/.docker-git/api",
      displayName: "org/api",
      containerName: "dg-api-main"
    })
    const web = makeProjectItem({
      projectDir: "/home/dev/.docker-git/web",
      displayName: "org/web",
      containerName: "dg-web-main"
    })

    const filtered = filterProjectItemsByQuery([api, web], "web main")

    expect(filtered.map((project) => project.projectDir)).toEqual([web.projectDir])
  })

  it("filters WEB dashboard projects with the same container-name semantics", () => {
    const api = makeProjectSummary({
      id: "/home/dev/.docker-git/api",
      projectKey: "api",
      displayName: "org/api",
      containerName: "dg-api-main"
    })
    const web = makeProjectSummary({
      id: "/home/dev/.docker-git/web",
      projectKey: "web",
      displayName: "org/web",
      containerName: "dg-web-main"
    })

    const filtered = filterProjectSummariesByQuery([api, web], "dg web")

    expect(filtered.map((project) => project.id)).toEqual([web.id])
  })

  it("shows container launch timestamp in select labels", () => {
    const item = makeProjectItem({ projectDir: "/home/dev/.docker-git/example", displayName: "org/example" })
    const startedAtIso = "2026-02-17T09:45:00Z"
    const runtimeByProject: Readonly<Record<string, SelectProjectRuntime>> = {
      [item.projectDir]: makeRuntime({
        running: true,
        sshSessions: 2,
        startedAtIso,
        startedAtEpochMs: Date.parse(startedAtIso)
      })
    }

    const connectLabel = buildSelectLabels([item], 0, "Connect", runtimeByProject)[0]
    const downLabel = buildSelectLabels([item], 0, "Down", runtimeByProject)[0]

    expect(connectLabel).toContain("[started=2026-02-17 09:45 UTC]")
    expect(downLabel).toContain("running, ssh=2, started=2026-02-17 09:45 UTC")
    emitProof("UI labels show container start timestamp in Connect and Down views")
  })

  it("keeps full list visible when projects fit into viewport", () => {
    const window = buildSelectListWindow(8, 3, 12)
    expect(window).toEqual({ start: 0, end: 8 })
  })

  it("computes a scrolling window around selected project", () => {
    expect(buildSelectListWindow(30, 0, 10)).toEqual({ start: 0, end: 10 })
    expect(buildSelectListWindow(30, 15, 10)).toEqual({ start: 10, end: 20 })
    expect(buildSelectListWindow(30, 29, 10)).toEqual({ start: 20, end: 30 })
  })
})

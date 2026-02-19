import { describe, expect, it } from "vitest"

import { buildSelectLabels, buildSelectListWindow } from "../../src/docker-git/menu-render-select.js"
import { sortItemsByLaunchTime } from "../../src/docker-git/menu-select-order.js"
import type { SelectProjectRuntime } from "../../src/docker-git/menu-types.js"
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

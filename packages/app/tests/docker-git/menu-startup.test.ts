import { describe, expect, it } from "vitest"

import { resolveMenuStartupSnapshot } from "../../src/docker-git/menu-startup.js"
import { makeProjectItem } from "./fixtures/project-item.js"

describe("menu-startup", () => {
  it("returns empty snapshot when no docker-git containers are running", () => {
    const snapshot = resolveMenuStartupSnapshot([makeProjectItem({ status: "stopped" })])

    expect(snapshot).toEqual({
      activeDir: null,
      runningDockerGitContainers: 0,
      message: null
    })
  })

  it("auto-selects active project when exactly one known docker-git container is running", () => {
    const item = makeProjectItem({ status: "running", statusLabel: "Up 1 minute" })
    const snapshot = resolveMenuStartupSnapshot([item])

    expect(snapshot.activeDir).toBe(item.projectDir)
    expect(snapshot.runningDockerGitContainers).toBe(1)
    expect(snapshot.message).toContain(item.displayName)
  })

  it("does not auto-select when multiple docker-git containers are running", () => {
    const first = makeProjectItem({
      containerName: "dg-one",
      displayName: "org/one",
      projectDir: "/home/dev/.docker-git/org-one"
    })
    const second = makeProjectItem({
      containerName: "dg-two",
      displayName: "org/two",
      projectDir: "/home/dev/.docker-git/org-two",
      status: "running",
      statusLabel: "Up 2 minutes"
    })
    const snapshot = resolveMenuStartupSnapshot([
      { ...first, status: "running", statusLabel: "Up 1 minute" },
      second
    ])

    expect(snapshot.activeDir).toBeNull()
    expect(snapshot.runningDockerGitContainers).toBe(2)
    expect(snapshot.message).toContain("Use Select project")
  })

  it("keeps an empty snapshot when API reports no running projects", () => {
    const snapshot = resolveMenuStartupSnapshot([])

    expect(snapshot).toEqual({
      activeDir: null,
      runningDockerGitContainers: 0,
      message: null
    })
  })
})

import { describe, expect, it } from "vitest"

import { resolveMenuStartupSnapshot } from "../../src/docker-git/menu-startup.js"
import { makeProjectItem } from "./fixtures/project-item.js"

describe("menu-startup", () => {
  it("returns empty snapshot when no docker-git containers are running", () => {
    const snapshot = resolveMenuStartupSnapshot([makeProjectItem({})], ["postgres", "redis"])

    expect(snapshot).toEqual({
      activeDir: null,
      runningDockerGitContainers: 0,
      message: null
    })
  })

  it("auto-selects active project when exactly one known docker-git container is running", () => {
    const item = makeProjectItem({})
    const snapshot = resolveMenuStartupSnapshot([item], [item.containerName])

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
      projectDir: "/home/dev/.docker-git/org-two"
    })
    const snapshot = resolveMenuStartupSnapshot([first, second], [first.containerName, second.containerName])

    expect(snapshot.activeDir).toBeNull()
    expect(snapshot.runningDockerGitContainers).toBe(2)
    expect(snapshot.message).toContain("Use Select project")
  })

  it("shows warning when running docker-git containers have no matching configs", () => {
    const snapshot = resolveMenuStartupSnapshot([], ["dg-unknown", "dg-another"])

    expect(snapshot.activeDir).toBeNull()
    expect(snapshot.runningDockerGitContainers).toBe(2)
    expect(snapshot.message).toContain("No matching project config found")
  })
})

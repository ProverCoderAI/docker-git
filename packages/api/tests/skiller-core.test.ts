import { describe, expect, it } from "@effect/vitest"

import {
  parseDockerMountLines,
  remapContainerPathToMountedHost,
  sameSkillerScope
} from "../src/services/skiller-core.js"

describe("skiller container filesystem mapping", () => {
  it("maps a project container path through the most specific writable Docker mount", () => {
    const mounts = parseDockerMountLines([
      "/var/lib/docker/volumes/project-home/_data\t/home/dev\ttrue",
      "/var/lib/docker/volumes/project-cache/_data\t/home/dev/.docker-git/.cache\ttrue",
      "/bootstrap\t/opt/docker-git/bootstrap/source\tfalse"
    ].join("\n"))

    expect(remapContainerPathToMountedHost(mounts, "/home/dev/app")).toBe(
      "/var/lib/docker/volumes/project-home/_data/app"
    )
    expect(remapContainerPathToMountedHost(mounts, "/home/dev/.docker-git/.cache/bun")).toBe(
      "/var/lib/docker/volumes/project-cache/_data/bun"
    )
    expect(remapContainerPathToMountedHost(mounts, "/opt/docker-git/bootstrap/source")).toBeNull()
  })

  it("treats identical Skiller scopes as reusable and different scopes as isolated", () => {
    const scope = {
      containerHomePath: "/home/dev",
      containerName: "dg-project",
      containerProjectPath: "/home/dev/app",
      hostHomePath: "/var/lib/docker/volumes/project-home/_data",
      hostProjectPath: "/var/lib/docker/volumes/project-home/_data/app",
      projectId: "/home/dev/.docker-git/project",
      projectKey: "abc123",
      sshUser: "dev"
    }

    expect(sameSkillerScope(scope, scope)).toBe(true)
    expect(sameSkillerScope(scope, { ...scope, projectKey: "def456" })).toBe(false)
    expect(sameSkillerScope(scope, null)).toBe(false)
    expect(sameSkillerScope(null, null)).toBe(true)
  })
})

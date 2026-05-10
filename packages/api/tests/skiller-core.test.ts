import { describe, expect, it } from "@effect/vitest"

import {
  containerCodexSkillsPath,
  parseDockerMountLines,
  remapContainerPathToMountedHost,
  remapSkillerBrowserContainerPath,
  remapSkillerBrowserHostPath,
  sameSkillerScope,
  skillerBrowserScopeForContainer
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
    expect(remapContainerPathToMountedHost(mounts, containerCodexSkillsPath("/home/dev"))).toBe(
      "/var/lib/docker/volumes/project-home/_data/.codex/skills"
    )
    expect(remapContainerPathToMountedHost(mounts, "/home/dev/.docker-git/.cache/bun")).toBe(
      "/var/lib/docker/volumes/project-cache/_data/bun"
    )
    expect(remapContainerPathToMountedHost(mounts, "/opt/docker-git/bootstrap/source")).toBeNull()
  })

  it("treats identical Skiller scopes as reusable and different scopes as isolated", () => {
    const scope = {
      containerCodexSkillsPath: "/home/dev/.codex/skills",
      containerHomePath: "/home/dev",
      containerName: "dg-project",
      containerProjectPath: "/home/dev/app",
      hostCodexSkillsPath: "/var/lib/docker/volumes/project-home/_data/.codex/skills",
      hostHomePath: "/var/lib/docker/volumes/project-home/_data",
      hostProjectPath: "/var/lib/docker/volumes/project-home/_data/app",
      projectId: "/home/dev/.docker-git/project",
      projectKey: "abc123",
      sshUser: "dev"
    }

    expect(sameSkillerScope(scope, scope)).toBe(true)
    expect(sameSkillerScope(scope, { ...scope, projectKey: "def456" })).toBe(false)
    expect(sameSkillerScope(scope, {
      ...scope,
      hostCodexSkillsPath: "/var/lib/docker/volumes/other-home/_data/.codex/skills"
    })).toBe(false)
    expect(sameSkillerScope(scope, null)).toBe(false)
    expect(sameSkillerScope(null, null)).toBe(true)
  })

  it("builds a browser picker scope that remaps selected container paths to host volume paths", () => {
    const browserScope = skillerBrowserScopeForContainer({
      containerCodexSkillsPath: "/home/dev/.codex/skills",
      containerHomePath: "/home/dev",
      containerName: "dg-project",
      containerProjectPath: "/home/dev/app",
      hostCodexSkillsPath: "/var/lib/docker/volumes/project-home/_data/.codex/skills",
      hostHomePath: "/var/lib/docker/volumes/project-home/_data",
      hostProjectPath: "/var/lib/docker/volumes/project-home/_data/app",
      projectId: "/home/dev/.docker-git/project",
      projectKey: "abc123",
      sshUser: "dev"
    }, "terminal-session")

    expect(skillerBrowserScopeForContainer({
      containerCodexSkillsPath: "/home/dev/.codex/skills",
      containerHomePath: "/home/dev",
      containerName: "dg-project",
      containerProjectPath: "/home/dev/app",
      hostCodexSkillsPath: "/var/lib/docker/volumes/project-home/_data/.codex/skills",
      hostHomePath: "/var/lib/docker/volumes/project-home/_data",
      hostProjectPath: "/var/lib/docker/volumes/project-home/_data/app",
      projectId: "/home/dev/.docker-git/project",
      projectKey: "abc123",
      sshUser: "dev"
    }, null).sessionId).toBeNull()
    expect(browserScope.currentProject.containerPath).toBe("/home/dev/app")
    expect(remapSkillerBrowserContainerPath(browserScope, "/home/dev/app/packages")).toBe(
      "/var/lib/docker/volumes/project-home/_data/app/packages"
    )
    expect(remapSkillerBrowserContainerPath(browserScope, "/home/dev/.codex/skills/demo")).toBe(
      "/var/lib/docker/volumes/project-home/_data/.codex/skills/demo"
    )
    expect(remapSkillerBrowserContainerPath(browserScope, "/tmp/outside")).toBeNull()
    expect(remapSkillerBrowserHostPath(
      browserScope,
      "/var/lib/docker/volumes/project-home/_data/app/packages"
    )).toBe("/home/dev/app/packages")
  })
})

import { describe, expect, it } from "vitest"

import type { ApiProjectDetails } from "../../src/docker-git/api-project-codec.js"
import { projectItemFromApiDetails } from "../../src/docker-git/project-item.js"

const makeProject = (): ApiProjectDetails => ({
  id: "/home/dev/.docker-git/org/repo",
  displayName: "org/repo",
  repoUrl: "https://github.com/org/repo",
  repoRef: "main",
  status: "running",
  statusLabel: "Up 10 seconds",
  sshSessions: 2,
  startedAtIso: "2026-04-10T00:00:00Z",
  startedAtEpochMs: Date.parse("2026-04-10T00:00:00Z"),
  containerName: "dg-org-repo",
  serviceName: "workspace",
  sshUser: "dev",
  sshPort: 2222,
  targetDir: "~/workspaces/org/repo",
  projectDir: "/home/dev/.docker-git/org/repo",
  sshCommand: "ssh -p 2222 dev@127.0.0.1",
  authorizedKeysPath: "/home/dev/.docker-git/org/repo/authorized_keys",
  authorizedKeysExists: true,
  envGlobalPath: "/home/dev/.docker-git/org/repo/.orch/env/global.env",
  envProjectPath: "/home/dev/.docker-git/org/repo/.orch/env/project.env",
  codexAuthPath: "/home/dev/.docker-git/org/repo/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  clonedOnHostname: "builder-01"
})

describe("project-itemFromApiDetails", () => {
  it("maps API project details into the frontend project item", () => {
    const project = makeProject()
    const item = projectItemFromApiDetails(project)

    expect(item.projectDir).toBe(project.projectDir)
    expect(item.displayName).toBe(project.displayName)
    expect(item.containerName).toBe(project.containerName)
    expect(item.authorizedKeysPath).toBe(project.authorizedKeysPath)
    expect(item.sshCommand).toBe(project.sshCommand)
    expect(item.sshSessions).toBe(2)
    expect(item.clonedOnHostname).toBe("builder-01")
  })
})

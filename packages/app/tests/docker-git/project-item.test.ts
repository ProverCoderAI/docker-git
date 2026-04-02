import { describe, expect, it } from "vitest"

import type { ApiProjectDetails } from "../../src/docker-git/api-project-codec.js"
import { projectItemFromApiDetails } from "../../src/docker-git/project-item.js"

const joinIp = (...octets: ReadonlyArray<string>): string => octets.join(".")

const makeProject = (): ApiProjectDetails => ({
  id: "/home/dev/.docker-git/org/repo",
  displayName: "org/repo",
  repoUrl: "https://github.com/org/repo",
  repoRef: "main",
  status: "running",
  statusLabel: "Up 10 seconds",
  containerName: "dg-org-repo",
  serviceName: "workspace",
  sshUser: "dev",
  sshPort: 2222,
  targetDir: "~/workspaces/org/repo",
  projectDir: "/home/dev/.docker-git/org/repo",
  sshCommand: "",
  envGlobalPath: "/home/dev/.docker-git/org/repo/.orch/env/global.env",
  envProjectPath: "/home/dev/.docker-git/org/repo/.orch/env/project.env",
  codexAuthPath: "/home/dev/.docker-git/org/repo/.orch/auth/codex",
  codexHome: "/home/dev/.codex",
  clonedOnHostname: "builder-01"
})

describe("project-itemFromApiDetails", () => {
  it("builds a host-usable project item from API project details", () => {
    const project = makeProject()
    const sshKeyPath = `${project.projectDir}/dev_ssh_key`
    const ipAddress = joinIp("172", "17", "0", "20")
    const item = projectItemFromApiDetails(project, sshKeyPath, ipAddress)

    expect(item.projectDir).toBe(project.projectDir)
    expect(item.displayName).toBe(project.displayName)
    expect(item.containerName).toBe(project.containerName)
    expect(item.authorizedKeysPath).toBe(`${project.projectDir}/authorized_keys`)
    expect(item.sshKeyPath).toBe(sshKeyPath)
    expect(item.ipAddress).toBe(ipAddress)
    expect(item.clonedOnHostname).toBe("builder-01")
    expect(item.sshCommand).toContain(`dev@${ipAddress}`)
  })
})

import { describe, expect, it } from "@effect/vitest"

import type { ProjectItem } from "../../src/usecases/projects-core.js"
import { prepareProjectSsh } from "../../src/usecases/projects-ssh.js"

const projectItem: ProjectItem = {
  authorizedKeysExists: true,
  authorizedKeysPath: "/tmp/project/.ssh/authorized_keys",
  codexAuthPath: "/tmp/auth.json",
  codexHome: "/tmp/codex",
  containerName: "project-container",
  displayName: "org/repo",
  envGlobalPath: "/tmp/.env",
  envProjectPath: "/tmp/project/.env",
  gpu: "none",
  projectDir: "/tmp/project",
  repoRef: "main",
  repoUrl: "https://example.com/org/repo.git",
  serviceName: "app",
  sshCommand: "ssh -p 2222 dev@localhost",
  sshKeyPath: "/tmp/key",
  sshPort: 2222,
  sshUser: "dev",
  targetDir: "/workspace"
}

describe("project ssh preparation", () => {
  it("adds ssh keepalive options for interactive sessions", () => {
    const prepared = prepareProjectSsh(projectItem)

    expect(prepared.args).toContain("ServerAliveInterval=30")
    expect(prepared.args).toContain("ServerAliveCountMax=3")
    expect(prepared.args).toEqual([
      "-i",
      "/tmp/key",
      "-tt",
      "-Y",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "ServerAliveInterval=30",
      "-o",
      "ServerAliveCountMax=3",
      "-p",
      "2222",
      "dev@localhost"
    ])
  })
})

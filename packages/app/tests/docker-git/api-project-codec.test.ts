import { describe, expect, it } from "@effect/vitest"

import { decodeCreateProjectAccepted, decodeProjectDetails } from "../../src/docker-git/api-project-codec.js"

describe("api project codec", () => {
  it("decodes detailed project payloads returned by the project list endpoint", () => {
    const details = decodeProjectDetails({
      authorizedKeysExists: true,
      authorizedKeysPath: "/home/dev/.docker-git/authorized_keys",
      codexAuthPath: "/home/dev/.docker-git/.orch/auth/codex",
      codexHome: "/home/dev/.codex",
      containerName: "dg-docker-git-issue-372",
      displayName: "provercoderai/docker-git",
      envGlobalPath: "/home/dev/.docker-git/.orch/env/global.env",
      envProjectPath: "/home/dev/.docker-git/provercoderai/docker-git/issue-372/.env",
      id: "/home/dev/.docker-git/provercoderai/docker-git/issue-372",
      projectDir: "/home/dev/.docker-git/provercoderai/docker-git/issue-372",
      repoRef: "issue-372",
      repoUrl: "https://github.com/ProverCoderAI/docker-git.git",
      serviceName: "app",
      sshCommand: "ssh dev@127.0.0.1 -p 2222",
      sshPort: 2222,
      sshSessions: 0,
      sshUser: "dev",
      startedAtEpochMs: 1_780_738_345_268,
      startedAtIso: "2026-06-06T09:32:25.268Z",
      status: "running",
      statusLabel: "last known: running",
      targetDir: "/workspace"
    })

    expect(details).toMatchObject({
      projectDir: "/home/dev/.docker-git/provercoderai/docker-git/issue-372",
      repoRef: "issue-372",
      sshCommand: "ssh dev@127.0.0.1 -p 2222",
      status: "running"
    })
  })

  it("decodes async create accepted responses", () => {
    const accepted = decodeCreateProjectAccepted({
      accepted: true,
      projectId: ".docker-git/org/repo",
      cursor: 0
    })

    expect(accepted).toEqual({
      accepted: true,
      projectId: ".docker-git/org/repo",
      cursor: 0
    })
  })

  it("rejects incomplete async create accepted responses", () => {
    expect(decodeCreateProjectAccepted({ accepted: true, projectId: ".docker-git/org/repo" })).toBeNull()
  })
})

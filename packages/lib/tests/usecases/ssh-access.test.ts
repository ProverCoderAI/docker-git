import { describe, expect, it } from "@effect/vitest"

import type { TemplateConfig } from "../../src/core/domain.js"
import { defaultTemplateConfig } from "../../src/core/domain.js"
import { buildEditorSshAccess, buildSshCommand } from "../../src/usecases/ssh-access.js"

const makeTemplateConfig = (overrides: Partial<TemplateConfig> = {}): TemplateConfig => ({
  ...defaultTemplateConfig,
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  targetDir: "/home/dev/workspaces/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: "/workspace/.docker-git",
  authorizedKeysPath: "/workspace/authorized_keys",
  envGlobalPath: "/workspace/.orch/env/global.env",
  envProjectPath: "/workspace/.orch/env/project.env",
  codexAuthPath: "/workspace/.orch/auth/codex",
  codexSharedAuthPath: "/workspace/.orch/auth/codex-shared",
  geminiAuthPath: "/workspace/.orch/auth/gemini",
  ...overrides
})

describe("ssh access helpers", () => {
  it("builds Remote-SSH access details for localhost ssh", () => {
    const template = makeTemplateConfig()
    const access = buildEditorSshAccess(template, "/home/user/.ssh/id_ed25519")

    expect(access.alias).toBe("dg-test")
    expect(access.terminalShortcut).toBe("ssh dg-test")
    expect(access.workspacePath).toBe("/home/dev/workspaces/org/repo")
    expect(access.configSnippet).toContain("Host dg-test")
    expect(access.configSnippet).toContain("HostName localhost")
    expect(access.configSnippet).toContain("Port 2222")
    expect(access.configSnippet).toContain("IdentityFile /home/user/.ssh/id_ed25519")
  })

  it("switches to container IP addressing when nested inside docker", () => {
    const template = makeTemplateConfig()
    const access = buildEditorSshAccess(template, null, "172.17.0.6")
    const sshCommand = buildSshCommand(template, null, "172.17.0.6")

    expect(access.configSnippet).toContain("HostName 172.17.0.6")
    expect(access.configSnippet).toContain("Port 22")
    expect(sshCommand).toContain("-p 22 dev@172.17.0.6")
  })
})

import { describe, expect, it } from "@effect/vitest"

import type { ProjectConfig } from "../../src/core/domain.js"
import { defaultTemplateConfig } from "../../src/core/domain.js"
import { formatConnectionInfo } from "../../src/usecases/menu-helpers.js"
import { buildEditorSshAccess, formatEditorSshAccessDetails } from "../../src/usecases/ssh-access.js"

const makeProjectConfig = (overrides: Partial<ProjectConfig["template"]> = {}): ProjectConfig => ({
  schemaVersion: 1,
  template: {
    ...defaultTemplateConfig,
    repoUrl: "https://github.com/org/repo.git",
    containerName: "dg-test",
    serviceName: "dg-test",
    sshUser: "dev",
    targetDir: "/home/dev/org/repo",
    volumeName: "dg-test-home",
    dockerGitPath: "/workspace/.docker-git",
    authorizedKeysPath: "/workspace/authorized_keys",
    envGlobalPath: "/workspace/.orch/env/global.env",
    envProjectPath: "/workspace/.orch/env/project.env",
    codexAuthPath: "/workspace/.orch/auth/codex",
    codexSharedAuthPath: "/workspace/.orch/auth/codex-shared",
    geminiAuthPath: "/workspace/.orch/auth/gemini",
    ...overrides
  }
})

describe("formatConnectionInfo", () => {
  it("includes clonedOnHostname when present", () => {
    const config = makeProjectConfig({ clonedOnHostname: "my-laptop" })
    const output = formatConnectionInfo("/project", config, {
      authorizedKeysPath: "/keys",
      authorizedKeysExists: true,
      sshCommand: "ssh dev@localhost"
    })
    expect(output).toContain("Cloned on device: my-laptop")
  })

  it("omits clonedOnHostname line when undefined", () => {
    const config = makeProjectConfig()
    const output = formatConnectionInfo("/project", config, {
      authorizedKeysPath: "/keys",
      authorizedKeysExists: true,
      sshCommand: "ssh dev@localhost"
    })
    expect(output).not.toContain("Cloned on device")
  })

  it("includes Remote-SSH details when provided", () => {
    const config = makeProjectConfig({ clonedOnHostname: "meadav" })
    const editorAccess = buildEditorSshAccess(config.template, "/home/user/.ssh/id_ed25519")
    const output = formatConnectionInfo("/project", config, {
      authorizedKeysPath: "/keys",
      authorizedKeysExists: true,
      sshCommand: "ssh dev@localhost",
      editorAccessDetails: formatEditorSshAccessDetails(editorAccess, config.template.clonedOnHostname)
    })
    expect(output).toContain("Remote-SSH host: dg-test")
    expect(output).toContain("Terminal shortcut: ssh dg-test")
    expect(output).toContain("VS Code/Cursor: Connect to Host... -> dg-test")
    expect(output).toContain("If your editor runs on another machine")
  })
})

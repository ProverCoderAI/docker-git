import { describe, expect, it } from "@effect/vitest"

import { defaultTemplateConfig, type TemplateConfig } from "../../src/lib/core/domain.js"
import { planFiles } from "../../src/lib/core/templates.js"
import { renderDockerfile } from "../../src/lib/core/templates/dockerfile.js"

const makeTemplateConfig = (overrides: Partial<TemplateConfig> = {}): TemplateConfig => ({
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
  codexHome: "/home/dev/.codex",
  geminiAuthPath: "/workspace/.orch/auth/gemini",
  geminiHome: "/home/dev/.gemini",
  grokAuthPath: "/workspace/.orch/auth/grok",
  grokHome: "/home/dev/.grok",
  gpu: "none",
  ...overrides
})

describe("app planFiles", () => {
  it("includes nested browser runtime artifacts when Playwright is enabled", () => {
    const files = planFiles(makeTemplateConfig({ enableMcpPlaywright: true }))
    const filePaths = files.flatMap((file) => file._tag === "File" ? [file.relativePath] : [])
    const runtime = files.find(
      (file): file is Extract<(typeof files)[number], { readonly _tag: "File" }> =>
        file._tag === "File" && file.relativePath === "docker-git-browser-runtime.sh"
    )
    const dockerfile = renderDockerfile(makeTemplateConfig({ enableMcpPlaywright: true }))

    expect(filePaths).toContain("Dockerfile.browser")
    expect(filePaths).toContain("mcp-playwright-start-extra.sh")
    expect(filePaths).toContain("docker-git-browser-runtime.sh")
    expect(runtime).toBeDefined()
    expect(runtime?.mode).toBe(0o755)
    expect(runtime?.contents).toContain('if [[ "${MCP_PLAYWRIGHT_ENABLE:-0}" != "1" ]]; then')
    expect(runtime?.contents).toContain("docker_git_wait_for_playwright_cdp()")
    expect(runtime?.contents).toContain("MCP_PLAYWRIGHT_ENABLE=0")
    expect(runtime?.contents).not.toContain('\\${MCP_PLAYWRIGHT_ENABLE:-0}')
    expect(dockerfile).toContain(
      "COPY Dockerfile.browser mcp-playwright-start-extra.sh docker-git-browser-runtime.sh /opt/docker-git/browser/"
    )
    expect(dockerfile).toContain('MCP_PLAYWRIGHT_CDP_TIMEOUT="${MCP_PLAYWRIGHT_CDP_TIMEOUT:-60000}"')
  })
})

import { describe, expect, it } from "@effect/vitest"

import { defaultTemplateConfig, planFiles, type TemplateConfig } from "../../test-adapters/core-templates.js"

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

type PlannedFile = ReturnType<typeof planFiles>[number]
type GeneratedFile = Extract<PlannedFile, { readonly _tag: "File" }>

const getGeneratedFile = (files: ReadonlyArray<PlannedFile>, relativePath: string): GeneratedFile => {
  const file = files.find(
    (candidate): candidate is GeneratedFile => candidate._tag === "File" && candidate.relativePath === relativePath
  )
  if (file === undefined) {
    throw new Error(`Missing generated file: ${relativePath}`)
  }
  return file
}

const getGeneratedFilePaths = (files: ReadonlyArray<PlannedFile>): ReadonlyArray<string> =>
  files.flatMap((file) => file._tag === "File" ? [file.relativePath] : [])

describe("app planFiles", () => {
  it("includes Grok auth bootstrap wiring in the generated entrypoint", () => {
    const files = planFiles(makeTemplateConfig())
    const entrypoint = getGeneratedFile(files, "entrypoint.sh")

    expect(entrypoint.contents).toContain("DOCKER_GIT_GROK_AUTH_DIR=\"$DOCKER_GIT_HOME/.orch/auth/grok\"")
    expect(entrypoint.contents).toContain("BOOTSTRAP_GROK_AUTH_DIR=\"$BOOTSTRAP_SOURCE_ROOT/project-auth/grok\"")
    expect(entrypoint.contents).toContain("sync_dir_entries \"$BOOTSTRAP_GROK_AUTH_DIR\" \"$DOCKER_GIT_GROK_AUTH_DIR\"")
  })

  it("includes nested browser runtime artifacts when Playwright is enabled", () => {
    const files = planFiles(makeTemplateConfig({ enableMcpPlaywright: true }))
    const filePaths = getGeneratedFilePaths(files)
    const runtime = getGeneratedFile(files, "docker-git-browser-runtime.sh")
    const cdpGuard = getGeneratedFile(files, "docker-git-cdp-guard")
    const browserDockerfile = getGeneratedFile(files, "Dockerfile.browser")
    const startExtra = getGeneratedFile(files, "mcp-playwright-start-extra.sh")
    const dockerfile = getGeneratedFile(files, "Dockerfile")

    expect(filePaths).toContain("Dockerfile.browser")
    expect(filePaths).toContain("docker-git-cdp-guard")
    expect(filePaths).toContain("mcp-playwright-start-extra.sh")
    expect(filePaths).toContain("docker-git-browser-runtime.sh")
    expect(cdpGuard.mode).toBe(0o755)
    expect(cdpGuard.contents).toContain("#!/usr/bin/env node")
    expect(cdpGuard.contents).toContain("const upstreamHost = \"127.0.0.1\";")
    expect(cdpGuard.contents).toContain("const upstreamPort = 9222;")
    expect(cdpGuard.contents).toContain("const listenHost = \"0.0.0.0\";")
    expect(cdpGuard.contents).toContain("const listenPort = 9223;")
    expect(cdpGuard.contents).not.toContain("MCP_PLAYWRIGHT_UPSTREAM_CDP_HOST")
    expect(cdpGuard.contents).not.toContain("MCP_PLAYWRIGHT_CDP_GUARD_PORT")
    expect(cdpGuard.contents).toContain("Browser.close")
    expect(browserDockerfile.contents).toContain("COPY docker-git-cdp-guard /usr/local/bin/docker-git-cdp-guard")
    expect(browserDockerfile.contents).not.toContain("RUN cat <<'EOF' > /usr/local/bin/docker-git-cdp-guard")
    expect(startExtra.contents).toContain("guard_pid=\"$!\"")
    expect(startExtra.contents).toContain("falling back to socat")
    expect(startExtra.contents).toContain("socat TCP-LISTEN:9223,fork,reuseaddr TCP:127.0.0.1:9222")
    expect(runtime.mode).toBe(0o755)
    expect(runtime.contents).toContain("if [[ \"${MCP_PLAYWRIGHT_ENABLE:-0}\" != \"1\" ]]; then")
    expect(runtime.contents).toContain(String.raw`printf '%s\n' "http://127.0.0.1:9223"`)
    expect(runtime.contents).not.toContain("printf '%s\\n' \"${MCP_PLAYWRIGHT_CDP_ENDPOINT:-http://127.0.0.1:9223}\"")
    expect(runtime.contents).toContain("docker_git_wait_for_playwright_cdp()")
    expect(runtime.contents).toContain("MCP_PLAYWRIGHT_ENABLE=0")
    expect(runtime.contents).not.toContain("\\${MCP_PLAYWRIGHT_ENABLE:-0}")
    expect(dockerfile.contents).toContain(
      "COPY Dockerfile.browser docker-git-cdp-guard mcp-playwright-start-extra.sh docker-git-browser-runtime.sh /opt/docker-git/browser/"
    )
    expect(dockerfile.contents).toContain("ARG PLAYWRIGHT_MCP_VERSION=0.0.75")
    expect(dockerfile.contents).toContain("RUN npm install -g \"@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}\"")
    expect(dockerfile.contents).toContain("CDP_ENDPOINT=\"http://127.0.0.1:9223\"")
    expect(dockerfile.contents).not.toContain("CDP_ENDPOINT=\"${MCP_PLAYWRIGHT_CDP_ENDPOINT:-}\"")
    expect(dockerfile.contents).toContain("MCP_PLAYWRIGHT_CDP_TIMEOUT=\"${MCP_PLAYWRIGHT_CDP_TIMEOUT:-60000}\"")
    expect(runtime.contents).toContain("invalid MCP_PLAYWRIGHT_READY_ATTEMPTS")
    expect(runtime.contents).toContain("while (( attempt <= attempts )); do")
    expect(runtime.contents).not.toContain("for attempt in $(seq 1 \"$attempts\")")
  })
})

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

  it("uses the Rust browser connection module when Playwright is enabled", () => {
    const files = planFiles(makeTemplateConfig({ enableMcpPlaywright: true }))
    const filePaths = getGeneratedFilePaths(files)
    const dockerfile = getGeneratedFile(files, "Dockerfile")
    const entrypoint = getGeneratedFile(files, "entrypoint.sh")

    expect(filePaths).not.toContain("Dockerfile.browser")
    expect(filePaths).not.toContain("docker-git-cdp-guard")
    expect(filePaths).not.toContain("docker-git-browser-runtime.sh")
    expect(dockerfile.contents).toContain(
      "cargo install --git https://github.com/ProverCoderAI/rust-browser-connection"
    )
    expect(dockerfile.contents).toContain("make build-essential docker.io")
    expect(dockerfile.contents).toContain("/usr/local/bin/browser-connection --version")
    expect(dockerfile.contents).not.toContain("docker-git-playwright-mcp")
    expect(entrypoint.contents).toContain("docker_git_start_rust_browser_connection")
    expect(entrypoint.contents).toContain("docker-git-browser-connection")
    expect(entrypoint.contents).toContain("local network_mode=\"container:${project_container}\"")
  })
})

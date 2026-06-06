import { describe, expect, it } from "@effect/vitest"
import * as fc from "fast-check"

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

const generatedTemplateConfigArbitrary: fc.Arbitrary<TemplateConfig> = fc
  .record({
    gpu: fc.constantFrom<TemplateConfig["gpu"]>("none", "all"),
    projectIndex: fc.integer({ min: 1, max: 100_000 }),
    sshPort: fc.integer({ min: 1024, max: 65_535 }),
    sshUserIndex: fc.integer({ min: 1, max: 100_000 })
  })
  .map(({ gpu, projectIndex, sshPort, sshUserIndex }) => {
    const sshUser = `dev${sshUserIndex}`
    const projectName = `repo-${projectIndex}`
    const home = `/home/${sshUser}`

    return makeTemplateConfig({
      codexHome: `${home}/.codex`,
      containerName: `dg-test-${projectIndex}`,
      geminiHome: `${home}/.gemini`,
      gpu,
      grokHome: `${home}/.grok`,
      serviceName: `dg-test-${projectIndex}`,
      sshPort,
      sshUser,
      targetDir: `${home}/org/${projectName}`,
      volumeName: `dg-test-${projectIndex}-home`
    })
  })

describe("app planFiles", () => {
  it("includes Grok auth bootstrap wiring in the generated entrypoint", () => {
    const files = planFiles(makeTemplateConfig())
    const entrypoint = getGeneratedFile(files, "entrypoint.sh")

    expect(entrypoint.contents).toContain("DOCKER_GIT_GROK_AUTH_DIR=\"$DOCKER_GIT_HOME/.orch/auth/grok\"")
    expect(entrypoint.contents).toContain("BOOTSTRAP_GROK_AUTH_DIR=\"$BOOTSTRAP_SOURCE_ROOT/project-auth/grok\"")
    expect(entrypoint.contents).toContain("sync_dir_entries \"$BOOTSTRAP_GROK_AUTH_DIR\" \"$DOCKER_GIT_GROK_AUTH_DIR\"")
  })

  it("uses the Rust browser connection module when Playwright is enabled", () => {
    fc.assert(
      fc.property(generatedTemplateConfigArbitrary, (generatedConfig) => {
        const files = planFiles({ ...generatedConfig, enableMcpPlaywright: true })
        const filePaths = getGeneratedFilePaths(files)
        const dockerfile = getGeneratedFile(files, "Dockerfile")
        const entrypoint = getGeneratedFile(files, "entrypoint.sh")

        expect(filePaths).not.toContain("Dockerfile.browser")
        expect(filePaths).not.toContain("docker-git-cdp-guard")
        expect(filePaths).not.toContain("docker-git-browser-runtime.sh")
        expect(dockerfile.contents).toContain(
          "cargo install --git https://github.com/ProverCoderAI/rust-browser-connection"
        )
        expect(dockerfile.contents).toContain(
          "cargo install --git https://github.com/ProverCoderAI/plan-to-git --rev 06fe8bdf1d2e48a1f5a0218a3bb7af19e63deb5e --locked --bins --root /usr/local"
        )
        expect(dockerfile.contents).toContain("/usr/local/bin/plan-to-git --help >/dev/null")
        expect(dockerfile.contents).toContain("make build-essential docker.io")
        expect(dockerfile.contents).toContain("/usr/local/bin/browser-connection --version")
        expect(dockerfile.contents).not.toContain("docker-git-playwright-mcp")
        expect(entrypoint.contents).not.toContain("docker_git_start_rust_browser_connection")
        expect(entrypoint.contents).not.toContain("start --project")
        expect(entrypoint.contents).not.toContain("--no-start-browser")
        expect(entrypoint.contents).toContain("docker_git_stop_playwright_browser()")
        expect(entrypoint.contents).toContain("docker-git-browser-connection")
        expect(entrypoint.contents).toContain("stop --project \"$project_container\"")
        expect(entrypoint.contents).toContain("command = \"browser-connection\"")
        expect(entrypoint.contents).toContain(
          "args = [\"--project\", \"$DOCKER_GIT_BROWSER_PROJECT\", \"--network\", \"$DOCKER_GIT_BROWSER_NETWORK\"]"
        )
        expect(entrypoint.contents).toContain("plan-to-git sync")
        expect(entrypoint.contents).toContain("docker_git_ensure_open_pr")
        expect(entrypoint.contents).toContain("gh pr list --repo \"$base_repo\" --state open --head \"$head_arg\"")
        expect(entrypoint.contents).toContain(
          "gh pr create --repo \"$base_repo\" --base \"$base_branch\" --head \"$head_arg\" --fill"
        )
        expect(entrypoint.contents).toContain("plan-to-git hook --source codex")
        expect(entrypoint.contents).toContain("CODEX_REQUIREMENTS_FILE=\"/etc/codex/requirements.toml\"")
        expect(entrypoint.contents).toContain("managed_dir = \"/opt/docker-git/hooks\"")
        expect(entrypoint.contents).toContain("[[hooks.UserPromptSubmit]]")
        expect(entrypoint.contents).toContain("[[hooks.Stop]]")
        expect(entrypoint.contents).toContain("command = \"/opt/docker-git/hooks/plan-to-git-codex-hook\"")

        const cdIndex = entrypoint.contents.indexOf("cd \"$REPO_ROOT\"")
        const ensurePrIndex = entrypoint.contents.indexOf(
          "docker_git_ensure_open_pr\n\n# CHANGE: sync captured Codex plans"
        )
        const planSyncIndex = entrypoint.contents.indexOf("plan-to-git sync")
        const sessionBackupIndex = entrypoint.contents.indexOf(
          "docker-git-session-sync backup --verbose --background --require-comment"
        )

        expect(cdIndex).toBeGreaterThanOrEqual(0)
        expect(ensurePrIndex).toBeGreaterThan(cdIndex)
        expect(planSyncIndex).toBeGreaterThan(ensurePrIndex)
        expect(sessionBackupIndex).toBeGreaterThan(planSyncIndex)
      })
    )
  })

  it("keeps plan-to-git state out of generated git and docker contexts", () => {
    fc.assert(
      fc.property(generatedTemplateConfigArbitrary, (config) => {
        const files = planFiles(config)
        const gitignore = getGeneratedFile(files, ".gitignore")
        const dockerignore = getGeneratedFile(files, ".dockerignore")

        expect(gitignore.contents).toContain(".agent-plan.json")
        expect(dockerignore.contents).toContain(".agent-plan.json")
      })
    )
  })
})

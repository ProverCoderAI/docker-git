import * as FileSystem from "@effect/platform/FileSystem"
import * as Path from "@effect/platform/Path"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import type { TemplateConfig } from "../../src/core/domain.js"
import { enableMcpPlaywrightProjectFiles } from "../../src/usecases/mcp-playwright.js"
import { prepareProjectFiles } from "../../src/usecases/actions/prepare-files.js"

const withTempDir = <A, E, R>(
  use: (tempDir: string) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R | FileSystem.FileSystem> =>
  Effect.scoped(
    Effect.gen(function*(_) {
      const fs = yield* _(FileSystem.FileSystem)
      const tempDir = yield* _(
        fs.makeTempDirectoryScoped({
          prefix: "docker-git-mcp-playwright-"
        })
      )
      return yield* _(use(tempDir))
    })
  )

const makeGlobalConfig = (root: string, path: Path.Path): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  skipGithubAuth: false,
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(root, ".docker-git"),
  authorizedKeysPath: path.join(root, "authorized_keys"),
  envGlobalPath: path.join(root, ".orch/env/global.env"),
  envProjectPath: path.join(root, ".orch/env/project.env"),
  codexAuthPath: path.join(root, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(root, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright: false,
  gpu: "none",
  bunVersion: "1.3.11"
})

const makeProjectConfig = (
  outDir: string,
  enableMcpPlaywright: boolean,
  path: Path.Path
): TemplateConfig => ({
  containerName: "dg-test",
  serviceName: "dg-test",
  sshUser: "dev",
  sshPort: 2222,
  repoUrl: "https://github.com/org/repo.git",
  repoRef: "main",
  skipGithubAuth: false,
  targetDir: "/home/dev/org/repo",
  volumeName: "dg-test-home",
  dockerGitPath: path.join(outDir, ".docker-git"),
  authorizedKeysPath: path.join(outDir, "authorized_keys"),
  envGlobalPath: path.join(outDir, ".orch/env/global.env"),
  envProjectPath: path.join(outDir, ".orch/env/project.env"),
  codexAuthPath: path.join(outDir, ".orch/auth/codex"),
  codexSharedAuthPath: path.join(outDir, ".orch/auth/codex-shared"),
  codexHome: "/home/dev/.codex",
  dockerNetworkMode: "shared",
  dockerSharedNetworkName: "docker-git-shared",
  enableMcpPlaywright,
  bunVersion: "1.3.11"
})

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readEnableMcpPlaywrightFlag = (value: unknown): boolean | undefined => {
  if (!isRecord(value)) {
    return undefined
  }

  const template = value.template
  if (!isRecord(template)) {
    return undefined
  }

  const flag = template.enableMcpPlaywright
  return typeof flag === "boolean" ? flag : undefined
}

describe("enableMcpPlaywrightProjectFiles", () => {
  it.effect("enables Playwright MCP for an existing project without rewriting env files", () =>
    withTempDir((root) =>
      Effect.gen(function*(_) {
        const fs = yield* _(FileSystem.FileSystem)
        const path = yield* _(Path.Path)
        const outDir = path.join(root, "project")
        const globalConfig = makeGlobalConfig(root, path)
        const withoutMcp = makeProjectConfig(outDir, false, path)

        yield* _(
          prepareProjectFiles(outDir, root, globalConfig, withoutMcp, {
            force: false,
            forceEnv: false
          })
        )

        const envProjectPath = path.join(outDir, ".orch/env/project.env")
        yield* _(fs.writeFileString(envProjectPath, "# custom env\nCUSTOM_KEY=1\n"))

        yield* _(enableMcpPlaywrightProjectFiles(outDir))

        const envAfter = yield* _(fs.readFileString(envProjectPath))
        expect(envAfter).toContain("CUSTOM_KEY=1")

        const composeAfter = yield* _(fs.readFileString(path.join(outDir, "docker-compose.yml")))
        expect(composeAfter).toContain("dg-test-browser")
        expect(composeAfter).not.toContain("\n  dg-test-browser:\n")
        expect(composeAfter).toContain('MCP_PLAYWRIGHT_ENABLE: "1"')
        expect(composeAfter).toContain('MCP_PLAYWRIGHT_CDP_ENDPOINT: "http://127.0.0.1:9223"')
        expect(composeAfter).toContain('DOCKER_GIT_BROWSER_CONTAINER_NAME: "dg-test-browser"')
        expect(composeAfter).toContain("      - /var/run/docker.sock:/var/run/docker.sock")

        const dockerfileAfter = yield* _(fs.readFileString(path.join(outDir, "Dockerfile")))
        expect(dockerfileAfter).toContain("ARG PLAYWRIGHT_MCP_VERSION=0.0.75")
        expect(dockerfileAfter).toContain('RUN npm install -g "@playwright/mcp@${PLAYWRIGHT_MCP_VERSION}"')

        // CHANGE: verify lazy Playwright MCP startup and legacy guarded fallback wiring
        // WHY: issue-319 requires MCP stdio initialize to answer even when CDP is still starting
        // QUOTE(issue-319): "MCP startup failed: handshaking with MCP server failed"
        // REF: issue-319
        expect(dockerfileAfter).toContain("MCP_PLAYWRIGHT_RETRY_ATTEMPTS")
        expect(dockerfileAfter).toContain("MCP_PLAYWRIGHT_RETRY_DELAY")
        expect(dockerfileAfter).toContain("MCP_PLAYWRIGHT_CDP_GUARD")
        expect(dockerfileAfter).toContain("MCP_PLAYWRIGHT_CDP_TIMEOUT")
        expect(dockerfileAfter).toContain('if [[ "${MCP_PLAYWRIGHT_ISOLATED:-0}" == "1" ]]; then')
        expect(dockerfileAfter).toContain("fetch_cdp_version()")
        expect(dockerfileAfter).toContain("waiting for nested browser runtime")
        expect(dockerfileAfter).toContain(
          'exec playwright-mcp --cdp-endpoint "$CDP_ENDPOINT" --cdp-timeout "$MCP_PLAYWRIGHT_CDP_TIMEOUT"'
        )
        expect(dockerfileAfter).toContain(
          "COPY Dockerfile.browser mcp-playwright-start-extra.sh docker-git-browser-runtime.sh /opt/docker-git/browser/"
        )

        const browserDockerfileExists = yield* _(fs.exists(path.join(outDir, "Dockerfile.browser")))
        const startExtraExists = yield* _(fs.exists(path.join(outDir, "mcp-playwright-start-extra.sh")))
        const browserRuntimeExists = yield* _(fs.exists(path.join(outDir, "docker-git-browser-runtime.sh")))
        expect(browserDockerfileExists).toBe(true)
        expect(startExtraExists).toBe(true)
        expect(browserRuntimeExists).toBe(true)
        const browserDockerfile = yield* _(fs.readFileString(path.join(outDir, "Dockerfile.browser")))
        const startExtra = yield* _(fs.readFileString(path.join(outDir, "mcp-playwright-start-extra.sh")))
        const browserRuntime = yield* _(fs.readFileString(path.join(outDir, "docker-git-browser-runtime.sh")))
        expect(browserDockerfile).toContain("docker-git-cdp-guard")
        expect(browserDockerfile).toContain("ws@8.18.3")
        expect(browserDockerfile).toContain("Browser.close")
        expect(browserDockerfile).toContain("Browser.crash")
        expect(startExtra).toContain('MCP_PLAYWRIGHT_CDP_GUARD:-1')
        expect(startExtra).toContain("docker-git-cdp-guard")
        expect(startExtra).toContain("socat TCP-LISTEN:9223")
        expect(browserRuntime).toContain('if [[ "${MCP_PLAYWRIGHT_ENABLE:-0}" != "1" ]]; then')
        expect(browserRuntime).not.toContain('if [[ "\\${MCP_PLAYWRIGHT_ENABLE:-0}" != "1" ]]; then')
        expect(browserRuntime).toContain('--network "container:$main_container"')
        expect(browserRuntime).toContain("docker_git_cleanup_orphaned_playwright_browsers")
        expect(browserRuntime).toContain("docker_git_browser_cleanup_temp_files")
        expect(browserRuntime).toContain('mktemp "${TMPDIR:-/tmp}/docker-git-browser-build.XXXXXX.log"')
        expect(browserRuntime).not.toContain('mktemp "\\${TMPDIR:-/tmp}/docker-git-browser-build.XXXXXX.log"')
        expect(browserRuntime).toContain('DOCKER_GIT_BROWSER_BUILD_TIMEOUT_SECONDS:-600')
        expect(browserRuntime).toContain('timeout "$build_timeout" docker build')
        expect(browserRuntime).toContain('cat "$build_log" >&2 || true')
        expect(browserRuntime).toContain("docker_git_wait_for_playwright_cdp()")
        expect(browserRuntime).toContain('local attempts="${MCP_PLAYWRIGHT_READY_ATTEMPTS:-60}"')
        expect(browserRuntime).toContain("invalid MCP_PLAYWRIGHT_READY_ATTEMPTS")
        expect(browserRuntime).toContain("while (( attempt <= attempts )); do")
        expect(browserRuntime).not.toContain('for attempt in $(seq 1 "$attempts")')
        expect(browserRuntime).toContain("MCP_PLAYWRIGHT_ENABLE=0")
        expect(browserRuntime).toContain('docker_git_disable_playwright_mcp "nested browser started but CDP is unavailable"')
        expect(browserRuntime).toContain('--filter "label=docker-git.browser=1" --filter "label=docker-git.project-container"')
        expect(browserRuntime).toContain('docker inspect --format \'{{ .State.Running }}\' "$project_container"')
        expect(browserRuntime).toContain('if ! docker volume create "$volume_name" >/dev/null 2>&1; then')
        expect(browserRuntime).toContain('failed to create browser data volume $volume_name; continuing')
        expect(browserRuntime).toContain('args+=(--cpus "$DOCKER_GIT_BROWSER_CPU_LIMIT")')
        expect(browserRuntime).toContain('args+=(--memory "$DOCKER_GIT_BROWSER_RAM_LIMIT" --memory-swap "$DOCKER_GIT_BROWSER_RAM_LIMIT")')
        expect(browserRuntime).toContain('docker "${args[@]}" "$image_name" >/dev/null || {')
        expect(browserRuntime).not.toContain('docker "\\${args[@]}" "$image_name" >/dev/null || {')

        const configAfterText = yield* _(fs.readFileString(path.join(outDir, "docker-git.json")))
        const configAfter = yield* _(Effect.sync((): unknown => JSON.parse(configAfterText)))
        expect(readEnableMcpPlaywrightFlag(configAfter)).toBe(true)
      })
    ).pipe(Effect.provide(NodeContext.layer)))
})

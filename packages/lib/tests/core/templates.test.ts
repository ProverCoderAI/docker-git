import { describe, expect, it } from "@effect/vitest"

import { defaultTemplateConfig, type TemplateConfig } from "../../src/core/domain.js"
import { renderDockerCompose } from "../../src/core/templates/docker-compose.js"
import { renderEntrypoint } from "../../src/core/templates-entrypoint.js"
import { renderEntrypointDnsRepair } from "../../src/core/templates-entrypoint/dns-repair.js"
import { renderEntrypointGitHooks } from "../../src/core/templates-entrypoint/git.js"

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
  geminiAuthPath: "/workspace/.orch/auth/gemini",
  ...overrides
})

describe("renderEntrypointDnsRepair", () => {
  it("renders the fallback nameserver repair block", () => {
    const dnsRepair = renderEntrypointDnsRepair()

    expect(dnsRepair).toContain('local test_domain="github.com"')
    expect(dnsRepair).toContain('local fallback_dns="8.8.8.8 8.8.4.4 1.1.1.1"')
    expect(dnsRepair).toContain('printf "nameserver %s\\n" "$ns" >> "$resolv"')
    expect(dnsRepair).toContain('echo "[dns-repair] WARNING: DNS resolution still failing after repair attempt"')
    expect(dnsRepair).toContain("docker_git_repair_dns || true")
  })

  it("injects DNS repair before the package cache setup in the full entrypoint", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig())
    const dnsRepair = renderEntrypointDnsRepair()
    const dnsRepairIndex = entrypoint.indexOf(dnsRepair)
    const packageCacheIndex = entrypoint.indexOf(
      "# Share package manager caches across all docker-git containers"
    )

    expect(dnsRepairIndex).toBeGreaterThanOrEqual(0)
    expect(packageCacheIndex).toBeGreaterThan(dnsRepairIndex)
  })
})

describe("renderEntrypointGitHooks", () => {
  it("installs pre-push protection checks and post-push backup hook", () => {
    const hooks = renderEntrypointGitHooks()

    expect(hooks).toContain('PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"')
    expect(hooks).toContain('POST_PUSH_HOOK="$HOOKS_DIR/post-push"')
    expect(hooks).toContain("cat <<'EOF' > \"$PRE_PUSH_HOOK\"")
    expect(hooks).toContain("cat <<'EOF' > \"$POST_PUSH_HOOK\"")
    expect(hooks).toContain("check_issue_managed_block_range")
    expect(hooks).toContain("Run session backup after successful push")
    expect(hooks).toContain("node \"$BACKUP_SCRIPT\"")
    expect(hooks).not.toContain("node \"$BACKUP_SCRIPT\" --verbose")
    expect(hooks.indexOf('$REPO_ROOT/scripts/session-backup-gist.js')).toBeLessThan(
      hooks.indexOf("/opt/docker-git/scripts/session-backup-gist.js")
    )
    expect(hooks).toContain("[session-backup] Warning: gh CLI not found")
  })
})

describe("renderDockerCompose", () => {
  it("renders fallback DNS servers for the main container even without Playwright", () => {
    const compose = renderDockerCompose(makeTemplateConfig())

    expect(compose).toContain("container_name: dg-test")
    expect(compose).toContain("    dns:\n      - 8.8.8.8\n      - 8.8.4.4\n      - 1.1.1.1\n    networks:")
    expect(compose).not.toContain("dg-test-browser")
    expect((compose.match(/\n    dns:\n/g) ?? []).length).toBe(1)
  })

  it("renders fallback DNS servers for the browser sidecar when Playwright is enabled", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        enableMcpPlaywright: true
      }),
      {
        cpuLimit: 1.5,
        ramLimit: "2g"
      }
    )
    const browserServiceIndex = compose.indexOf("\n  dg-test-browser:\n")
    const browserDnsIndex = compose.indexOf(
      '    dns:\n      - 8.8.8.8\n      - 8.8.4.4\n      - 1.1.1.1\n    volumes:\n      - dg-test-home-browser:/data\n',
      browserServiceIndex
    )

    expect(compose).toContain('MCP_PLAYWRIGHT_CDP_ENDPOINT: "http://dg-test-browser:9223"')
    expect(browserServiceIndex).toBeGreaterThanOrEqual(0)
    expect(browserDnsIndex).toBeGreaterThan(browserServiceIndex)
    expect((compose.match(/\n    dns:\n/g) ?? []).length).toBe(2)
  })
})

import { describe, expect, it } from "@effect/vitest"

import { defaultTemplateConfig, type TemplateConfig } from "../../src/core/domain.js"
import { renderDockerCompose } from "../../src/core/templates/docker-compose.js"
import { renderDockerfile } from "../../src/core/templates/dockerfile.js"
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

const expectContainsAll = (value: string, snippets: ReadonlyArray<string>): void => {
  for (const snippet of snippets) {
    expect(value).toContain(snippet)
  }
}

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
    const packageCacheIndex = entrypoint.indexOf('PACKAGE_CACHE_ROOT="/home/dev/.docker-git/.cache/packages"')

    expect(dnsRepairIndex).toBeGreaterThanOrEqual(0)
    expect(packageCacheIndex).toBeGreaterThan(dnsRepairIndex)
  })
})

describe("renderDockerfile", () => {
  it("uses the shared box image as the project container base", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expect(dockerfile).toContain("ARG DOCKER_GIT_BASE_IMAGE=konard/box:latest")
    expect(dockerfile).toContain("FROM ${DOCKER_GIT_BASE_IMAGE}")
    expect(dockerfile).toContain("USER root")
    expect(dockerfile).not.toContain("FROM ubuntu:24.04")
  })

  it("renames the box base user to the configured SSH user", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expect(dockerfile).toContain("for BASE_USER in box ubuntu; do")
    expect(dockerfile).toContain('if [ "$BASE_USER" != "dev" ] && id -u "$BASE_USER" >/dev/null 2>&1; then')
    expect(dockerfile).toContain('usermod -l dev -d /home/dev -m -s /usr/bin/zsh "$BASE_USER" || true')
  })

  it("installs session sync from npmjs with a local fallback", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expectContainsAll(dockerfile, [
      "# Tooling: GitLab CLI (glab)",
      "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/",
      "glab_1.93.0_linux_$GLAB_ARCH.deb",
      "curl -fsSL --retry 5 --retry-all-errors --retry-delay 2",
      "glab --version",
      'ARG DOCKER_GIT_SESSION_SYNC_PACKAGE="@prover-coder-ai/docker-git-session-sync@latest"',
      'COPY .docker-git-tools/docker-git-session-sync /opt/docker-git/tools/docker-git-session-sync',
      'npm install -g "$DOCKER_GIT_SESSION_SYNC_PACKAGE"',
      "docker-git-session-sync --help >/dev/null",
      "using local session sync fallback",
      "install -m 0755 /opt/docker-git/tools/docker-git-session-sync /usr/local/bin/docker-git-session-sync"
    ])
    expect(dockerfile).not.toContain("glab_1.93.0_linux_\\$GLAB_ARCH.deb")
  })
})

describe("renderEntrypointGitHooks", () => {
  it("installs pre-push protection checks and a global git post-push runtime", () => {
    const hooks = renderEntrypointGitHooks()

    expect(hooks).toContain('PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"')
    expect(hooks).toContain('POST_PUSH_ACTION="$HOOKS_DIR/post-push"')
    expect(hooks).toContain('GIT_WRAPPER_BIN="/usr/local/bin/git"')
    expect(hooks).toContain('type -aP git')
    expect(hooks).toContain("cat <<'EOF' > \"$PRE_PUSH_HOOK\"")
    expect(hooks).toContain("cat <<'EOF' > \"$POST_PUSH_ACTION\"")
    expect(hooks).toContain("cat <<'EOF' > \"$GIT_WRAPPER_BIN\"")
    expect(hooks).toContain("check_issue_managed_block_range")
    expect(hooks).toContain("Run session backup after successful push")
    expect(hooks).toContain("git has no client-side post-push hook")
    expect(hooks).toContain("docker-git managed git wrapper")
    expect(hooks).toContain("DOCKER_GIT_SKIP_POST_PUSH_ACTION=1")
    expect(hooks).toContain("DOCKER_GIT_POST_PUSH_REPO_ROOT")
    expect(hooks).toContain("docker_git_git_push_is_dry_run")
    expect(hooks).toContain("docker_git_git_resolve_repo_root")
    expect(hooks).toContain("--dry-run|-n")
    expect(hooks).toContain("--help|-h|--version|--html-path|--man-path|--info-path|--list-cmds|--list-cmds=*")
    expect(hooks).not.toContain('POST_PUSH_RUNTIME="/etc/profile.d/zz-git-post-push.sh"')
    expect(hooks).not.toContain("source /etc/profile.d/zz-git-post-push.sh")
    expect(hooks).toContain('REPO_ROOT="${DOCKER_GIT_POST_PUSH_REPO_ROOT:-}"')
    expect(hooks).toContain("docker-git-session-sync backup --verbose --background --require-comment")
    expect(hooks).toContain("docker-git-session-sync not found")
    expect(hooks).not.toContain("session backup failed (non-fatal)")
    expect(hooks).not.toContain("node \"$BACKUP_SCRIPT\"")
    expect(hooks).not.toContain("session-backup-gist.js")
    expect(hooks).toContain("[session-backup] Error: gh CLI not found")
  })
})

describe("renderEntrypoint auth bridge", () => {
  const renderAuthEntrypoint = (): string =>
    renderEntrypoint(
      makeTemplateConfig({
        enableMcpPlaywright: false
      })
    )

  it("renders GitHub auth bridge and credential helper wiring", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "GITLAB_TOKEN=\"${GITLAB_TOKEN:-}\"",
      "GIT_AUTH_TOKEN=\"${GIT_AUTH_TOKEN:-${GITHUB_TOKEN:-${GH_TOKEN:-}}}\"",
      "GITHUB_TOKEN=\"${GITHUB_TOKEN:-${GH_TOKEN:-}}\"",
      "GITHUB_AUTH_SKIP=\"${GITHUB_AUTH_SKIP:-0}\"",
      "AUTH_LABEL_RAW=\"${GIT_AUTH_LABEL:-${GITHUB_AUTH_LABEL:-${GITLAB_AUTH_LABEL:-}}}\"",
      "if [[ -n \"$AUTH_LABEL_RAW\" ]]; then",
      "LABELED_GITHUB_TOKEN_KEY=\"GITHUB_TOKEN__$RESOLVED_AUTH_LABEL\"",
      "LABELED_GITLAB_TOKEN_KEY=\"GITLAB_TOKEN__$RESOLVED_AUTH_LABEL\"",
      "LABELED_GIT_TOKEN_KEY=\"GIT_AUTH_TOKEN__$RESOLVED_AUTH_LABEL\"",
      "if [[ -n \"$EFFECTIVE_GH_TOKEN\" ]]; then",
      String.raw`printf "export GITHUB_TOKEN=%q\n" "$EFFECTIVE_GITHUB_TOKEN"`,
      String.raw`printf "export GH_TOKEN=%q\n" "$EFFECTIVE_GH_TOKEN"`,
      String.raw`printf "export GITLAB_TOKEN=%q\n" "$EFFECTIVE_GITLAB_TOKEN"`,
      String.raw`printf "export GLAB_IS_OAUTH2=%q\n" "$EFFECTIVE_GLAB_IS_OAUTH2"`,
      String.raw`printf "export GIT_AUTH_TOKEN=%q\n" "$EFFECTIVE_GIT_AUTH_TOKEN"`,
      "docker_git_upsert_ssh_env \"GITHUB_TOKEN\" \"$EFFECTIVE_GITHUB_TOKEN\"",
      "docker_git_upsert_ssh_env \"GH_TOKEN\" \"$EFFECTIVE_GH_TOKEN\"",
      "docker_git_upsert_ssh_env \"GITLAB_TOKEN\" \"$EFFECTIVE_GITLAB_TOKEN\"",
      "docker_git_upsert_ssh_env \"GLAB_IS_OAUTH2\" \"$EFFECTIVE_GLAB_IS_OAUTH2\"",
      "docker_git_upsert_ssh_env \"GIT_AUTH_TOKEN\" \"$EFFECTIVE_GIT_AUTH_TOKEN\"",
      "PRIVATE-TOKEN: $EFFECTIVE_GITLAB_TOKEN",
      "Authorization: Bearer $EFFECTIVE_GITLAB_TOKEN",
      "GIT_CREDENTIAL_HELPER_PATH=\"/usr/local/bin/docker-git-credential-helper\"",
      "token=\"${GITHUB_TOKEN:-}\"",
      "token=\"${GITLAB_TOKEN:-}\"",
      "token=\"${GH_TOKEN:-}\"",
      "username=\"oauth2\"",
      String.raw`printf "%s\n" "password=$token"`,
      "git config --global credential.helper"
    ])
    expect(entrypoint).not.toContain('if [[ "$GITHUB_AUTH_SKIP" != "1" && -n "$AUTH_LABEL_RAW" ]]; then')
  })

  it("renders Claude auth and wrapper bootstrap wiring", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "CLAUDE_REAL_DIR=\"$(dirname \"$CURRENT_CLAUDE_BIN\")\"",
      "CLAUDE_REAL_BIN=\"$CLAUDE_REAL_DIR/.docker-git-claude-real\"",
      "CLAUDE_WRAPPER_BIN=\"/usr/local/bin/claude\"",
      "cat <<'EOF' > \"$CLAUDE_WRAPPER_BIN\"",
      "CLAUDE_REAL_BIN=\"__CLAUDE_REAL_BIN__\"",
      "sed -i \"s#__CLAUDE_REAL_BIN__#$CLAUDE_REAL_BIN#g\" \"$CLAUDE_WRAPPER_BIN\" || true",
      "CLAUDE_CONFIG_DIR=\"${CLAUDE_CONFIG_DIR:-$HOME/.claude}\"",
      "docker_git_ensure_claude_cli()",
      "claude cli.js not found under npm global root; skip shim restore",
      "CLAUDE_PERMISSION_SETTINGS_FILE=\"$CLAUDE_CONFIG_DIR/settings.json\"",
      "docker_git_sync_claude_permissions()",
      "const currentPermissions = isRecord(settings.permissions) ? settings.permissions : {}",
      "defaultMode: \"bypassPermissions\"",
      "CLAUDE_TOKEN_FILE=\"$CLAUDE_CONFIG_DIR/.oauth-token\"",
      "CLAUDE_CREDENTIALS_FILE=\"$CLAUDE_CONFIG_DIR/.credentials.json\"",
      "CLAUDE_NESTED_CREDENTIALS_FILE=\"$CLAUDE_CONFIG_DIR/.claude/.credentials.json\"",
      "docker_git_prepare_claude_auth_mode()",
      "if [[ ! -s \"$CLAUDE_TOKEN_FILE\" ]]; then",
      "CLAUDE_SETTINGS_FILE=\"${CLAUDE_HOME_JSON:-$CLAUDE_CONFIG_DIR/.claude.json}\"",
      "CLAUDE_ROOT_TOKEN_FILE=\"$CLAUDE_AUTH_ROOT/.oauth-token\"",
      "CLAUDE_ROOT_CONFIG_FILE=\"$CLAUDE_AUTH_ROOT/.config.json\"",
      "CLAUDE_HOME_DIR=\"/home/dev/.claude\"",
      "CLAUDE_HOME_JSON=\"/home/dev/.claude.json\"",
      "docker_git_link_claude_home_file()",
      "docker_git_link_claude_home_file \".oauth-token\"",
      "docker_git_link_claude_home_file \".config.json\"",
      "docker_git_link_claude_home_file \".claude.json\"",
      "docker_git_link_claude_home_file \".credentials.json\""
    ])
  })

  it("renders Codex and Gemini project rules wiring", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "nextServers.playwright = {",
      "command: \"docker-git-playwright-mcp\"",
      "docker_git_sync_project_codex_skills()",
      "project_skills_root=\"$codex_home/skills/.docker-git-project\"",
      "docker_git_prepare_active_agent_project_rules()",
      "docker_git_detect_claude_project_rules()",
      "docker_git_detect_gemini_project_rules()",
      "\"codex\")",
      "\"claude\")",
      "\"gemini\")",
      'MCP_PLAYWRIGHT_ISOLATED="${MCP_PLAYWRIGHT_ISOLATED:-0}"',
      "\"20-agents-skills::.agents/skills\"",
      "\"30-agents-dot-skills::.agents/.skills\"",
      "\"80-codex-skills::.codex/skills\"",
      "\"90-codex-dot-skills::.codex/.skills\"",
      "$project_dir/.claude/settings.json",
      "$project_dir/.claude/agents",
      "$project_dir/.gemini/settings.json",
      "$project_dir/.gemini/commands",
      "$project_dir/.gemini/skills",
      "MCP_PLAYWRIGHT_ISOLATED=1 codex exec",
      "MCP_PLAYWRIGHT_ISOLATED=1 claude --dangerously-skip-permissions -p"
    ])
    expect(entrypoint).not.toContain("codex --approval-mode full-auto")
    expect(entrypoint).not.toContain("\"40-claude-skills::.claude/skills\"")
  })

  it("renders agent prompt glue and repeated subagent notice", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "su - dev -s /bin/bash -c \"bash -lc",
      ". /etc/profile 2>/dev/null || true;",
      String.raw`. \"$AGENT_ENV_FILE\" 2>/dev/null || true;`,
      "[[ -f /etc/profile.d/docker-host.sh ]] && cat /etc/profile.d/docker-host.sh",
      "AGENT_PROMPT_FILE=\"/run/docker-git/agent-prompt.txt\"",
      "MCP_PLAYWRIGHT_ISOLATED=1 claude --dangerously-skip-permissions -p",
      "CLAUDE_GLOBAL_PROMPT_FILE=\"/home/dev/.claude/CLAUDE.md\"",
      "CLAUDE_AUTO_SYSTEM_PROMPT=\"${CLAUDE_AUTO_SYSTEM_PROMPT:-1}\"",
      "docker-git-managed:claude-md",
      "SUBAGENTS_LINE=",
      "MANAGED_LINES=\"$(docker_git_decode_unicode_escapes \"$MANAGED_LINES\")\""
    ])
    expect(entrypoint.split("SUBAGENTS_LINE=").length - 1).toBeGreaterThanOrEqual(1)
  })

  it("renders system-prompt override hooks for codex/claude/gemini", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "docker_git_decode_unicode_escapes()",
      "CLAUDE_DEFAULT_PROMPT_BODY=\"$(docker_git_decode_unicode_escapes \"$CLAUDE_DEFAULT_PROMPT_BODY\")\"",
      "CLAUDE_SYSTEM_PROMPT_OVERRIDE_FILE=\"${CLAUDE_SYSTEM_PROMPT_OVERRIDE_FILE:-}\"",
      "CLAUDE_SYSTEM_PROMPT_OVERRIDE=\"${CLAUDE_SYSTEM_PROMPT_OVERRIDE:-}\"",
      "if [[ -n \"$CLAUDE_SYSTEM_PROMPT_OVERRIDE_FILE\" && -r \"$CLAUDE_SYSTEM_PROMPT_OVERRIDE_FILE\" ]]; then",
      "CLAUDE_PROMPT_BODY=\"$(cat \"$CLAUDE_SYSTEM_PROMPT_OVERRIDE_FILE\")\"",
      "CLAUDE_PROMPT_BODY=\"$CLAUDE_SYSTEM_PROMPT_OVERRIDE\"",
      "CLAUDE_PROMPT_BODY=\"$CLAUDE_DEFAULT_PROMPT_BODY\"",
      "CODEX_SYSTEM_PROMPT_OVERRIDE_FILE=\"${CODEX_SYSTEM_PROMPT_OVERRIDE_FILE:-}\"",
      "CODEX_SYSTEM_PROMPT_OVERRIDE=\"${CODEX_SYSTEM_PROMPT_OVERRIDE:-}\"",
      "MANAGED_LINES=\"$(cat \"$CODEX_SYSTEM_PROMPT_OVERRIDE_FILE\")\"",
      "MANAGED_LINES=\"$CODEX_SYSTEM_PROMPT_OVERRIDE\"",
      "GEMINI_SYSTEM_PROMPT_OVERRIDE_FILE=\"${GEMINI_SYSTEM_PROMPT_OVERRIDE_FILE:-}\"",
      "GEMINI_SYSTEM_PROMPT_OVERRIDE=\"${GEMINI_SYSTEM_PROMPT_OVERRIDE:-}\"",
      "GEMINI_DEFAULT_PROMPT_BODY=\"$(docker_git_decode_unicode_escapes \"$GEMINI_DEFAULT_PROMPT_BODY\")\"",
      "GEMINI_PROMPT_BODY=\"$(cat \"$GEMINI_SYSTEM_PROMPT_OVERRIDE_FILE\")\"",
      "GEMINI_PROMPT_BODY=\"$GEMINI_SYSTEM_PROMPT_OVERRIDE\"",
      "GEMINI_PROMPT_BODY=\"$GEMINI_DEFAULT_PROMPT_BODY\""
    ])
  })

  it("renders extra-skills hook for the codex skill sync function", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "local extra_specs=\"${CODEX_EXTRA_SKILLS_PATHS:-}\"",
      "if [[ -n \"$extra_specs\" ]]; then",
      "extra_specs=\"${extra_specs//,/$'\\n'}\"",
      "while IFS= read -r spec; do",
      "done <<< \"$extra_specs\""
    ])
  })

  it("renders terminal recovery hooks and disables zsh autosuggestions by default", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "stty sane < /dev/tty > /dev/tty 2>/dev/null",
      "docker_git_terminal_sanitize",
      "trap 'docker_git_terminal_sanitize' EXIT INT TERM",
      "add-zsh-hook zshexit docker_git_terminal_on_exit",
      "TRAPINT() {",
      'if [[ "${DOCKER_GIT_ZSH_AUTOSUGGEST:-0}" == "1" ]]',
      "DOCKER_GIT_ZSH_AUTOSUGGEST=0"
    ])
  })
})

describe("renderDockerCompose", () => {
  it("pins the compose project name to the managed service name", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        serviceName: "dg-docker-git",
        containerName: "dg-docker-git"
      })
    )

    expect(compose).toContain("name: dg-docker-git")
    expect(compose.indexOf("name: dg-docker-git")).toBeLessThan(compose.indexOf("services:"))
  })

  it("renders fallback DNS servers for the main container even without Playwright", () => {
    const compose = renderDockerCompose(makeTemplateConfig())

    expect(compose).toContain("name: dg-test")
    expect(compose).toContain("container_name: dg-test")
    expect(compose).toContain("    env_file:\n      - /workspace/.orch/env/global.env\n      - /workspace/.orch/env/project.env\n")
    expect(compose).toContain('DOCKER_GIT_PROJECT_DOCKER_HOST: "${DOCKER_GIT_PROJECT_DOCKER_HOST:-}"')
    expect(compose).toContain('- "${DOCKER_GIT_PROJECT_SSH_BIND_HOST:-127.0.0.1}:2222:22"')
    expect(compose).toContain('    extra_hosts:\n      - "host.docker.internal:host-gateway"')
    expect(compose).toContain("    dns:\n      - 8.8.8.8\n      - 8.8.4.4\n      - 1.1.1.1\n    networks:")
    expect(compose).not.toContain("dg-test-browser")
    expect(compose).not.toContain("/var/run/docker.sock:/var/run/docker.sock")
    expect((compose.match(/\n    dns:\n/g) ?? []).length).toBe(1)
  })

  it("persists explicit Docker host into login and SSH environments before socket fallback", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig())

    expect(entrypoint).toContain('if [[ -n "${DOCKER_GIT_PROJECT_DOCKER_HOST:-}" && -z "${DOCKER_HOST:-}" ]]; then')
    expect(entrypoint).toContain('printf "export DOCKER_HOST=%q\\n" "$DOCKER_HOST" > /etc/profile.d/docker-host.sh')
    expect(entrypoint).toContain('docker_git_upsert_ssh_env "DOCKER_HOST" "$DOCKER_HOST"')
    expect(entrypoint).toContain('elif [[ -S /var/run/docker.sock ]]; then')
    expect(entrypoint).toContain('docker_git_upsert_ssh_env "DOCKER_HOST" "unix:///var/run/docker.sock"')
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
    expect(compose).toContain("dg-test-browser:\n    build:")
    expect(compose.slice(browserServiceIndex)).toContain(
      "    env_file:\n      - /workspace/.orch/env/global.env\n      - /workspace/.orch/env/project.env\n"
    )
    expect(browserServiceIndex).toBeGreaterThanOrEqual(0)
    expect(browserDnsIndex).toBeGreaterThan(browserServiceIndex)
    expect((compose.match(/\n    dns:\n/g) ?? []).length).toBe(2)
  })

  it("applies separate resource limits for the browser sidecar when provided", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        enableMcpPlaywright: true
      }),
      {
        main: { cpuLimit: 2, ramLimit: "4g" },
        playwright: { cpuLimit: 0.5, ramLimit: "1g" }
      }
    )
    const browserServiceIndex = compose.indexOf("\n  dg-test-browser:\n")
    const browserSection = compose.slice(browserServiceIndex)
    const mainSection = compose.slice(0, browserServiceIndex)

    expect(browserServiceIndex).toBeGreaterThanOrEqual(0)
    expect(mainSection).toContain("    cpus: 2\n")
    expect(mainSection).toContain('    mem_limit: "4g"\n')
    expect(mainSection).toContain('    memswap_limit: "4g"\n')
    expect(browserSection).toContain("    cpus: 0.5\n")
    expect(browserSection).toContain('    mem_limit: "1g"\n')
    expect(browserSection).toContain('    memswap_limit: "1g"\n')
  })

  it("backward-compatibly applies single resource limit shape to both services", () => {
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
    const browserSection = compose.slice(browserServiceIndex)

    expect(browserServiceIndex).toBeGreaterThanOrEqual(0)
    expect(browserSection).toContain("    cpus: 1.5\n")
    expect(browserSection).toContain('    mem_limit: "2g"\n')
  })

  it("renders explicit anonymous GitHub clone override for public repos", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        skipGithubAuth: true
      })
    )
    const entrypoint = renderEntrypoint(
      makeTemplateConfig({
        skipGithubAuth: true
      })
    )

    expect(compose).toContain('GITHUB_AUTH_SKIP: "1"')
    expect(entrypoint).toContain('GITHUB_AUTH_SKIP="${GITHUB_AUTH_SKIP:-0}"')
    expect(entrypoint).toContain('if [[ "${GITHUB_AUTH_SKIP:-0}" == "1" && "$REPO_URL" == https://github.com/* ]]; then')
  })
})

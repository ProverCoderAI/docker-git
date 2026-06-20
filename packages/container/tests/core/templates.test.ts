import * as Command from "@effect/platform/Command"
import { NodeContext } from "@effect/platform-node"
import { describe, expect, it } from "@effect/vitest"
import { Effect, pipe } from "effect"
import * as fc from "fast-check"

import { defaultTemplateConfig, type TemplateConfig } from "../../src/core/domain.js"
import { planFiles } from "../../src/core/templates.js"
import { renderDockerCompose } from "../../src/core/templates/docker-compose.js"
import { renderDockerfile } from "../../src/core/templates/dockerfile.js"
import { renderEntrypoint } from "../../src/core/templates-entrypoint.js"
import { renderEntrypointDnsRepair } from "../../src/core/templates-entrypoint/dns-repair.js"
import { renderEntrypointGitHooks } from "../../src/core/templates-entrypoint/git.js"
import { renderPromptScript } from "../../src/core/templates-prompt.js"

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
  grokAuthPath: "/workspace/.orch/auth/grok",
  gpu: "none",
  ...overrides
})

const expectContainsAll = (value: string, snippets: ReadonlyArray<string>): void => {
  for (const snippet of snippets) {
    expect(value).toContain(snippet)
  }
}

const generatedTemplateConfigArbitrary: fc.Arbitrary<TemplateConfig> = fc
  .record({
    gpu: fc.constantFrom<TemplateConfig["gpu"]>("none", "all"),
    projectIndex: fc.integer({ min: 1, max: 100_000 }),
    sshPort: fc.integer({ min: 1_024, max: 65_535 }),
    sshUserIndex: fc.integer({ min: 1, max: 100_000 })
  })
  .map(({ gpu, projectIndex, sshPort, sshUserIndex }) => {
    const sshUser = `dev${sshUserIndex}`
    const projectName = `repo-${projectIndex}`

    return makeTemplateConfig({
      containerName: `dg-test-${projectIndex}`,
      gpu,
      serviceName: `dg-test-${projectIndex}`,
      sshPort,
      sshUser,
      targetDir: `/home/${sshUser}/org/${projectName}`,
      volumeName: `dg-test-${projectIndex}-home`
    })
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
    const packageCacheIndex = entrypoint.indexOf('PACKAGE_CACHE_ROOT="/home/dev/.docker-git/.cache/packages"')

    expect(dnsRepairIndex).toBeGreaterThanOrEqual(0)
    expect(packageCacheIndex).toBeGreaterThan(dnsRepairIndex)
  })
})

describe("renderDockerfile", () => {
  it("uses the shared JS box image as the project container base", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expect(dockerfile).toContain("ARG DOCKER_GIT_BASE_IMAGE=konard/box-js:2.1.1")
    expect(dockerfile).toContain("FROM ${DOCKER_GIT_BASE_IMAGE}")
    expect(dockerfile).toContain("make build-essential docker.io")
    expect(dockerfile).toContain(
      "#checkov:skip=CKV_DOCKER_8: docker-git entrypoint must start as root to prepare SSH/auth/bootstrap and run sshd"
    )
    expect(dockerfile).toContain("USER root")
    expect(dockerfile).not.toContain("FROM ubuntu:24.04")
  })

  it("renames the UID 1000 base user to the configured SSH user before the box fallback", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expect(dockerfile).toContain("for BASE_USER in ubuntu box; do")
    expect(dockerfile).toContain('if [ "$BASE_USER" != "dev" ] && id -u "$BASE_USER" >/dev/null 2>&1; then')
    expect(dockerfile).toContain('usermod -l dev -d /home/dev -m -s /usr/bin/zsh "$BASE_USER" || true')
  })

  it("normalizes inherited box image HOME and workdir to the configured SSH user", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expectContainsAll(dockerfile, [
      "ENV HOME=/home/dev",
      "ENV PATH=/usr/local/bun/bin:/home/dev/.deno/bin:/home/dev/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
      "WORKDIR /home/dev"
    ])
  })

  it("preserves HOME/PATH/WORKDIR normalization for generated configs", () => {
    fc.assert(
      fc.property(generatedTemplateConfigArbitrary, (config) => {
        const dockerfile = renderDockerfile(config)
        const home = `/home/${config.sshUser}`

        expectContainsAll(dockerfile, [
          `ENV HOME=${home}`,
          `ENV PATH=/usr/local/bun/bin:${home}/.deno/bin:${home}/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
          `WORKDIR ${home}`
        ])
        expect(dockerfile).not.toContain("ENV HOME=/home/box")
        expect(dockerfile).not.toContain("ENV HOME=/home/ubuntu")
        expect(dockerfile).not.toContain("WORKDIR /home/box")
        expect(dockerfile).not.toContain("WORKDIR /home/ubuntu")
        expect(dockerfile).not.toContain("ENV PATH=/usr/local/bun/bin:/home/box/")
        expect(dockerfile).not.toContain("ENV PATH=/usr/local/bun/bin:/home/ubuntu/")
      })
    )
  })

  it("rewrites inherited login rc files away from the base image home", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expectContainsAll(dockerfile, [
      "find /home/dev -maxdepth 2 -type f",
      '-name ".profile" -o -name ".bash_profile" -o -name ".bashrc" -o -name ".zprofile" -o -name ".zshenv" -o -name ".zshrc"',
      '-exec sed -i -e "s|/home/box|/home/dev|g" -e "s|/home/ubuntu|/home/dev|g" {} +;'
    ])
  })

  it("keeps the runtime PATH extension relative to the login shell environment", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expect(dockerfile).toContain('RUN printf "export PATH=/usr/local/bun/bin:\\$PATH\\n"')
    expect(dockerfile).not.toContain('RUN printf "export PATH=/usr/local/bun/bin:$PATH\\n"')
  })

  it("does not recursively chown the inherited home directory from the base image", () => {
    const config = makeTemplateConfig()
    const dockerfile = renderDockerfile(config)

    expect(dockerfile).toContain('chown 1000:1000 "$HOME_DIR"')
    expect(dockerfile).toContain('TARGET_DIR_CANON="$TARGET_DIR"')
    expect(dockerfile).toContain('HOME_DIR_CANON="$HOME_DIR"')
    expect(dockerfile).toContain('chown -R 1000:1000 "$TARGET_DIR"')
    expect(dockerfile).toContain(
      'if [ "$TARGET_DIR_CANON" != "/" ] && [ "$TARGET_DIR_CANON" != "$HOME_DIR_CANON" ]; then chown -R 1000:1000 "$TARGET_DIR"; fi'
    )
    expect(dockerfile).not.toContain("chown -R 1000:1000 /home/dev")
    expect(dockerfile).not.toContain(`chown -R 1000:1000 /home/${config.sshUser}`)
    expect(dockerfile).not.toContain('if [ "$TARGET_DIR" != "/" ] && [ "$TARGET_DIR" != "$HOME_DIR" ]')
  })

  it("normalizes trailing slashes before deciding whether to chown the target directory", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig({ targetDir: "/home/dev/" }))

    expectContainsAll(dockerfile, [
      "TARGET_DIR='/home/dev/';",
      'while [ "${TARGET_DIR_CANON%/}" != "$TARGET_DIR_CANON" ]; do TARGET_DIR_CANON="${TARGET_DIR_CANON%/}"; done;',
      '[ -n "$TARGET_DIR_CANON" ] || TARGET_DIR_CANON="/";',
      'if [ "$TARGET_DIR_CANON" != "/" ] && [ "$TARGET_DIR_CANON" != "$HOME_DIR_CANON" ]; then chown -R 1000:1000 "$TARGET_DIR"; fi'
    ])
  })

  it("renders targetDir as a single-quoted shell literal in workspace setup", () => {
    const config = makeTemplateConfig({
      targetDir: "/home/dev/org/repo'$(touch-pwned)`echo-pwned`"
    })
    const dockerfile = renderDockerfile(config)

    expect(dockerfile).toContain("TARGET_DIR='/home/dev/org/repo'\"'\"'$(touch-pwned)`echo-pwned`';")
    expect(dockerfile).not.toContain("TARGET_DIR=\"/home/dev/org/repo'$(touch-pwned)`echo-pwned`\"")
  })

  it("installs session sync from npmjs with a local fallback", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expectContainsAll(dockerfile, [
      "# Tooling: GitLab CLI (glab)",
      "https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/packages/generic/glab/",
      "glab_1.93.0_linux_$GLAB_ARCH.deb",
      "curl -fsSL --retry 5 --retry-all-errors --retry-delay 2",
      "glab --version",
      "ncurses-term jq",
      "sudo tmux",
      "# Tooling: RTK (Rust Token Killer)",
      "ARG RTK_VERSION=v0.39.0",
      'https://raw.githubusercontent.com/rtk-ai/rtk/${RTK_VERSION}/install.sh',
      'RTK_VERSION="${RTK_VERSION}" RTK_INSTALL_DIR=/usr/local/bin sh /tmp/rtk-install.sh',
      "rtk --version",
      "rtk gain >/dev/null 2>&1 || true",
      "# Install plan-to-git for multi-agent plan capture and explicit PR sync (issue #397)",
      "ADD https://api.github.com/repos/ProverCoderAI/plan-to-git/commits/main /tmp/docker-git-plan-to-git-main.json",
      "cargo install --git https://github.com/ProverCoderAI/plan-to-git --branch main --locked --bins --root /usr/local",
      "/usr/local/bin/plan-to-git --help >/dev/null",
      '/usr/local/bin/plan-to-git --help | grep -q -- "--repo"',
      '/usr/local/bin/plan-to-git hook --help | grep -q -- "claude"',
      '/usr/local/bin/plan-to-git sync --help | grep -q -- "--pr <PR>"',
      'ARG DOCKER_GIT_SESSION_SYNC_PACKAGE="@prover-coder-ai/docker-git-session-sync@latest"',
      'COPY .docker-git-tools/docker-git-session-sync /opt/docker-git/tools/docker-git-session-sync',
      'npm install -g "$DOCKER_GIT_SESSION_SYNC_PACKAGE"',
      "docker-git-session-sync --help >/dev/null",
      "using local session sync fallback",
      "install -m 0755 /opt/docker-git/tools/docker-git-session-sync /usr/local/bin/docker-git-session-sync"
    ])
    expect(dockerfile).not.toContain("glab_1.93.0_linux_\\$GLAB_ARCH.deb")
  })

  it("installs Grok CLI for generated project containers", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig())

    expectContainsAll(dockerfile, [
      "https://x.ai/cli/install.sh",
      "GROK_BIN_DIR=/usr/local/bin bash /tmp/grok-install.sh 0.1.211",
      "grok --version"
    ])
    expect(dockerfile).not.toContain("grok-dev")
    expect(dockerfile).not.toContain("npm install -g grok-dev")
    expect(dockerfile).not.toContain("grok --version >/dev/null || true")
  })

  it("renders Rust browser binaries without the legacy Playwright MCP wrapper", () => {
    const dockerfile = renderDockerfile(makeTemplateConfig({ enableMcpPlaywright: true }))

    expectContainsAll(dockerfile, [
      "cargo install --git https://github.com/ProverCoderAI/rust-browser-connection --rev 8f0aa06397030a198259e9ad9a1dc0e6a5aed967 --locked --bins --root /usr/local",
      "/usr/local/bin/docker-git-browser-connection --version",
      "/usr/local/bin/browser-connection --version",
      "# Unified Rust browser (dg-*-browser) start/reuse is owned by browser-connection"
    ])
    expect(dockerfile).not.toContain("docker-git-playwright-mcp")
    expect(dockerfile).not.toContain("@playwright/mcp")
    expect(dockerfile).not.toContain("playwright-mcp --cdp-endpoint")
    expect(dockerfile).not.toContain("MCP_PLAYWRIGHT_CDP_TIMEOUT")
  })
})

describe("renderPromptScript", () => {
  it.effect("is silent when sourced by a non-interactive shell without a controlling TTY", () =>
    pipe(
      Command.make(
        "bash",
        "-lc",
        String.raw`set -euo pipefail; { source <(printf '%s' "$DOCKER_GIT_PROMPT_SCRIPT"); } 2>&1; printf ok`
      ),
      Command.env({ DOCKER_GIT_PROMPT_SCRIPT: renderPromptScript() }),
      Command.stdout("pipe"),
      Command.stderr("pipe"),
      Command.string,
      Effect.tap((output) => Effect.sync(() => expect(output).toBe("ok"))),
      Effect.asVoid,
      Effect.provide(NodeContext.layer)
    )
  )

  it("keeps interactive prompt mutations behind the non-interactive guard", () => {
    const nonInteractiveGuard = "*) return 0 2>/dev/null || exit 0 ;;"

    fc.assert(
      fc.property(
        fc.constantFrom("PROMPT_COMMAND=", "PS1=", "trap 'docker_git_terminal_sanitize' EXIT"),
        (interactiveMutation) => {
          const script = renderPromptScript()
          const guardIndex = script.indexOf(nonInteractiveGuard)

          expect(guardIndex).toBeGreaterThanOrEqual(0)
          expect(script.indexOf(interactiveMutation)).toBeGreaterThan(guardIndex)
        }
      )
    )
  })

  it("does not run terminal recovery traps for active interrupt or terminate signals", () => {
    const script = renderPromptScript()

    expect(script).toContain("trap 'docker_git_terminal_sanitize' EXIT")
    expect(script).not.toContain("trap 'docker_git_terminal_sanitize' EXIT INT TERM")
    expect(script).not.toContain("trap 'docker_git_terminal_sanitize' INT")
    expect(script).not.toContain("trap 'docker_git_terminal_sanitize' TERM")
  })

  it("gates terminal recovery before stty sane can touch the TTY", () => {
    const script = renderPromptScript()
    const guardIndex = script.indexOf("docker_git_terminal_should_sanitize || return 0")
    const sttyIndex = script.indexOf("{ stty sane < /dev/tty > /dev/tty; }")

    expect(script).toContain("docker_git_terminal_has_agent_ancestor")
    expect(script).toContain("docker_git_terminal_command_basename")
    expect(script).toContain("printenv DOCKER_GIT_TERMINAL_FORCE_SANITIZE")
    expect(script).toContain("printenv DOCKER_GIT_TERMINAL_DISABLE_SANITIZE")
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(sttyIndex).toBeGreaterThan(guardIndex)
  })

  it.effect("matches only agent command basenames for terminal recovery suppression", () =>
    pipe(
      Command.make(
        "bash",
        "-lc",
        String.raw`set -euo pipefail
source <(printf '%s' "$DOCKER_GIT_PROMPT_SCRIPT")
for command_line in \
  "claude --dangerously-skip-permissions" \
  "/usr/bin/.docker-git-claude-real" \
  "/usr/local/bin/codex resume" \
  "/opt/bin/opencode" \
  "/usr/bin/gemini --model test" \
  "/usr/bin/grok"; do
  docker_git_terminal_is_agent_command "$command_line" || { printf 'missing:%s' "$command_line"; exit 1; }
done
for command_line in "codex-helper" "/tmp/grok-cache" "myclaude" "node /usr/bin/playwright-mcp"; do
  if docker_git_terminal_is_agent_command "$command_line"; then
    printf 'false-positive:%s' "$command_line"
    exit 1
  fi
done
printf ok`
      ),
      Command.env({ DOCKER_GIT_PROMPT_SCRIPT: renderPromptScript() }),
      Command.stdout("pipe"),
      Command.stderr("pipe"),
      Command.string,
      Effect.tap((output) => Effect.sync(() => expect(output).toBe("ok"))),
      Effect.asVoid,
      Effect.provide(NodeContext.layer)
    )
  )

  it.effect("skips terminal recovery when the shell is under an agent process", () =>
    pipe(
      Command.make(
        "bash",
        "-lc",
        String.raw`set -euo pipefail
tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT
cat > "$tmp/ps" <<'EOS'
#!/usr/bin/env bash
if [ "$1" = "-o" ] && [ "$2" = "args=" ]; then
  printf '%s\n' "/usr/bin/.docker-git-claude-real"
  exit 0
fi
if [ "$1" = "-o" ] && [ "$2" = "ppid=" ]; then
  printf '%s\n' "0"
  exit 0
fi
exit 1
EOS
chmod +x "$tmp/ps"
PATH="$tmp:$PATH"
source <(printf '%s' "$DOCKER_GIT_PROMPT_SCRIPT")
if docker_git_terminal_should_sanitize; then
  printf bad
else
  printf ok
fi`
      ),
      Command.env({ DOCKER_GIT_PROMPT_SCRIPT: renderPromptScript() }),
      Command.stdout("pipe"),
      Command.stderr("pipe"),
      Command.string,
      Effect.tap((output) => Effect.sync(() => expect(output).toBe("ok"))),
      Effect.asVoid,
      Effect.provide(NodeContext.layer)
    )
  )

  it.effect("allows terminal recovery when no agent is in the shell ancestry", () =>
    pipe(
      Command.make(
        "bash",
        "-lc",
        String.raw`set -euo pipefail
tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT
cat > "$tmp/ps" <<'EOS'
#!/usr/bin/env bash
if [ "$1" = "-o" ] && [ "$2" = "args=" ]; then
  printf '%s\n' "-zsh"
  exit 0
fi
if [ "$1" = "-o" ] && [ "$2" = "ppid=" ]; then
  printf '%s\n' "0"
  exit 0
fi
exit 1
EOS
chmod +x "$tmp/ps"
PATH="$tmp:$PATH"
source <(printf '%s' "$DOCKER_GIT_PROMPT_SCRIPT")
if docker_git_terminal_should_sanitize; then
  printf ok
else
  printf bad
fi`
      ),
      Command.env({ DOCKER_GIT_PROMPT_SCRIPT: renderPromptScript() }),
      Command.stdout("pipe"),
      Command.stderr("pipe"),
      Command.string,
      Effect.tap((output) => Effect.sync(() => expect(output).toBe("ok"))),
      Effect.asVoid,
      Effect.provide(NodeContext.layer)
    )
  )
})

describe("renderEntrypoint clone cache", () => {
  it("renders the default targetDir as a shell literal without evaluating substitutions", () => {
    const config = makeTemplateConfig({
      targetDir: "/home/dev/org/repo'$(touch-pwned)`echo-pwned`"
    })
    const entrypoint = renderEntrypoint(config)

    expect(entrypoint).toContain('TARGET_DIR="${TARGET_DIR:-}"')
    expect(entrypoint).toContain("TARGET_DIR='/home/dev/org/repo'\"'\"'$(touch-pwned)`echo-pwned`'")
    expect(entrypoint).not.toContain('TARGET_DIR="${TARGET_DIR:-/home/dev/org/repo')
  })

  it("refreshes mirrors without broad remote refs", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig())

    expect(entrypoint).toContain("git --git-dir '$CACHE_REPO_DIR' fetch")
    expect(entrypoint).toContain("'+refs/heads/*:refs/heads/*'")
    expect(entrypoint).toContain("'+refs/tags/*:refs/tags/*'")
    expect(entrypoint).not.toContain("'+refs/*:refs/*'")
    expect(entrypoint).not.toContain("'+refs/pull/*:refs/pull/*'")
    expect(entrypoint).not.toContain("'+refs/merge-requests/*:refs/merge-requests/*'")
  })

  it("rewrites the managed Codex resume hint at container startup", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig())

    expect(entrypoint).toContain('cat <<\'EOF\' > "$CODEX_HINT_PATH"')
    expect(entrypoint).toContain('chmod 0644 "$CODEX_HINT_PATH"')
    expect(entrypoint).not.toContain('if [[ ! -s "$CODEX_HINT_PATH" ]]; then')
  })

  it("publishes runtime project identity before Codex resume hints", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig())

    const projectProfileIndex = entrypoint.indexOf('DOCKER_GIT_PROJECT_PROFILE="/etc/profile.d/docker-git-project.sh"')
    const resumeHintIndex = entrypoint.indexOf('CODEX_HINT_PATH="/etc/profile.d/zz-codex-resume.sh"')

    expect(projectProfileIndex).toBeGreaterThanOrEqual(0)
    expect(resumeHintIndex).toBeGreaterThan(projectProfileIndex)
    expect(entrypoint).toContain('printf "export REPO_REF=%q\\n" "$REPO_REF"')
    expect(entrypoint).toContain('printf "export REPO_URL=%q\\n" "$REPO_URL"')
    expect(entrypoint).toContain('docker_git_upsert_ssh_env "REPO_REF" "$REPO_REF"')
    expect(entrypoint).toContain('docker_git_upsert_ssh_env "REPO_URL" "$REPO_URL"')
  })

  it("preserves branch/tag-only clone-cache refspecs for generated configs", () => {
    fc.assert(
      fc.property(generatedTemplateConfigArbitrary, (config) => {
        const entrypoint = renderEntrypoint(config)
        const cloneCacheFetch = entrypoint
          .split("\n")
          .find((line) => line.includes("git --git-dir '$CACHE_REPO_DIR' fetch"))

        expect(cloneCacheFetch).toBeDefined()
        expect(cloneCacheFetch).toContain("'+refs/heads/*:refs/heads/*'")
        expect(cloneCacheFetch).toContain("'+refs/tags/*:refs/tags/*'")
        expect(cloneCacheFetch).not.toContain("'+refs/*:refs/*'")
        expect(cloneCacheFetch).not.toContain("refs/pull")
        expect(cloneCacheFetch).not.toContain("refs/merge-requests")
      })
    )
  })
})

describe("renderEntrypoint tilde target dir expansion", () => {
  // CHANGE: assert runtime `~`/`~/...` TARGET_DIR overrides resolve to the dev-owned home
  // WHY: the entrypoint runs as root (sshd), so `$HOME` is /root; expanding a tilde TARGET_DIR
  //      against `$HOME` resolved the clone target to /root/app, which `su - dev` cannot write,
  //      so `git clone` failed and the workspace `app` folder stayed EMPTY (issue #413)
  // QUOTE(ТЗ): "Почему-то при docker-git clone не делается git clone в папку app"
  // REF: issue-413
  // FORMAT THEOREM: expand("~") = /home/<sshUser> ∧ expand("~/p") = /home/<sshUser>/p
  it("expands a bare `~` against the dev home, not root's $HOME", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig({ sshUser: "dev" }))

    expect(entrypoint).toContain('if [[ "$TARGET_DIR" == "~" ]]; then')
    expect(entrypoint).toContain('TARGET_DIR="/home/dev"')
    expect(entrypoint).toContain('TARGET_DIR="/home/dev${TARGET_DIR:1}"')
    expect(entrypoint).not.toContain('TARGET_DIR="$HOME"')
    expect(entrypoint).not.toContain('TARGET_DIR="$HOME${TARGET_DIR:1}"')
  })

  it("expands the tilde against the configured ssh user for generated configs", () => {
    fc.assert(
      fc.property(generatedTemplateConfigArbitrary, (config) => {
        const entrypoint = renderEntrypoint(config)

        expect(entrypoint).toContain(`TARGET_DIR="/home/${config.sshUser}"`)
        expect(entrypoint).toContain(`TARGET_DIR="/home/${config.sshUser}\${TARGET_DIR:1}"`)
        expect(entrypoint).not.toContain('TARGET_DIR="$HOME"')
        expect(entrypoint).not.toContain('TARGET_DIR="$HOME${TARGET_DIR:1}"')
      })
    )
  })
})

describe("renderEntrypointGitHooks", () => {
  it("installs pre-push protection checks, plan sync, and a global git post-push runtime", () => {
    const hooks = renderEntrypointGitHooks()

    expect(hooks).toContain('PRE_PUSH_HOOK="$HOOKS_DIR/pre-push"')
    expect(hooks).toContain('POST_PUSH_ACTION="$HOOKS_DIR/post-push"')
    expect(hooks).toContain('PLAN_TO_GIT_SYNC_HELPER="$HOOKS_DIR/plan-to-git-sync"')
    expect(hooks).toContain('PLAN_TO_GIT_CODEX_HOOK="$HOOKS_DIR/plan-to-git-codex-hook"')
    expect(hooks).toContain('PLAN_TO_GIT_CLAUDE_HOOK="$HOOKS_DIR/plan-to-git-claude-hook"')
    expect(hooks).toContain('CODEX_REQUIREMENTS_FILE="/etc/codex/requirements.toml"')
    expect(hooks).toContain('CLAUDE_PLAN_TO_GIT_SETTINGS_FILE="$CLAUDE_CONFIG_DIR/settings.json"')
    expect(hooks).toContain('GIT_WRAPPER_BIN="/usr/local/bin/git"')
    expect(hooks).toContain('type -aP git')
    expect(hooks).toContain("cat <<'EOF' > \"$PRE_PUSH_HOOK\"")
    expect(hooks).toContain("cat <<'EOF' > \"$PLAN_TO_GIT_SYNC_HELPER\"")
    expect(hooks).toContain("cat <<'EOF' > \"$POST_PUSH_ACTION\"")
    expect(hooks).toContain("cat <<'EOF' > \"$PLAN_TO_GIT_CODEX_HOOK\"")
    expect(hooks).toContain("cat <<'EOF' > \"$PLAN_TO_GIT_CLAUDE_HOOK\"")
    expect(hooks).toContain("cat <<'EOF' > \"$CODEX_REQUIREMENTS_FILE\"")
    expect(hooks).toContain("cat <<'EOF' > \"$GIT_WRAPPER_BIN\"")
    expect(hooks).toContain("check_issue_managed_block_range")
    expect(hooks).toContain("Run plan sync and session backup after successful push")
    expect(hooks).toContain("docker_git_ensure_open_pr")
    expect(hooks).toContain("docker_git_github_repo_from_remote_url")
    expect(hooks).toContain("gh pr list --repo \"$base_repo\" --state open --head \"$head_arg\"")
    expect(hooks).toContain("gh pr create --repo \"$base_repo\" --base \"$base_branch\" --head \"$head_arg\" --fill")
    expect(hooks).toContain("[post-push-pr] Error: cannot create PR from detached HEAD")
    expect(hooks).toContain("[post-push-pr] Error: failed to list open PRs")
    expect(hooks).toContain("DOCKER_GIT_SKIP_PLAN_TO_GIT")
    expect(hooks).toContain("docker_git_plan_to_git_run")
    expect(hooks).toContain('base_repo="$(docker_git_github_repo_from_remote origin || true)"')
    expect(hooks).toContain('PLAN_TO_GIT_REPO="$base_repo" plan-to-git "$@"')
    expect(hooks).toContain("docker_git_plan_to_git_run import-codex --no-sync")
    expect(hooks).toContain("docker_git_plan_to_git_run import-claude --no-sync")
    expect(hooks).toContain("docker_git_plan_to_git_explicit_pr_supported")
    expect(hooks).toContain("docker_git_plan_to_git_resolve_pr_number")
    expect(hooks).toContain("DOCKER_GIT_PR_NUMBER PR_NUMBER GITHUB_PR_NUMBER")
    expect(hooks).toContain('candidate="${REPO_REF:-}"')
    expect(hooks).toContain('docker_git_plan_to_git_run sync --pr "$pr_number"')
    expect(hooks).toContain("docker_git_plan_to_git_run sync")
    expect(hooks).toContain('[plan-to-git] Syncing queued agent plans to PR #$pr_number')
    expect(hooks).toContain("docker_git_plan_to_git_run hook --source codex")
    expect(hooks).toContain("docker_git_plan_to_git_run hook --source claude")
    expect(hooks).toContain('export PLAN_TO_GIT_STATE_DIR="${PLAN_TO_GIT_STATE_DIR:-/tmp/plan-to-git}"')
    expect(hooks).toContain('"$PLAN_TO_GIT_SYNC_HELPER" >&2 || true')
    expect(hooks).toContain("docker_git_install_claude_plan_to_git_hooks")
    expect(hooks).toContain('const hookCommand = process.env.PLAN_TO_GIT_CLAUDE_HOOK || "/opt/docker-git/hooks/plan-to-git-claude-hook"')
    expect(hooks).toContain('ensureEventHook("UserPromptSubmit")')
    expect(hooks).toContain('ensureEventHook("Stop")')
    expect(hooks).toContain("[features]")
    expect(hooks).toContain("hooks = true")
    expect(hooks).toContain('managed_dir = "/opt/docker-git/hooks"')
    expect(hooks).toContain("[[hooks.UserPromptSubmit]]")
    expect(hooks).toContain("[[hooks.Stop]]")
    expect(hooks).toContain('command = "/opt/docker-git/hooks/plan-to-git-codex-hook"')
    expect(hooks).not.toContain("allow_managed_hooks_only")
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

    const cdIndex = hooks.indexOf('cd "$REPO_ROOT"')
    const ensurePrIndex = hooks.indexOf("docker_git_ensure_open_pr\n\n# CHANGE: backfill agent session plans")
    const planImportIndex = hooks.indexOf("docker_git_plan_to_git_run import-codex --no-sync")
    const claudeImportIndex = hooks.indexOf("docker_git_plan_to_git_run import-claude --no-sync")
    const planSyncIndex = hooks.indexOf('"$PLAN_TO_GIT_SYNC_HELPER"', claudeImportIndex)
    const sessionBackupIndex = hooks.indexOf("docker-git-session-sync backup --verbose --background --require-comment")

    expect(cdIndex).toBeGreaterThanOrEqual(0)
    expect(ensurePrIndex).toBeGreaterThan(cdIndex)
    expect(planImportIndex).toBeGreaterThan(ensurePrIndex)
    expect(claudeImportIndex).toBeGreaterThan(planImportIndex)
    expect(planSyncIndex).toBeGreaterThan(claudeImportIndex)
    expect(sessionBackupIndex).toBeGreaterThan(planSyncIndex)
  })
})

describe("planFiles generated ignores", () => {
  it("keeps plan-to-git state out of git and docker build contexts", () => {
    fc.assert(
      fc.property(generatedTemplateConfigArbitrary, (config) => {
        const files = planFiles(config)
        const gitignore = files.find(
          (file): file is Extract<(typeof files)[number], { readonly _tag: "File" }> =>
            file._tag === "File" && file.relativePath === ".gitignore"
        )
        const dockerignore = files.find(
          (file): file is Extract<(typeof files)[number], { readonly _tag: "File" }> =>
            file._tag === "File" && file.relativePath === ".dockerignore"
        )

        expect(gitignore?.contents).toContain(".agent-plan.json")
        expect(dockerignore?.contents).toContain(".agent-plan.json")
      })
    )
  })
})

describe("renderEntrypoint auth bridge", () => {
  const renderAuthEntrypoint = (): string =>
    renderEntrypoint(
      makeTemplateConfig({
        enableMcpPlaywright: false,
        gpu: "none",
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

  // CHANGE: assert the per-host generic git credential resolution + env export
  // WHY: issue #368 wants git connections to providers other than github/gitlab via token
  // QUOTE(ТЗ): "реализовать возможность добавлять git подключения отличных от gitlab, github"
  // REF: issue-368
  // SOURCE: https://git-scm.com/docs/gitcredentials
  // FORMAT THEOREM: helper resolves GIT_AUTH_TOKEN__<HOST_KEY> before github/gitlab defaults
  // PURITY: CORE (string assertions over rendered shell)
  // EFFECT: n/a
  // INVARIANT: HOST_KEY normalization mirrors the CLI/web auth flows
  // COMPLEXITY: O(n) where n = |entrypoint|
  it("renders host-scoped generic git credential resolution and env export", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "GIT_AUTH_HOSTS_ENV_FILE=\"/etc/profile.d/git-auth-hosts.sh\"",
      "for GIT_AUTH_HOST_VAR in $(compgen -v | grep -E '^GIT_AUTH_(TOKEN|USER)__' || true); do",
      "docker_git_upsert_ssh_env \"$GIT_AUTH_HOST_VAR\" \"$GIT_AUTH_HOST_VAL\"",
      "host_key=\"$(printf \"%s\" \"$host\" | tr '[:lower:]' '[:upper:]' | sed -E 's/[^A-Z0-9]+/_/g; s/^_+//; s/_+$//')\"",
      "if [[ \"$protocol\" == \"https\" && -n \"$host_key\" ]]; then",
      "host_token_key=\"GIT_AUTH_TOKEN__$host_key\"",
      "host_user_key=\"GIT_AUTH_USER__$host_key\""
    ])
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

  it("renders Codex, Gemini and Grok project rules wiring", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      "nextServers.playwright = {",
      "command: \"browser-connection\"",
      "docker_git_sync_project_codex_skills()",
      "project_skills_root=\"$codex_home/skills/.docker-git-project\"",
      "docker_git_prepare_active_agent_project_rules()",
      "docker_git_detect_claude_project_rules()",
      "docker_git_detect_gemini_project_rules()",
      "docker_git_detect_grok_project_rules()",
      "docker_git_sync_gemini_playwright_mcp()",
      "docker_git_sync_grok_playwright_mcp()",
      'local browser_project="${DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"',
      'DOCKER_GIT_BROWSER_PROJECT="${DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"',
      'MCP_PLAYWRIGHT_ENABLE="${MCP_PLAYWRIGHT_ENABLE:-0}" DOCKER_GIT_BROWSER_PROJECT="$browser_project" DOCKER_GIT_BROWSER_NETWORK="$browser_network" node',
      "DOCKER_GIT_RTK_ENABLE=\"${DOCKER_GIT_RTK_ENABLE:-1}\"",
      "DOCKER_GIT_RTK_ENABLE=1",
      "docker_git_rtk_init_as_user()",
      "mkdir -p \"$CLAUDE_CONFIG_DIR\" \"/home/dev/.codex\"",
      "su - dev -s /bin/bash -c \"$command\" </dev/null",
      "CODEX_HOME='/home/dev/.codex' rtk init -g --codex",
      "RTK_CLAUDE_DIR='$CLAUDE_CONFIG_DIR' rtk init -g --auto-patch",
      "rtk init -g --gemini --auto-patch",
      "rtk init -g --opencode",
      "\"codex\")",
      "\"claude\")",
      "\"gemini\")",
      "\"grok\")",
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
      "$project_dir/.grok/settings.json",
      "$project_dir/.grok/commands",
      "$project_dir/.grok/skills",
      "MCP_PLAYWRIGHT_ISOLATED=1 codex exec",
      "MCP_PLAYWRIGHT_ISOLATED=1 claude --dangerously-skip-permissions -p",
      "MCP_PLAYWRIGHT_ISOLATED=1 grok --no-sandbox -p"
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

  it("renders Grok API env expansion without escaping bash defaults", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      'GROK_LABEL_RAW="${GROK_AUTH_LABEL:-}"',
      'export GROK_AUTH_LABEL="$GROK_LABEL_NORM"',
      'elif [[ -n "${GROK_DEPLOYMENT_KEY:-}" ]]; then',
      'elif [[ -n "${GROK_API_KEY:-}" ]]; then',
      'elif [[ -n "${XAI_API_KEY:-}" ]]; then',
      "Priority: selected account files, then GROK_DEPLOYMENT_KEY, GROK_API_KEY, XAI_API_KEY.",
      'docker_git_upsert_ssh_env "GROK_DEPLOYMENT_KEY" "${GROK_DEPLOYMENT_KEY:-}"',
      'export GROK_DEPLOYMENT_KEY="$RESOLVED_GROK_API_KEY"',
      'docker_git_upsert_ssh_env "GROK_API_KEY" "${GROK_API_KEY:-}"',
      'docker_git_upsert_ssh_env "XAI_API_KEY" "${XAI_API_KEY:-}"'
    ])
    expect(entrypoint).not.toContain('GROK_LABEL_RAW="$GROK_AUTH_LABEL"')
    expect(entrypoint).not.toContain("\\${GROK_DEPLOYMENT_KEY:-}")
    expect(entrypoint).not.toContain("\\${GROK_API_KEY:-}")
    expect(entrypoint).not.toContain("\\${XAI_API_KEY:-}")
    expect(entrypoint).not.toContain('export XAI_API_KEY="$GROK_API_KEY"')
    expect(entrypoint).not.toContain('export GROK_DEPLOYMENT_KEY="${GROK_API_KEY:-}"')
    expect(entrypoint).not.toContain('export GROK_API_KEY="${XAI_API_KEY:-}"')
  })

  it("renders Grok file ownership from the configured SSH user", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      'GROK_SETTINGS_OWNER_UID="$(id -u "dev" 2>/dev/null || id -u)"',
      'GROK_SETTINGS_OWNER_GID="$(id -g "dev" 2>/dev/null || id -g)"',
      'chown -R "$GROK_SETTINGS_OWNER_UID:$GROK_SETTINGS_OWNER_GID" "$GROK_SETTINGS_DIR" || true',
      'GROK_NOTICE_OWNER_UID="$(id -u "dev" 2>/dev/null || id -u)"',
      'GROK_NOTICE_OWNER_GID="$(id -g "dev" 2>/dev/null || id -g)"',
      'chown "$GROK_NOTICE_OWNER_UID:$GROK_NOTICE_OWNER_GID" "$GROK_MD_PATH" || true',
      "Risk rationale: Grok runs inside an isolated per-project container."
    ])
    expect(entrypoint).not.toContain('chown -R 1000:1000 "$GROK_SETTINGS_DIR"')
    expect(entrypoint).not.toContain('chown 1000:1000 "$GROK_MD_PATH"')
  })

  it("replaces migrated Grok home files with selected-label symlinks", () => {
    const entrypoint = renderAuthEntrypoint()
    const copyIndex = entrypoint.indexOf('cp "$link_path" "$source_path" || true')
    const dirGuardIndex = entrypoint.indexOf('if [[ -d "$link_path" ]]; then', copyIndex)
    const linkIndex = entrypoint.indexOf('ln -sfn "$source_path" "$link_path" || true', dirGuardIndex)

    expectContainsAll(entrypoint, [
      'cp "$link_path" "$source_path" || true',
      'chmod 0600 "$source_path" || true',
      'if [[ -d "$link_path" ]]; then',
      'ln -sfn "$source_path" "$link_path" || true',
      'docker_git_link_grok_file "$GROK_CONFIG_DIR/.api-key" "$GROK_HOME_DIR/.api-key"',
      'docker_git_link_grok_file "$GROK_SHARED_HOME_DIR/auth.json" "$GROK_HOME_DIR/auth.json"'
    ])
    expect(copyIndex).toBeGreaterThanOrEqual(0)
    expect(dirGuardIndex).toBeGreaterThan(copyIndex)
    expect(linkIndex).toBeGreaterThan(dirGuardIndex)
  })

  it("renders Grok auth bootstrap wiring into the container docker-git home", () => {
    const entrypoint = renderAuthEntrypoint()

    expectContainsAll(entrypoint, [
      'DOCKER_GIT_GROK_AUTH_DIR="$DOCKER_GIT_HOME/.orch/auth/grok"',
      'BOOTSTRAP_GROK_AUTH_DIR="$BOOTSTRAP_SOURCE_ROOT/project-auth/grok"',
      'mkdir -p "$DOCKER_GIT_AUTH_DIR" "$DOCKER_GIT_CLAUDE_AUTH_DIR" "$DOCKER_GIT_GROK_AUTH_DIR"',
      'sync_dir_entries "$BOOTSTRAP_GROK_AUTH_DIR" "$DOCKER_GIT_GROK_AUTH_DIR"',
      'export GROK_CONFIG_DIR="$GROK_AUTH_ROOT/$GROK_LABEL_NORM"',
      'docker_git_link_grok_file "$GROK_CONFIG_DIR/.api-key" "$GROK_HOME_DIR/.api-key"'
    ])
  })

  it("renders system-prompt override hooks for codex/claude/gemini/grok", () => {
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
      "GEMINI_PROMPT_BODY=\"$GEMINI_DEFAULT_PROMPT_BODY\"",
      "GROK_SYSTEM_PROMPT_OVERRIDE_FILE=\"${GROK_SYSTEM_PROMPT_OVERRIDE_FILE:-}\"",
      "GROK_SYSTEM_PROMPT_OVERRIDE=\"${GROK_SYSTEM_PROMPT_OVERRIDE:-}\"",
      "GROK_DEFAULT_PROMPT_BODY=\"$(docker_git_decode_unicode_escapes \"$GROK_DEFAULT_PROMPT_BODY\")\"",
      "GROK_PROMPT_BODY=\"$(cat \"$GROK_SYSTEM_PROMPT_OVERRIDE_FILE\")\"",
      "GROK_PROMPT_BODY=\"$GROK_SYSTEM_PROMPT_OVERRIDE\"",
      "GROK_PROMPT_BODY=\"$GROK_DEFAULT_PROMPT_BODY\""
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
      "{ stty sane < /dev/tty > /dev/tty; } 2>/dev/null",
      '*) return 0 2>/dev/null || exit 0 ;;',
      "docker_git_terminal_sanitize",
      "trap 'docker_git_terminal_sanitize' EXIT",
      "add-zsh-hook zshexit docker_git_terminal_on_exit",
      'if [[ "${DOCKER_GIT_ZSH_AUTOSUGGEST:-0}" == "1" ]]',
      "DOCKER_GIT_ZSH_AUTOSUGGEST=0"
    ])
    expect(entrypoint).not.toContain("trap 'docker_git_terminal_sanitize' EXIT INT TERM")
    expect(entrypoint).not.toContain("TRAPINT() {")
    expect(entrypoint).not.toContain("TRAPTERM() {")
  })

  it("refreshes clone cache mirrors without fetching GitHub pull request refs", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig())

    expect(entrypoint).toContain(
      "git --git-dir '$CACHE_REPO_DIR' fetch --progress --prune '$AUTH_REPO_URL' '+refs/heads/*:refs/heads/*' '+refs/tags/*:refs/tags/*'"
    )
    expect(entrypoint).not.toContain("'+refs/*:refs/*'")
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
    expect(compose).toContain("    build: .\n")
    expect(compose).not.toContain("    pull_policy: never\n")
    expect(compose).toContain("container_name: dg-test")
    expect(compose).toContain("    env_file:\n      - '/workspace/.orch/env/global.env'\n      - '/workspace/.orch/env/project.env'\n")
    expect(compose).not.toContain("restart:")
    expect(compose).toContain('DOCKER_GIT_PROJECT_DOCKER_HOST: "${DOCKER_GIT_PROJECT_DOCKER_HOST:-}"')
    expect(compose).toContain('- "${DOCKER_GIT_PROJECT_SSH_BIND_HOST:-127.0.0.1}:2222:22"')
    expect(compose).toContain('    extra_hosts:\n      - "host.docker.internal:host-gateway"')
    expect(compose).toContain("    dns:\n      - 8.8.8.8\n      - 8.8.4.4\n      - 1.1.1.1\n    networks:")
    expect(compose).not.toContain("    gpus: all\n")
    expect(compose).not.toContain("dg-test-browser")
    expect(compose).not.toContain("/var/run/docker.sock:/var/run/docker.sock")
    expect((compose.match(/\n    dns:\n/g) ?? []).length).toBe(1)
  })

  it("renders an explicit prebuilt image without a build section", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        imageName: "docker-git-e2e-project:latest"
      })
    )

    expect(compose).toContain("    image: 'docker-git-e2e-project:latest'\n")
    expect(compose).toContain("    pull_policy: never\n")
    expect(compose).not.toContain("    build: .\n")
  })

  it("quotes env_file paths so Windows paths and spaces remain YAML scalars", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        envGlobalPath: "C:\\Users\\Dev\\Docker Git\\global.env",
        envProjectPath: "/workspace/it'test/project.env"
      })
    )

    expect(compose).toContain(
      "    env_file:\n      - 'C:\\Users\\Dev\\Docker Git\\global.env'\n      - '/workspace/it''test/project.env'\n"
    )
  })

  it("renders GPU access only on the main service when explicitly enabled", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        enableMcpPlaywright: true,
        gpu: "all"
      })
    )

    expect(compose).toContain("    gpus: all\n")
    expect((compose.match(/\n    gpus: all\n/g) ?? []).length).toBe(1)
    expect(compose).toContain('DOCKER_GIT_BROWSER_CONTAINER_NAME: "dg-test-browser"')
    expect(compose).not.toContain("\n  dg-test-browser:\n")
  })

  it("persists explicit Docker host into login and SSH environments before socket fallback", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig())

    expect(entrypoint).toContain('if [[ -n "${DOCKER_GIT_PROJECT_DOCKER_HOST:-}" && -z "${DOCKER_HOST:-}" ]]; then')
    expect(entrypoint).toContain('printf "export DOCKER_HOST=%q\\n" "$DOCKER_HOST" > /etc/profile.d/docker-host.sh')
    expect(entrypoint).toContain('docker_git_upsert_ssh_env "DOCKER_HOST" "$DOCKER_HOST"')
    expect(entrypoint).toContain('elif [[ -S /var/run/docker.sock ]]; then')
    expect(entrypoint).toContain('if getent group "$DOCKER_GROUP" >/dev/null 2>&1; then')
    expect(entrypoint).toContain('groupmod -o -g "$DOCKER_SOCK_GID" "$DOCKER_GROUP" || true')
    expect(entrypoint).toContain('docker_git_upsert_ssh_env "DOCKER_HOST" "unix:///var/run/docker.sock"')
  })

  it("renders nested browser runtime configuration when Playwright is enabled", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        enableMcpPlaywright: true,
        gpu: "none",
      }),
      {
        cpuLimit: 1.5,
        ramLimit: "2g",
        swapLimit: "4g"
      }
    )

    expect(compose).not.toContain("MCP_PLAYWRIGHT_CDP_ENDPOINT")
    expect(compose).toContain('DOCKER_GIT_PROJECT_CONTAINER_NAME: "dg-test"')
    expect(compose).toContain('DOCKER_GIT_BROWSER_CONTAINER_NAME: "dg-test-browser"')
    expect(compose).toContain('DOCKER_GIT_BROWSER_IMAGE_NAME: "dg-test-browser:docker-git-browser"')
    expect(compose).toContain('DOCKER_GIT_BROWSER_VOLUME_NAME: "dg-test-home-browser"')
    expect(compose).toContain('DOCKER_GIT_BROWSER_CPU_LIMIT: "${DOCKER_GIT_BROWSER_CPU_LIMIT:-1.5}"')
    expect(compose).toContain('DOCKER_GIT_BROWSER_RAM_LIMIT: "${DOCKER_GIT_BROWSER_RAM_LIMIT:-2g}"')
    expect(compose).not.toContain("      - /var/run/docker.sock:/var/run/docker.sock")
    expect(compose).toContain("  dg-test-home-browser:")
    expect(compose).not.toContain("\n  dg-test-browser:\n")
    expect(compose).not.toContain("dg-test-browser:\n    build:")
    expect(compose).not.toContain("restart:")
    expect((compose.match(/\n    dns:\n/g) ?? []).length).toBe(1)
  })

  it("plans Rust browser connection artifacts when Playwright is enabled", () => {
    const files = planFiles(makeTemplateConfig({ enableMcpPlaywright: true }))
    const filePaths = files.flatMap((file) => file._tag === "File" ? [file.relativePath] : [])
    const dockerfile = files.find(
      (file): file is Extract<(typeof files)[number], { readonly _tag: "File" }> =>
        file._tag === "File" && file.relativePath === "Dockerfile"
    )
    const entrypoint = files.find(
      (file): file is Extract<(typeof files)[number], { readonly _tag: "File" }> =>
        file._tag === "File" && file.relativePath === "entrypoint.sh"
    )

    expect(filePaths).not.toContain("Dockerfile.browser")
    expect(filePaths).not.toContain("docker-git-cdp-guard")
    expect(filePaths).not.toContain("docker-git-browser-runtime.sh")
    expect(filePaths).not.toContain("mcp-playwright-start-extra.sh")
    expect(dockerfile?.contents).toContain("cargo install --git https://github.com/ProverCoderAI/rust-browser-connection")
    expect(dockerfile?.contents).toContain("/usr/local/bin/browser-connection --version")
    expect(dockerfile?.contents).not.toContain("docker-git-playwright-mcp")
    expect(dockerfile?.contents).not.toContain("COPY Dockerfile.browser")
    expect(entrypoint?.contents).not.toContain("docker_git_start_rust_browser_connection")
    expect(entrypoint?.contents).not.toContain("start --project")
    expect(entrypoint?.contents).not.toContain("--no-start-browser")
    expect(entrypoint?.contents).toContain("docker_git_stop_playwright_browser()")
    expect(entrypoint?.contents).toContain("docker-git-browser-connection")
    expect(entrypoint?.contents).toContain('stop --project "$project_container"')
    expect(entrypoint?.contents).toContain('command = "browser-connection"')
    expect(entrypoint?.contents).toContain('args = ["--project", "$DOCKER_GIT_BROWSER_PROJECT", "--network", "$DOCKER_GIT_BROWSER_NETWORK"]')
  })
  it("renders Rust browser cleanup before MCP client config without eager startup", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig({ enableMcpPlaywright: true }))
    const cleanupIndex = entrypoint.indexOf("docker_git_stop_playwright_browser()")
    const mcpConfigIndex = entrypoint.indexOf("[mcp_servers.playwright]")

    expect(cleanupIndex).toBeGreaterThanOrEqual(0)
    expect(mcpConfigIndex).toBeGreaterThan(cleanupIndex)
    expect(entrypoint).not.toContain("docker_git_start_rust_browser_connection")
    expect(entrypoint).not.toContain("start --project")
    expect(entrypoint).not.toContain("--no-start-browser")
  })

  it("renders Browser MCP project fallback without set -u unbound variables", () => {
    const entrypoint = renderEntrypoint(makeTemplateConfig({ enableMcpPlaywright: false }))

    expect(entrypoint).toContain('DOCKER_GIT_BROWSER_PROJECT="${DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"')
    expect(entrypoint).toContain('local browser_project="${DOCKER_GIT_PROJECT_CONTAINER_NAME:-}"')
    expect(entrypoint).not.toContain('"$DOCKER_GIT_PROJECT_CONTAINER_NAME"')
  })

  it("renders local Docker socket mount only when explicitly enabled", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        enableMcpPlaywright: true,
        gpu: "none",
      }),
      {
        cpuLimit: 1.5,
        ramLimit: "2g"
      },
      { enableLocalDockerSocket: true }
    )

    expect(compose).toContain("      - /var/run/docker.sock:/var/run/docker.sock")
  })

  it("applies separate resource limits for the nested browser runtime when provided", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        enableMcpPlaywright: true,
        gpu: "none",
      }),
      {
        main: { cpuLimit: 2, ramLimit: "4g", swapLimit: "8g" },
        playwright: { cpuLimit: 0.5, ramLimit: "1g", swapLimit: "2g" }
      }
    )

    expect(compose).not.toContain("\n  dg-test-browser:\n")
    expect(compose).toContain("    cpus: 2\n")
    expect(compose).toContain('    mem_limit: "4g"\n')
    expect(compose).toContain('    memswap_limit: "8g"\n')
    expect(compose).toContain('DOCKER_GIT_BROWSER_CPU_LIMIT: "${DOCKER_GIT_BROWSER_CPU_LIMIT:-0.5}"')
    expect(compose).toContain('DOCKER_GIT_BROWSER_RAM_LIMIT: "${DOCKER_GIT_BROWSER_RAM_LIMIT:-1g}"')
  })

  it("backward-compatibly applies single resource limit shape to main and nested browser", () => {
    const compose = renderDockerCompose(
      makeTemplateConfig({
        enableMcpPlaywright: true,
        gpu: "none",
      }),
      {
        cpuLimit: 1.5,
        ramLimit: "2g",
        swapLimit: "4g"
      }
    )

    expect(compose).not.toContain("\n  dg-test-browser:\n")
    expect(compose).toContain("    cpus: 1.5\n")
    expect(compose).toContain('    mem_limit: "2g"\n')
    expect(compose).toContain('    memswap_limit: "4g"\n')
    expect(compose).toContain('DOCKER_GIT_BROWSER_CPU_LIMIT: "${DOCKER_GIT_BROWSER_CPU_LIMIT:-1.5}"')
    expect(compose).toContain('DOCKER_GIT_BROWSER_RAM_LIMIT: "${DOCKER_GIT_BROWSER_RAM_LIMIT:-2g}"')
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

import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"

import { type TemplateConfig } from "../../src/core/domain.js"
import { planFiles } from "../../src/core/templates.js"

describe("planFiles", () => {
  it.effect("includes docker and config files", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-test",
        serviceName: "dg-test",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "main",
        targetDir: "/home/dev/app",
        volumeName: "dg-test-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        baseFlavor: "ubuntu",
        enableMcpPlaywright: false,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const composeSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "docker-compose.yml"
      )
      const ignoreSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === ".dockerignore"
      )
      const configSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "docker-git.json"
      )
      const dockerfileSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "Dockerfile"
      )
      const entrypointSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "entrypoint.sh"
      )

      expect(composeSpec !== undefined && composeSpec._tag === "File").toBe(true)
      expect(ignoreSpec !== undefined && ignoreSpec._tag === "File").toBe(true)
      expect(configSpec !== undefined && configSpec._tag === "File").toBe(true)
      expect(dockerfileSpec !== undefined && dockerfileSpec._tag === "File").toBe(true)
      expect(entrypointSpec !== undefined && entrypointSpec._tag === "File").toBe(true)

      if (configSpec && configSpec._tag === "File") {
        expect(configSpec.contents).toContain(config.repoUrl)
        expect(configSpec.contents).toContain(config.containerName)
      }

      if (ignoreSpec && ignoreSpec._tag === "File") {
        expect(ignoreSpec.contents).toContain(".orch/")
        expect(ignoreSpec.contents).toContain("authorized_keys")
      }

      if (dockerfileSpec && dockerfileSpec._tag === "File") {
        expect(dockerfileSpec.contents).toContain("MENU_COMPLETE")
        expect(dockerfileSpec.contents).toContain("AUTO_MENU")
        expect(dockerfileSpec.contents).toContain("ncurses-term")
        expect(dockerfileSpec.contents).toContain("tag-order builtins commands")
        expect(dockerfileSpec.contents).toContain("gitleaks version")
      }

      if (entrypointSpec && entrypointSpec._tag === "File") {
        expect(entrypointSpec.contents).toContain(
          "GIT_CREDENTIAL_HELPER_PATH=\"/usr/local/bin/docker-git-credential-helper\""
        )
        expect(entrypointSpec.contents).toContain("token=\"$GITHUB_TOKEN\"")
        expect(entrypointSpec.contents).toContain("CACHE_ROOT=\"/home/dev/.docker-git/.cache/git-mirrors\"")
        expect(entrypointSpec.contents).toContain("CLONE_CACHE_ARGS=\"--reference-if-able '$CACHE_REPO_DIR' --dissociate\"")
        expect(entrypointSpec.contents).toContain("[clone-cache] using mirror: $CACHE_REPO_DIR")
        expect(entrypointSpec.contents).toContain("git clone --progress $CLONE_CACHE_ARGS")
        expect(entrypointSpec.contents).toContain("[clone-cache] mirror created: $CACHE_REPO_DIR")
      }
    }))

  it.effect("includes Playwright sidecar files when enabled", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-test",
        serviceName: "dg-test",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "main",
        targetDir: "/home/dev/app",
        volumeName: "dg-test-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        baseFlavor: "ubuntu",
        enableMcpPlaywright: true,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const browserDockerfile = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "Dockerfile.browser"
      )
      const browserScript = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "mcp-playwright-start-extra.sh"
      )

      expect(browserDockerfile !== undefined && browserDockerfile._tag === "File").toBe(true)
      expect(browserScript !== undefined && browserScript._tag === "File").toBe(true)
    }))

  it.effect("renders Nix flavor Dockerfile when requested", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-test",
        serviceName: "dg-test",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "main",
        targetDir: "/home/dev/app",
        volumeName: "dg-test-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        baseFlavor: "nix",
        enableMcpPlaywright: false,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const dockerfileSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "Dockerfile"
      )
      expect(dockerfileSpec !== undefined && dockerfileSpec._tag === "File").toBe(true)
      if (dockerfileSpec && dockerfileSpec._tag === "File") {
        expect(dockerfileSpec.contents).toContain("FROM nixos/nix:latest")
        expect(dockerfileSpec.contents).toContain("nix profile install --profile /nix/var/nix/profiles/default")
        expect(dockerfileSpec.contents).not.toContain("FROM ubuntu:24.04")
      }
    }))

  it.effect("embeds issue workspace AGENTS context in entrypoint", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-repo-issue-5",
        serviceName: "dg-repo-issue-5",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "issue-5",
        targetDir: "/home/dev/org/repo/issue-5",
        volumeName: "dg-repo-issue-5-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        baseFlavor: "ubuntu",
        enableMcpPlaywright: false,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const entrypointSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "entrypoint.sh"
      )
      expect(entrypointSpec !== undefined && entrypointSpec._tag === "File").toBe(true)
      if (entrypointSpec && entrypointSpec._tag === "File") {
        expect(entrypointSpec.contents).toContain("Доступные workspace пути:")
        expect(entrypointSpec.contents).toContain("Контекст workspace:")
        expect(entrypointSpec.contents).toContain("Issue AGENTS.md:")
        expect(entrypointSpec.contents).toContain("ISSUE_AGENTS_PATH=\"$TARGET_DIR/AGENTS.md\"")
        expect(entrypointSpec.contents).toContain("grep -qx \"AGENTS.md\" \"$EXCLUDE_PATH\"")
        expect(entrypointSpec.contents).toContain("docker_git_workspace_context_line()")
        expect(entrypointSpec.contents).toContain("REPO_REF_VALUE=\"${REPO_REF:-issue-5}\"")
        expect(entrypointSpec.contents).toContain("REPO_URL_VALUE=\"${REPO_URL:-https://github.com/org/repo.git}\"")
        expect(entrypointSpec.contents).toContain("Контекст workspace: issue #$ISSUE_ID_VALUE ($ISSUE_URL_VALUE)")
      }
    }))

  it.effect("embeds PR workspace URL context in entrypoint", () =>
    Effect.sync(() => {
      const config: TemplateConfig = {
        containerName: "dg-repo-pr-42",
        serviceName: "dg-repo-pr-42",
        sshUser: "dev",
        sshPort: 2222,
        repoUrl: "https://github.com/org/repo.git",
        repoRef: "refs/pull/42/head",
        targetDir: "/home/dev/org/repo/pr-42",
        volumeName: "dg-repo-pr-42-home",
        authorizedKeysPath: "./authorized_keys",
        envGlobalPath: "./.orch/env/global.env",
        envProjectPath: "./.orch/env/project.env",
        codexAuthPath: "./.orch/auth/codex",
        codexSharedAuthPath: "../../.orch/auth/codex",
        codexHome: "/home/dev/.codex",
        baseFlavor: "ubuntu",
        enableMcpPlaywright: false,
        pnpmVersion: "10.27.0"
      }

      const specs = planFiles(config)
      const entrypointSpec = specs.find(
        (spec) => spec._tag === "File" && spec.relativePath === "entrypoint.sh"
      )
      expect(entrypointSpec !== undefined && entrypointSpec._tag === "File").toBe(true)
      if (entrypointSpec && entrypointSpec._tag === "File") {
        expect(entrypointSpec.contents).toContain("REPO_REF_VALUE=\"${REPO_REF:-refs/pull/42/head}\"")
        expect(entrypointSpec.contents).toContain("REPO_URL_VALUE=\"${REPO_URL:-https://github.com/org/repo.git}\"")
        expect(entrypointSpec.contents).toContain(
          "PR_ID=\"$(printf \"%s\" \"$REPO_REF\" | sed -nE 's#^refs/pull/([0-9]+)/head$#\\1#p')\""
        )
        expect(entrypointSpec.contents).toContain(
          "PR_URL=\"https://github.com/$PR_REPO/pull/$PR_ID\""
        )
        expect(entrypointSpec.contents).toContain(
          "WORKSPACE_INFO_LINE=\"Контекст workspace: PR #$PR_ID ($PR_URL)\""
        )
        expect(entrypointSpec.contents).toContain("Контекст workspace: PR #$PR_ID_VALUE ($PR_URL_VALUE)")
      }
    }))
})
